# Chapter 5: Getting Permission: Tokens

Chapter 4 knocked on Docker Hub's front door. It answered `401`, "not
without a token," and said where to get one. This chapter follows those
directions. We read the challenge, ask the token server for a token,
and try again with the token attached. Then we use it to fetch
something real: the **manifest**, the small file that describes an
image. Chapter 6 reads what's inside it. This chapter just gets hold of
it.

The chapter also gives you a new testing tool. Our code now makes
*several* calls in a row: first the registry, then the token server,
then the registry again. So the fake has to answer differently each
time it's called. By the end, one test plays the whole conversation,
`401` then token then manifest, in about a millisecond.

New in this chapter: `Record`, optional parameters, `URL`, `unknown`,
`Map`, named regex groups, `...` for copying and gathering, and
`mockResolvedValueOnce`.

## The whole dance, by hand

Before writing code, do it with curl so you know exactly what the code
has to do. It takes three requests.

**1. Ask for the manifest.** A manifest lives at
`/v2/<repository>/manifests/<tag>`:

```
$ curl -sS -o /dev/null -D - https://registry-1.docker.io/v2/library/alpine/manifests/latest
```

```
HTTP/2 401
www-authenticate: Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/alpine:pull"
```

(Headers trimmed, as in Chapter 4.) The same `401` as the front door,
but this challenge has three parts:

- **`realm`**: the address of the token server. Not the registry
  itself, a separate service.
- **`service`**: which registry the token is for. One token server can
  hand out tokens for several registries.
- **`scope`**: what you're asking permission to do.
  `repository:library/alpine:pull` means "pull from `library/alpine`."
  The front door in Chapter 4 had no scope, because it wasn't asking
  about any repository in particular.

**2. Ask the token server.** Send `service` and `scope` to the `realm`
as `?key=value` parts of the address:

```
$ curl -sS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/alpine:pull"
```

```
{"token":"eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsIng1YyI6WyJNSUlFRmpDQ0F2NmdBd0lCQWdJVWN4aExGcUJEVDZuWWQzV1UvcjFMZXpGdGNOY3
```

That's cut short. The whole reply is JSON with four fields: `token`
(about 2,700 characters), `access_token` (the same token again, under
an older name), `expires_in` (`300`, meaning five minutes), and
`issued_at`. No password was asked for. Docker Hub hands out tokens for
public images to anyone who asks. Asking still matters, because that's
how Docker Hub counts and limits anonymous pulls.

**3. Try again, with the token.** The token goes in an `Authorization`
header, after the word `Bearer`. It's too long to paste, so store it in
a shell variable first. `node -p` runs one line of JavaScript and
prints the result, which here is the `token` field of whatever came in
on standard input:

```
$ TOKEN=$(curl -sS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/alpine:pull" \
    | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).token')
$ curl -sS -o /dev/null -D - \
    -H "Authorization: Bearer $TOKEN" \
    -H "Accept: application/vnd.oci.image.index.v1+json" \
    https://registry-1.docker.io/v2/library/alpine/manifests/latest
```

```
HTTP/2 200
content-type: application/vnd.oci.image.index.v1+json
content-length: 9218
docker-content-digest: sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
```

We're in. Three headers matter:

- **`content-type`** says what kind of manifest came back. This one is
  an *index*: a list of manifests, one per kind of CPU. Chapter 6 deals
  with that.
- **`content-length`** is its size, 9,218 bytes.
- **`docker-content-digest`** is its fingerprint. That's the `sha256:`
  checksum of those exact bytes. You'll see a lot more of these.

We also sent an `Accept` header. That's how a client tells the server
"these are the formats I can read." Registries know several manifest
formats, old and new, and some fall back to an old one if you don't
say. Our code will send the four formats Chapter 6 handles.

One more registry, to check this isn't a Docker Hub quirk. GitHub's
registry does the same dance, but its token reply has only `token`, no
`access_token`:

```
$ curl -sS "https://ghcr.io/token?service=ghcr.io&scope=repository:containerd/busybox:pull"
```

```
{"token":"djE6Y29udGFpbmVyZC9idXN5Ym94OjE3OTAyNjAwMDc2MjgzNDg3NDI="}
```

So our code reads `token` and ignores the rest.

## The plan

The code has four pieces, one job each:

1. `HttpClient` learns to send headers. Right now `get(url)` can't send
   `Authorization` or `Accept`.
2. `parseChallenge` turns the `www-authenticate` text into
   `{ realm, service }`.
3. An **authenticator** turns a challenge and a scope into a token.
4. `RegistryClient` gets a private method that does "try; on `401`, get
   a token; try once more." Every request that needs permission goes
   through it.

## Step 1: `HttpClient` learns to send headers

Chapter 4 promised this could be added without touching the code that
already works. Here's how. Replace `src/http.ts`:

```ts
// Extra header lines to send, as name → value.
// Record<string, string> is "an object whose keys and values are all strings",
// like map[string]string in Go or dict[str, str] in Python.
export type RequestHeaders = Record<string, string>

export interface HttpClient {
  // The ? makes headers optional: callers that need none can leave it off.
  get(url: string, headers?: RequestHeaders): Promise<Response>
}

export class FetchHttpClient implements HttpClient {
  // `= {}` fills in an empty object when the caller passed nothing.
  async get(url: string, headers: RequestHeaders = {}): Promise<Response> {
    return fetch(url, { headers })
  }
}
```

Three new bits of syntax:

- **`Record<string, string>`** is the type for an object used as a
  lookup table: any keys, all strings, all values strings. The `<...>`
  is the fill-in-the-blank from Chapter 4: "a record *from* string *to*
  string." We give it a name, `RequestHeaders`, because it'll be
  written in several places. (Not `Headers`, because JavaScript already
  has a built-in class by that name.)
- **`headers?:`** makes the parameter optional. Inside the interface,
  that means callers may leave it off. Go has no optional parameters,
  so there you'd add a second method. Python has them with
  `headers=None`.
- **`headers: RequestHeaders = {}`** in the class is a *default value*,
  the same as in Python. If nobody passes headers, `headers` is `{}`.
  So inside the method, `headers` is never missing.

`fetch(url, { headers })` passes the headers on. `fetch`'s second
argument is an object of options, and `headers` is one of them.
`{ headers }` is the same shorthand as before, meaning
`{ headers: headers }`.

Now the point. Run the checks:

```
$ npm run check
```

```
 Test Files  3 passed (3)
      Tests  23 passed (23)
```

Nothing else changed, and nothing else had to. `checkApi` still calls
`get(url)` with one argument, which is still allowed. The fake in
`registry.test.ts` still has the right shape. Even
`toHaveBeenCalledWith(url)` still passes, because the call really did
have only one argument. Making the new parameter *optional* is what
made this safe. A required parameter would have broken every caller.

## Step 2: read the challenge

The challenge is text:

```
Bearer realm="https://auth.docker.io/token",service="registry.docker.io",scope="repository:library/alpine:pull"
```

We want `realm` and `service` out of it. (Not `scope`: we'll build our
own, because we know which repository we want. GitHub's front-door
challenge in Chapter 4 said `scope="repository:user/image:pull"`, a
placeholder that isn't any real repository.)

This is a new file, `src/auth.ts`, for everything about getting
permission. First, the result type and an error class.

> **Your turn.** In `src/auth.ts`, export an interface `Challenge` with
> two `readonly` string fields, `realm` and `service`. Then export an
> `AuthError` class, built like `InvalidReferenceError` from Chapter 3.
> It takes one `problem: string`, its message is `auth: <problem>`, and
> its `name` is `"AuthError"`.

Here it is:

```ts
import type { HttpClient } from "./http.ts"

// Where to go for a token, read out of a www-authenticate header.
export interface Challenge {
  readonly realm: string // the token server's address
  readonly service: string // which registry the token is for
}

export class AuthError extends Error {
  constructor(problem: string) {
    super(`auth: ${problem}`)
    this.name = "AuthError"
  }
}
```

(The `HttpClient` import is used further down. Until then,
`noUnusedLocals` will complain about it. That's fine for a few
minutes.)

Now the parser. The text is `Bearer ` followed by `key="value"` pairs
separated by commas. A regular expression picks out the pairs. You know
regexes from Go and Python. Two JavaScript details are new:

```ts
// Matches one key="value" pair. (?<key>...) and (?<value>...) are named
// groups: the matched text is read back as match.groups.key and .value.
// The g at the end means "find every match, not just the first".
const PARAM = /(?<key>[a-z]+)="(?<value>[^"]*)"/g

export function parseChallenge(header: string): Challenge {
  // Only a Bearer challenge sends us off to fetch a token.
  if (!header.startsWith("Bearer ")) {
    throw new AuthError(`unsupported challenge: ${header}`)
  }

  // Every key="value" pair goes into a Map, like a Go map or a Python dict.
  const params = new Map<string, string>()
  for (const match of header.matchAll(PARAM)) {
    // groups can be undefined in the type, so `?? {}` gives destructuring
    // something to pull from. key and value are then string | undefined.
    const { key, value } = match.groups ?? {}
    if (key !== undefined && value !== undefined) {
      params.set(key, value)
    }
  }

  // Map.get returns undefined for a missing key.
  const realm = params.get("realm")
  const service = params.get("service")
  if (realm === undefined || service === undefined) {
    throw new AuthError(`challenge is missing realm or service: ${header}`)
  }
  return { realm, service }
}
```

Reading it:

- **`/.../g`** is a regex written straight into the code, between
  slashes. Python needs `re.compile("...")`, and Go needs
  `regexp.MustCompile("...")`. The `g` flag means *global*: find every
  match. `matchAll` requires it.
- **`(?<key>...)`** is a *named group*. It's the same idea as Python's
  `(?P<key>...)`, spelled without the `P`. After a match,
  `match.groups.key` holds whatever that group matched.
- **`header.matchAll(PARAM)`** gives each match in turn, and
  `for ... of` walks through them. It's Python's `re.finditer` or Go's
  `FindAllStringSubmatch`.
- **`match.groups ?? {}`.** The type of `groups` allows `undefined`,
  because a regex with no named groups has none. Ours always does, but
  the compiler can't know that. So `?? {}` means "or an empty object if
  it's missing." Then `const { key, value } = ...` pulls both fields
  out. Either one might be missing, so each is `string | undefined`,
  and we check both before storing.
- **`new Map<string, string>()`** is a real lookup table. For
  `RequestHeaders` we used a plain object, because `fetch` wants one.
  Here, nobody outside sees the table, so `Map` is the better tool:
  `get` returns `undefined` for a missing key, and the type says so.
  With `noUncheckedIndexedAccess` switched on in Chapter 2, a plain
  object would say the same. `Map` is just clearer about it.

We don't try to handle every challenge the standard allows. Two
details are skipped: a comma *inside* a quoted value, and escaped
quotes. No registry we've met sends either. If one ever does, the tests
below are where you'd add a case.

The `Bearer` check matters. A small private registry, the kind you run
yourself with a password file, answers `Basic realm="..."` instead.
That means "send a user name and password on every request," with no
token server. We don't support that, and saying so clearly beats
failing somewhere confusing later.

### Tests for the parser

It's a plain function with no network, like `parseReference` in
Chapter 3. The best test data is the real challenges from the three
registries we've seen.

> **Your turn.** Create `src/auth.test.ts`. Write an `it.each` over
> three rows, one each for the Docker Hub, GitHub, and Quay challenges
> below. Each row holds the `header` plus the `realm` and `service` you
> expect. Check that `parseChallenge(header)` equals `{ realm, service }`.
> Then two more tests: a `Basic` challenge throws `AuthError`, and a
> `Bearer` challenge with no `service` throws with a message containing
> `missing realm or service`.
>
> ```
> Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
> Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/image:pull"
> Bearer realm="https://quay.io/v2/auth",service="quay.io"
> ```

Here it is:

```ts
import { describe, expect, it } from "vitest"
import { AuthError, parseChallenge } from "./auth.ts"

describe("parseChallenge", () => {
  // Three real challenges, from Docker Hub, GitHub, and Quay.
  it.each([
    {
      header: 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"',
      realm: "https://auth.docker.io/token",
      service: "registry.docker.io",
    },
    {
      // GitHub adds a scope; the parser must not trip over the extra pair.
      header: 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/image:pull"',
      realm: "https://ghcr.io/token",
      service: "ghcr.io",
    },
    {
      header: 'Bearer realm="https://quay.io/v2/auth",service="quay.io"',
      realm: "https://quay.io/v2/auth",
      service: "quay.io",
    },
  ])("reads realm and service from $service", ({ header, realm, service }) => {
    expect(parseChallenge(header)).toEqual({ realm, service })
  })

  it("rejects a Basic challenge", () => {
    // Not async: parseChallenge throws right away, so Chapter 3's
    // wrap-it-in-a-function form is the right one.
    expect(() => parseChallenge('Basic realm="Registry Realm"')).toThrow(AuthError)
  })

  it("rejects a challenge with no service", () => {
    expect(() => parseChallenge('Bearer realm="https://auth.example.com/token"')).toThrow(
      "missing realm or service",
    )
  })
})
```

```
$ npm test
```

```
 Test Files  4 passed (4)
      Tests  28 passed (28)
```

## Step 3: ask for a token

What does the rest of the code need from "the thing that gets tokens"?
One thing: *given this challenge and this scope, give me a token.* How
it does that is its own business. Today it's anonymous, with no
password. Later you'll want to pull private images, which means sending
a user name and password to the token server. That's a *different* way
of getting a token, not a change to when one is needed.

So it's an interface, and today's way is one class that implements it.
This is the same move as `HttpClient` in Chapter 4, for a different
reason. There, it was so tests could fake it. Here, it's so the code
can grow.

> **Your turn.** In `src/auth.ts`, export an interface `Authenticator`
> with one method, `token`, that takes a `challenge: Challenge` and a
> `scope: string` and returns `Promise<string>`.

Here it is:

```ts
// Anything that can turn a challenge into a token. RegistryClient knows
// only this; which way the token is fetched is someone else's business.
export interface Authenticator {
  token(challenge: Challenge, scope: string): Promise<string>
}
```

This is the **open/closed principle**, the "O" in SOLID, at the exact
line where it pays off. Code should be *open* to new behavior and
*closed* to rewrites. Adding password login later means writing a new
class, `PasswordAuthenticator implements Authenticator`, and handing it
to `RegistryClient` in `main`. `RegistryClient` itself doesn't change,
and neither does the anonymous class below. New behavior arrives as new
code, and old, tested code is left alone.

Now the anonymous one. It needs to GET the token server, so it takes an
`HttpClient` exactly as `RegistryClient` does:

```ts
// Asks for a token with no user name or password: enough for public images.
export class AnonymousAuthenticator implements Authenticator {
  private readonly http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }

  async token(challenge: Challenge, scope: string): Promise<string> {
    // URL takes an address apart; searchParams adds ?key=value parts
    // and escapes any characters that aren't allowed there.
    const url = new URL(challenge.realm)
    url.searchParams.set("service", challenge.service)
    url.searchParams.set("scope", scope)

    // url.href is the whole address put back together as a string.
    const response = await this.http.get(url.href)
    if (response.status !== 200) {
      throw new AuthError(`${url.href} answered ${response.status}`)
    }

    // unknown: "some value, I don't know what". Nothing can be done with
    // it until it's checked, so every check below is required.
    const body: unknown = await response.json()
    if (
      typeof body !== "object" || // not an object at all
      body === null || // typeof null is "object", a JavaScript oddity
      !("token" in body) || // no token field
      typeof body.token !== "string" // a token field, but not text
    ) {
      throw new AuthError(`${url.href} sent no token`)
    }
    // After those checks the compiler knows body.token is a string.
    return body.token
  }
}
```

Two new things here, and the second one sets up Chapter 6.

**`URL` builds the address.** Why not a template string,
`` `${realm}?service=${service}&scope=${scope}` ``? Because a scope
holds `:` and `/`, and those have special meanings in an address.
`searchParams.set` escapes them for us. It's Go's `url.Values` or
Python's `urllib.parse.urlencode`, built into the language. It also
copes with a `realm` that already has a `?` in it. You'll see the
escaped address in the test below.

**`unknown`, and checking by hand.** `response.json()` reads the body
and turns the JSON text into a value. What value? The server decides,
not us. So we say so: `body: unknown`. Unlike `any`, `unknown` lets you
do *nothing* with the value until you've proven what it is. `body.token`
won't even compile at first. Each check in the `if` narrows it:

1. `typeof body !== "object"` rules out strings, numbers, and so on.
2. `body === null` is needed because in JavaScript `typeof null` is
   `"object"`. It's an old mistake in the language that can't be fixed
   now.
3. `"token" in body` asks "does it have a `token` field?" After it
   passes, the compiler lets you *read* `body.token`, but still as
   `unknown`.
4. `typeof body.token !== "string"` makes it a string.

Only after all four is `return body.token` allowed as a `string`. Leave
one out and the compiler stops you. That's four careful lines to trust
*one* field. A manifest has dozens of fields, nested several levels
deep. Doing this by hand for that would be long, easy to get wrong, and
tiring to read. That's exactly what Chapter 6's `zod` is for. Remember
this `if`, because Chapter 6 replaces the idea with one line per
field.

(`response.json()` is typed as returning `Promise<any>`. Writing
`const body: unknown` throws the `any` away on purpose. With `any`,
`return body.token` would compile with no checks at all, and a
server that forgot the token would hand `undefined` to the rest of our
program, typed as a `string`.)

## Step 4: one fake, two test files

To test `AnonymousAuthenticator` we need a pretend `HttpClient` again.
`replyingWith` in `registry.test.ts` is exactly that. Copying it into
`auth.test.ts` would give two copies to keep in step, which is what
**DRY** ("don't repeat yourself") warns against. The fix is to move it
to a file both tests import.

> **Your turn.** Create `src/fake-http.ts`. Move the `FakeHttp`
> interface and `replyingWith` out of `registry.test.ts` into it, add
> `export` to both, and bring the imports they need. Then import
> `replyingWith` in `registry.test.ts`, and remove the imports it no
> longer uses there (`noUnusedLocals` will tell you which).

Here it is. `src/fake-http.ts`:

```ts
import { type Mock, vi } from "vitest"
import type { HttpClient } from "./http.ts"

// A pretend HttpClient, plus its get() so tests can ask how it was called.
export interface FakeHttp {
  http: HttpClient
  get: Mock<HttpClient["get"]>
}

// A pretend HttpClient whose get() always returns `response`.
export function replyingWith(response: Response): FakeHttp {
  const get = vi.fn<HttpClient["get"]>(async () => response)
  const http: HttpClient = { get }
  return { http, get }
}
```

And the top of `src/registry.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { replyingWith } from "./fake-http.ts"
import { RegistryClient, RegistryError } from "./registry.ts"
```

The file doesn't end in `.test.ts`, so Vitest won't try to run it as
tests. It isn't imported by anything outside tests either, so it never
becomes part of the program.

### Tests for the authenticator

One more new tool: **`Response.json(value)`**. It builds a `Response`
whose body is `value` as JSON, with the right `content-type`. It's
the quick way to fake a JSON reply.

```ts
// Add to the imports at the top of auth.test.ts:
import { AnonymousAuthenticator, AuthError, parseChallenge } from "./auth.ts"
import { replyingWith } from "./fake-http.ts"

// ...and below the parseChallenge tests:

// Docker Hub's challenge, already parsed.
const challenge = { realm: "https://auth.docker.io/token", service: "registry.docker.io" }

describe("AnonymousAuthenticator", () => {
  it("asks the realm for a token with service and scope", async () => {
    // Response.json builds a reply whose body is this object, as JSON.
    const { http, get } = replyingWith(Response.json({ token: "abc" }))

    const token = await new AnonymousAuthenticator(http).token(challenge, "repository:library/alpine:pull")

    expect(token).toBe("abc")
    // %3A is ":" and %2F is "/", escaped by searchParams.
    expect(get).toHaveBeenCalledWith(
      "https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Falpine%3Apull",
    )
  })
})
```

That expected address is what `URL` actually produces. `:` became
`%3A` and `/` became `%2F`. Docker Hub reads it the same as the
unescaped form you typed into curl. We're checking that our code builds
*exactly* this address. If a later edit forgot the `service` or
misspelled `scope`, this is the test that fails.

> **Your turn.** Two failure tests inside the same `describe`. First,
> the token server answers `403` (use `new Response(null, { status: 403 })`),
> and `token()` rejects with a message containing `answered 403`.
> Second, it answers `200` with JSON that has no `token` field, and
> `token()` rejects with `sent no token`.

Here it is:

```ts
  it("throws when the token server says no", async () => {
    const { http } = replyingWith(new Response(null, { status: 403 }))

    await expect(new AnonymousAuthenticator(http).token(challenge, "repository:x:pull")).rejects.toThrow(
      "answered 403",
    )
  })

  it("throws when the reply has no token", async () => {
    // Valid JSON, wrong shape: exactly what the four checks are for.
    const { http } = replyingWith(Response.json({ access: "nope" }))

    await expect(new AnonymousAuthenticator(http).token(challenge, "repository:x:pull")).rejects.toThrow(
      "sent no token",
    )
  })
```

```
$ npm test
```

```
 Test Files  4 passed (4)
      Tests  31 passed (31)
```

## Step 5: `RegistryClient` retries with a token

Now the piece that decides *when* a token is needed. It lives in
`RegistryClient`, and it goes like this:

1. GET the address, with a token if we already have one.
2. Not `401`? Done, return the reply.
3. `401`: read the challenge, ask the authenticator for a token, keep
   it.
4. GET again with the token. If that's *still* `401`, give up with an
   error. Don't loop.

### A small tidy-up first

Step 3 needs the challenge header out of a `401` reply, and fails if it
isn't there. `checkApi` already does exactly that, in three lines. Two
copies would be the DRY problem again, so pull those lines out into a
function both can use. Add this to `src/registry.ts`, above the class:

```ts
// The challenge from a 401 reply. A 401 without one is a broken registry.
function challengeOf(url: string, response: Response): string {
  const challenge = response.headers.get("www-authenticate")
  if (challenge === null) {
    throw new RegistryError(url, 401, "no www-authenticate header")
  }
  return challenge
}
```

> **Your turn.** Change the `401` branch of `checkApi` to use
> `challengeOf`.

Here it is:

```ts
    if (response.status === 401) {
      return { kind: "needs-token", challenge: challengeOf(this.baseUrl, response) }
    }
```

`checkApi` *decides* the same things it did before: `200` is open,
`401` needs a token, anything else is an error. Only where three lines
live has changed. `npm test` should still say 31 passed, including
Chapter 4's "no www-authenticate header" test, which now checks
`challengeOf`.

### Handing in the authenticator

`RegistryClient` needs an `Authenticator`, and just like `HttpClient`,
it's handed one rather than making its own. Add a third constructor
parameter and two fields:

```ts
import { type Authenticator, parseChallenge } from "./auth.ts"
import type { HttpClient, RequestHeaders } from "./http.ts"
import { DEFAULT_REGISTRY } from "./reference.ts"

// ...

export class RegistryClient {
  private readonly http: HttpClient
  private readonly auth: Authenticator
  private readonly baseUrl: string
  // No readonly: starts empty, set once the first token arrives.
  private token: string | undefined

  constructor(http: HttpClient, registry: string, auth: Authenticator) {
    this.http = http
    this.auth = auth
    this.baseUrl = `https://${apiHost(registry)}/v2/`
  }
```

`private token: string | undefined` with no `= ...` starts out as
`undefined`. The type says it can be, so the compiler makes every
reader check.

Run the type check:

```
$ npm run typecheck
```

```
src/main.ts(39,22): error TS2554: Expected 3 arguments, but got 2.
src/registry.test.ts(9,26): error TS2554: Expected 3 arguments, but got 2.
src/registry.test.ts(20,26): error TS2554: Expected 3 arguments, but got 2.
src/registry.test.ts(32,11): error TS2554: Expected 3 arguments, but got 2.
src/registry.test.ts(40,18): error TS2554: Expected 3 arguments, but got 2.
src/registry.test.ts(48,18): error TS2554: Expected 3 arguments, but got 2.
src/registry.ts(1,30): error TS6133: 'parseChallenge' is declared but its value is never read.
src/registry.ts(2,27): error TS6196: 'RequestHeaders' is declared but never used.
src/registry.ts(36,20): error TS6133: 'auth' is declared but its value is never read.
src/registry.ts(39,11): error TS6133: 'token' is declared but its value is never read.
```

(Your line numbers will differ, depending on your comments.) Two kinds
of error. The last four are "never used" warnings. The next section
uses all four names, so ignore them for now.

The first six matter. Unlike Step 1's optional parameter, this one is
required, so every caller broke, and the compiler lists each one. Read
it as a to-do list. `main.ts` waits for Step 7. The tests we fix now.

Chapter 4's `checkApi` tests should never cause a token request. So
hand them an authenticator that makes the test fail if it's ever asked:

```ts
// Add to the imports at the top of registry.test.ts:
import type { Authenticator } from "./auth.ts"

// An Authenticator that fails the test if anyone asks it for a token.
// checkApi never should, so these tests hand it this one.
const neverAuth: Authenticator = {
  token: async (): Promise<string> => {
    throw new Error("this test did not expect a token request")
  },
}
```

It's a plain object with a `token` field, the right shape, so it's an
`Authenticator`, just like `{ get }` was an `HttpClient` in Chapter 4.
It never answers. It only complains. A fake like this doesn't need to
be a mock, because there's nothing to record. If it's called at all,
that's already the failure.

> **Your turn.** Add `neverAuth` as the third argument to every
> `new RegistryClient(...)` in `registry.test.ts`.

Here's one; the other four are the same:

```ts
    const result = await new RegistryClient(http, "mcr.microsoft.com", neverAuth).checkApi()
```

### Try, get a token, try once more

Now the method itself. It's `private`, because nobody outside should
call it. Public methods like `fetchManifest` (next) go through it.
Add both of these inside the class, below `checkApi`:

```ts
  // GET with whatever token we have. On a 401, fetch a token and try
  // once more. Every request that needs permission goes through here.
  private async authorizedGet(url: string, scope: string, headers: RequestHeaders): Promise<Response> {
    const first = await this.http.get(url, this.withToken(headers))
    if (first.status !== 401) {
      return first
    }

    const challenge = parseChallenge(challengeOf(url, first))
    this.token = await this.auth.token(challenge, scope)

    const second = await this.http.get(url, this.withToken(headers))
    if (second.status === 401) {
      // A fresh token and still no: don't loop, stop.
      throw new RegistryError(url, 401, "token was refused")
    }
    return second
  }

  // The headers, plus an authorization line if we hold a token.
  private withToken(headers: RequestHeaders): RequestHeaders {
    if (this.token === undefined) {
      return headers
    }
    // ...headers copies every field of headers into the new object.
    return { ...headers, authorization: `Bearer ${this.token}` }
  }
```

**`{ ...headers, authorization: ... }`** makes a *new* object with
every field of `headers` copied in, then `authorization` added. The
`...` (called *spread*) means "all the fields of." It's Python's
`{**headers, "authorization": ...}`. Go has no short form; you'd loop
and copy. Why a copy instead of `headers.authorization = ...`? Because
`headers` belongs to the caller, and changing someone else's object
behind their back is how confusing bugs start.

Header names aren't case-sensitive, so `authorization` in lower case is
the same as curl's `Authorization`. We write them all in lower case,
which is how `fetch` stores them anyway.

A few things this method gets right without extra code:

- **The token is kept.** The second manifest request, or a layer
  download in Chapter 7, sends it straight away. There's no `401` round
  trip every time.
- **An expired token fixes itself.** Docker Hub's tokens last five
  minutes. When one runs out, the registry answers `401`, and that's
  exactly the case that fetches a new token and tries again.
- **An open registry costs nothing.** Microsoft's registry answers
  `200` on the first try, and the authenticator is never called.

### Fetching the manifest

Now a public method that uses it. The manifest's address is
`/v2/<repository>/manifests/<tag or digest>`. The scope asks to pull
from that repository. The `Accept` header lists the formats we'll
read. Add the list near the top of `registry.ts`:

```ts
// The manifest formats we can read, sent in the Accept header.
// Chapter 6 explains the four; for now, "any of these, please".
const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.docker.distribution.manifest.v2+json",
]
```

This chapter doesn't *read* the manifest. It gets it and hands it back
exactly as it arrived. Name that shape, below `ApiCheck`:

```ts
// A manifest as it arrived: not read or checked yet. That's Chapter 6.
export interface RawManifest {
  readonly mediaType: string // what the server says the bytes are
  readonly digest: string | null // the server's fingerprint, if it sent one
  readonly bytes: Uint8Array // the body, as raw bytes (like []byte in Go)
}
```

`digest` is `string | null` because the header may be missing, and
`headers.get` says so with `null`. We pass that on honestly instead of
inventing a value. `Uint8Array` is JavaScript's byte array, Go's
`[]byte` or Python's `bytes`. Bytes, not text, because Chapter 7 will
compute the checksum of these *exact* bytes. Turning them into text
and back could change them.

And the method, inside the class above `authorizedGet`:

```ts
  // reference is a tag ("latest") or a digest ("sha256:...").
  async fetchManifest(repository: string, reference: string): Promise<RawManifest> {
    const url = `${this.baseUrl}${repository}/manifests/${reference}`
    // The scope asks for exactly one thing: pull access to this repository.
    const response = await this.authorizedGet(url, `repository:${repository}:pull`, {
      accept: MANIFEST_TYPES.join(", "),
    })
    if (response.status !== 200) {
      throw new RegistryError(url, response.status, "unexpected status")
    }
    return {
      // ?? "": use an empty string if the header is missing.
      mediaType: response.headers.get("content-type") ?? "",
      digest: response.headers.get("docker-content-digest"),
      // arrayBuffer() reads the whole body; Uint8Array views it as bytes.
      bytes: new Uint8Array(await response.arrayBuffer()),
    }
  }
```

Notice what `fetchManifest` *doesn't* contain: anything about tokens.
It says "GET this, with permission to pull this repository," and
`authorizedGet` handles the rest. Chapter 7's layer download will be
the same: one call to `authorizedGet`, and no token logic of its own.

`registry.ts` now reads, top to bottom: imports,
`DOCKER_HUB_API_HOST`, `MANIFEST_TYPES`, `ApiCheck`, `RawManifest`,
`apiHost`, `RegistryError`, `challengeOf`, `RegistryClient`.

## Step 6: a fake that answers in turn

`replyingWith` gives the same reply to every call. `fetchManifest` on
Docker Hub makes two calls and needs two *different* replies: `401`,
then the manifest. So we need a fake that answers from a queue.

Vitest has this built in. `get.mockResolvedValueOnce(reply)` means
"the next call that hasn't been answered yet returns a Promise of
`reply`." Call it several times and the replies line up in order.

Add to `src/fake-http.ts`:

```ts
// A pretend HttpClient that gives back `responses` one per call, in order.
// `...responses` gathers every argument into one array, like *args in
// Python or ...Response in Go.
export function replyingInTurn(...responses: Response[]): FakeHttp {
  // No implementation: once the queued replies run out, get() returns
  // undefined and the code under test fails loudly.
  const get = vi.fn<HttpClient["get"]>()
  for (const response of responses) {
    // Queue this reply for the next call that hasn't been answered yet.
    get.mockResolvedValueOnce(response)
  }
  const http: HttpClient = { get }
  return { http, get }
}
```

**`...responses: Response[]`** is the same three dots as spread, used
the other way around. In a parameter list they *gather* all the
arguments into one array. `replyingInTurn(a, b, c)` makes `responses`
equal `[a, b, c]`. Go writes `...Response`, and Python writes `*args`.

### One reply per call, never shared

A `Response`'s body can be read **once**. After `.json()` or
`.arrayBuffer()`, it's used up. Reading it a second time fails:

```
TypeError: Body is unusable: Body has already been read
```

So a test must never hand the *same* `Response` object to two calls
that both read the body. The fix is small: write functions that make a
fresh reply each time they're called. Add these to `registry.test.ts`,
below the `checkApi` tests:

```ts
// The real Docker Hub challenge and manifest address, from the curl runs.
const challenge = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"'
const manifestURL = "https://registry-1.docker.io/v2/library/alpine/manifests/latest"

// A fresh 401 each call: a Response's body can only be read once,
// so replies are never shared between calls.
function unauthorized(): Response {
  return new Response(null, { status: 401, headers: { "www-authenticate": challenge } })
}

function manifest(): Response {
  return new Response("{}", {
    status: 200,
    headers: {
      "content-type": "application/vnd.oci.image.index.v1+json",
      "docker-content-digest": "sha256:abc",
    },
  })
}

// A pretend Authenticator that always hands out `token`.
function tokenGiving(token: string): Authenticator {
  return { token: vi.fn<Authenticator["token"]>(async () => token) }
}
```

(The `"{}"` body is enough. `fetchManifest` doesn't read the manifest
yet, it only counts the bytes.)

`tokenGiving` is `replyingWith`'s idea again, for an `Authenticator`:
a mock `token` that always answers the same, and records its calls.
Add `vi` back to the Vitest import, and `replyingInTurn` to the
`fake-http.ts` one.

### The tests

The main one plays the Docker Hub conversation:

```ts
describe("RegistryClient.fetchManifest", () => {
  it("gets a token after a 401 and tries again with it", async () => {
    // First call: 401. Second call: the manifest.
    const { http, get } = replyingInTurn(unauthorized(), manifest())
    const auth = tokenGiving("abc")

    const result = await new RegistryClient(http, "docker.io", auth).fetchManifest("library/alpine", "latest")

    expect(result.digest).toBe("sha256:abc")
    // The challenge was read and the right scope asked for.
    expect(auth.token).toHaveBeenCalledWith(
      { realm: "https://auth.docker.io/token", service: "registry.docker.io" },
      "repository:library/alpine:pull",
    )
    expect(get).toHaveBeenCalledTimes(2)
    // The 2nd call carried the token. objectContaining ignores other
    // headers (accept), so the test checks only what it's about.
    expect(get).toHaveBeenNthCalledWith(2, manifestURL, expect.objectContaining({ authorization: "Bearer abc" }))
  })
})
```

Three new checks:

- **`toHaveBeenCalledTimes(2)`**: exactly two calls. Not one (no retry)
  and not three (a loop).
- **`toHaveBeenNthCalledWith(2, ...)`**: what the *second* call was
  given. Counting starts at 1 here, not 0.
- **`expect.objectContaining({...})`**: "an object with *at least*
  these fields." The real headers also hold `accept`, and this test
  isn't about `accept`. Checking only what the test is about keeps it
  from breaking when an unrelated header changes.

> **Your turn.** Three more, in the same `describe`:
>
> 1. **Open registry.** One reply, the manifest. Use `neverAuth`, so the
>    test fails if a token is asked for. Check that `result.bytes.length`
>    is `2`, the two bytes of `"{}"`.
> 2. **Token reused.** Three replies: `401`, manifest, manifest. Call
>    `fetchManifest` twice on the *same* client. The authenticator is
>    called once, and the last `get` call carries the token
>    (`toHaveBeenLastCalledWith`).
> 3. **Token refused.** Two `401`s in a row. `fetchManifest` rejects
>    with `token was refused`.

Here they are:

```ts
  it("never asks for a token when the registry is open", async () => {
    const { http } = replyingInTurn(manifest())

    // neverAuth throws if called, so passing means no token was asked for.
    const result = await new RegistryClient(http, "docker.io", neverAuth).fetchManifest("library/alpine", "latest")

    expect(result.bytes.length).toBe(2) // the two bytes of "{}"
  })

  it("reuses the token on the next request", async () => {
    const { http, get } = replyingInTurn(unauthorized(), manifest(), manifest())
    const auth = tokenGiving("abc")
    const client = new RegistryClient(http, "docker.io", auth)

    await client.fetchManifest("library/alpine", "latest")
    await client.fetchManifest("library/alpine", "latest")

    expect(auth.token).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenLastCalledWith(manifestURL, expect.objectContaining({ authorization: "Bearer abc" }))
  })

  it("throws when the registry refuses the token", async () => {
    const { http } = replyingInTurn(unauthorized(), unauthorized())

    await expect(
      new RegistryClient(http, "docker.io", tokenGiving("abc")).fetchManifest("library/alpine", "latest"),
    ).rejects.toThrow("token was refused")
  })
```

#### What running out of replies looks like

In the token-reused test, try queueing only *two* replies,
`replyingInTurn(unauthorized(), manifest())`, and run the tests:

```
 FAIL  src/registry.test.ts > RegistryClient.fetchManifest > reuses the token on the next request
TypeError: Cannot read properties of undefined (reading 'status')
 ❯ RegistryClient.authorizedGet src/registry.ts:98:15
     96|   private async authorizedGet(url: string, scope: string, headers: Req…
     97|     const first = await this.http.get(url, this.withToken(headers))
     98|     if (first.status !== 401) {
       |               ^
     99|       return first
    100|     }
 ❯ RegistryClient.fetchManifest src/registry.ts:79:22
 ❯ src/registry.test.ts:123:5
```

The third call found the queue empty. `vi.fn()` with no implementation
returns `undefined`, and our code tripped over it on the very next
line. That's why `replyingInTurn` deliberately has *no* default
reply. If our code ever makes an extra call we didn't expect, the test
crashes and points at the line, instead of quietly getting some
made-up answer. Put the third reply back.

### The whole conversation, in one test

Every test so far faked the authenticator. One test should run the real
`AnonymousAuthenticator` *and* `RegistryClient` together, with one fake
`HttpClient` answering for both the registry and the token server.
Both classes take an `HttpClient`, so hand them the same one.

> **Your turn.** Queue three replies: `unauthorized()`, a token reply
> made with `Response.json`, and `manifest()`. Build the client with
> `new AnonymousAuthenticator(http)`. Call `fetchManifest`, then check
> there were three calls and the third carried `Bearer abc`. You'll
> need `AnonymousAuthenticator` in the import from `./auth.ts`, which
> means `type` moves inside the braces:
> `import { AnonymousAuthenticator, type Authenticator } from "./auth.ts"`.

Here it is:

```ts
  it("works end to end with the real authenticator", async () => {
    // One fake answers all three calls: the 401, the token server, the manifest.
    const { http, get } = replyingInTurn(unauthorized(), Response.json({ token: "abc" }), manifest())
    const client = new RegistryClient(http, "docker.io", new AnonymousAuthenticator(http))

    await client.fetchManifest("library/alpine", "latest")

    expect(get).toHaveBeenCalledTimes(3)
    expect(get).toHaveBeenNthCalledWith(3, manifestURL, expect.objectContaining({ authorization: "Bearer abc" }))
  })
```

That's the curl dance from the start of the chapter: three requests,
in order, token attached on the last. It runs without a network.

## Step 7: wire it into the program

Printing the manifest is its own small job, like `describeApiCheck`.
Three lines this time. Building them as an array and joining is easier
to read than one long string full of `\n`s. Add to `src/main.ts`,
below `describeApiCheck`:

```ts
// Three lines about the manifest. join("\n") glues the array into one
// string with a line break between items, like strings.Join in Go.
function describeManifest(manifest: RawManifest): string {
  return [
    `manifest   ${manifest.mediaType}`,
    `digest     ${manifest.digest ?? "(not sent)"}`,
    `size       ${manifest.bytes.length} bytes`,
  ].join("\n")
}
```

The `digest ?? "(not sent)"` is where the `string | null` from
`RawManifest` gets handled. The compiler wouldn't let us print it as if
it were always there.

Now `main`. One `FetchHttpClient`, handed to *both* the authenticator
and the registry client, since both just need to GET things. Change the
middle of the `try`:

```ts
    // One real HTTP client, shared: the registry and the token server
    // are both just addresses to GET.
    const http = new FetchHttpClient()
    const registry = new RegistryClient(http, ref.registry, new AnonymousAuthenticator(http))
    console.log(describeApiCheck(await registry.checkApi()))
    console.log(describeManifest(await registry.fetchManifest(ref.repository, target(ref))))
```

`target(ref)` from Chapter 3 is the tag or the digest, whichever the
user gave. That's exactly what goes after `/manifests/`.

> **Your turn.** Finish `main.ts`: import `AnonymousAuthenticator` and
> `AuthError` from `./auth.ts`, add `type RawManifest` to the
> `./registry.ts` import, and add `AuthError` to the errors the `catch`
> prints instead of re-throwing.

Here it is:

```ts
import { AnonymousAuthenticator, AuthError } from "./auth.ts"
import { FetchHttpClient } from "./http.ts"
import { InvalidReferenceError, parseReference, target } from "./reference.ts"
import { type ApiCheck, type RawManifest, RegistryClient, RegistryError } from "./registry.ts"

// ...

  } catch (err) {
    // Any of our own errors: print the message, exit 1.
    if (err instanceof InvalidReferenceError || err instanceof RegistryError || err instanceof AuthError) {
      console.error(err.message)
      return 1
    }
    throw err
  }
```

This is still the only place in the program that says
`new FetchHttpClient()` or `new AnonymousAuthenticator(...)`. When
password login arrives, this is the line that picks
`PasswordAuthenticator` instead. Nothing else changes.

```
$ npm run check
```

```
 Test Files  4 passed (4)
      Tests  36 passed (36)
```

## Try it

Docker Hub:

```
$ npm start --silent -- alpine ./rootfs
```

```
registry   docker.io
repository library/alpine
tag        latest
api        needs a token
challenge  Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
manifest   application/vnd.oci.image.index.v1+json
digest     sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
size       9218 bytes
would pull into ./rootfs
```

The same digest and size curl got by hand. (Your digest will differ.
`alpine:latest` is rebuilt every few weeks, and each rebuild is new
bytes with a new fingerprint.)

Microsoft's registry, which never asks:

```
$ npm start --silent -- mcr.microsoft.com/azurelinux/base/core:3.0 ./rootfs
```

```
registry   mcr.microsoft.com
repository azurelinux/base/core
tag        3.0
api        open, no token needed
manifest   application/vnd.docker.distribution.manifest.list.v2+json
digest     sha256:34a22db497ff34a0f35ca5fc54bd38711d04238a2c1b2f65d35dc9d45dd82584
size       858 bytes
would pull into ./rootfs
```

A different `content-type`: this is the older Docker name for the same
idea, a list of manifests per CPU. That's why we `Accept` four formats,
and Chapter 6 has to handle both.

GitHub's registry, with its placeholder scope on the front door:

```
$ npm start --silent -- ghcr.io/containerd/busybox:1.36 ./rootfs
```

```
registry   ghcr.io
repository containerd/busybox
tag        1.36
api        needs a token
challenge  Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/image:pull"
manifest   application/vnd.docker.distribution.manifest.list.v2+json
digest     sha256:7b3ccabffc97de872a30dfd234fd972a66d247c8cfc69b0550f276481852627c
size       2295 bytes
would pull into ./rootfs
```

It worked because we sent *our* scope, `repository:containerd/busybox:pull`,
not the `user/image` one from the challenge.

A tag that doesn't exist:

```
$ npm start --silent -- alpine:no-such-tag ./rootfs
```

```
registry   docker.io
repository library/alpine
tag        no-such-tag
api        needs a token
challenge  Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
https://registry-1.docker.io/v2/library/alpine/manifests/no-such-tag answered 404: unexpected status
```

A `404`, after the token. The repository exists, so we were allowed in,
and then the tag wasn't there.

And a repository that doesn't exist:

```
$ npm start --silent -- nosuchuser123/nosuchimage ./rootfs
$ echo $?
```

```
registry   docker.io
repository nosuchuser123/nosuchimage
tag        latest
api        needs a token
challenge  Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
https://registry-1.docker.io/v2/nosuchuser123/nosuchimage/manifests/latest answered 401: token was refused
1
```

Not `404`, but `401`, even with a fresh token. That's Docker Hub being
careful. If it said "no such repository" to strangers, anyone could
check whether a *private* repository exists by asking. So it gives the
same answer for "doesn't exist" and "not yours." Our "token was
refused" is accurate, but a user would find it unclear. Chapter 12's
tidy-up can add "(does the image exist? is it private?)" to that
message.

## What this chapter doesn't do

- **No password login.** Private images need a user name and password
  sent to the token server. That's a new `Authenticator`, and nothing
  else changes. That's the point of Step 3.
- **No `Basic` challenges.** A registry you run yourself with a
  password file asks for the password on every request, with no token
  server. `parseChallenge` rejects those with a clear message.
- **One token per client.** `RegistryClient` keeps a single token. A
  pull touches one repository, so that's enough. If you ever asked the
  same client about a second repository, its first try would get `401`
  (wrong scope), and `authorizedGet` would fetch a new token. So it
  still works; it's just one extra round trip.
- **The challenge parser is simple.** It handles what real registries
  send, not every corner of the standard.

## Commit

```
$ npm run check
$ git add -A
$ git commit -m "Fetch a token and the manifest"
```

## What you should now be able to answer

Try to answer each one in your own words first. Then open the answer to check.

**1. What three requests does it take to get a manifest from Docker Hub, and what does each one send and get back?**

<details>
<summary>Answer</summary>

1. **GET the manifest** with no token. You get back `401` plus a challenge naming `realm`, `service` and `scope`.
2. **GET the token server** (`realm`) with `?service=...&scope=...`. You get back JSON holding `token` (plus `expires_in`: 300 seconds).
3. **GET the manifest again**, with `Authorization: Bearer <token>` and an `Accept` list of formats. You get back `200`, the manifest bytes, and the `content-type` and `docker-content-digest` headers.

</details>

**2. What are `realm`, `service`, and `scope` in a challenge? Why do we build our own scope instead of using the challenge's?**

<details>
<summary>Answer</summary>

`realm` is the token server's address. `service` says which registry the token is for. `scope` is the permission being asked for, like `repository:library/alpine:pull`. We build our own because we already know which repository we want, while challenges can't be trusted to name it: the front door sends no scope at all, and GitHub's sends the placeholder `repository:user/image:pull`.

</details>

**3. Why did adding `headers?` to `HttpClient.get` break nothing, while adding `auth` to `RegistryClient`'s constructor broke six places?**

<details>
<summary>Answer</summary>

The `?` made `headers` *optional*: every existing one-argument call stayed valid, the fakes still had the right shape, and even `toHaveBeenCalledWith(url)` still matched. `auth` is *required*, so every existing `new RegistryClient(http, registry)` (five in tests, one in `main`) was now missing an argument. The compiler listed each one.

</details>

**4. What's the difference between a `Record<string, string>` and a `Map<string, string>`, and why do we use each where we do?**

<details>
<summary>Answer</summary>

A `Record<string, string>` is a plain object used as a lookup table. It's what `fetch` expects for headers, so `RequestHeaders` is one. A `Map` is a real lookup table with `get`/`set`, whose `get` clearly returns `undefined` for a missing key. Inside `parseChallenge`, nobody outside sees the table, so the clearer `Map` is used.

</details>

**5. Why is `Authenticator` an interface? What would adding password login change, and what would it leave alone? What's the name of that idea?**

<details>
<summary>Answer</summary>

So the *way* a token is fetched can change without touching the code that decides *when* one is needed. Password login means writing a new class, `PasswordAuthenticator implements Authenticator`, and choosing it in `main`. `RegistryClient` and `AnonymousAuthenticator` stay untouched. That's the **open/closed principle**, the "O" in SOLID: open to new behavior, closed to rewrites.

</details>

**6. Why is `body` typed `unknown` and not left as `any`? What does each of the four checks do?**

<details>
<summary>Answer</summary>

`response.json()` is typed `any`. Kept as `any`, `return body.token` would compile with no checks, and a reply without a token would pass `undefined` along typed as a `string`. `unknown` forces the checks:
1. `typeof body !== "object"` rules out strings, numbers and so on.
2. `body === null` is needed because `typeof null` is `"object"`.
3. `"token" in body` checks that the field exists.
4. `typeof body.token !== "string"` makes sure it's text.

</details>

**7. Why build the token address with `URL` instead of a template string?**

<details>
<summary>Answer</summary>

The scope contains `:` and `/`, which have special meanings in an address. `searchParams.set` escapes them (`%3A`, `%2F`) for us. `URL` also copes with a `realm` that already has a `?` in it.

</details>

**8. What does `...` mean in `{ ...headers }`, and what does it mean in `(...responses: Response[])`?**

<details>
<summary>Answer</summary>

In `{ ...headers }` it *spreads*: it copies every field of `headers` into a new object (like Python's `{**headers}`). In a parameter list it *gathers*: all the arguments are collected into one array (like Python's `*args` or Go's `...Response`).

</details>

**9. Why must a fake never give the same `Response` object to two calls?**

<details>
<summary>Answer</summary>

A `Response`'s body can be read only once. A second read fails with "Body is unusable: Body has already been read". So helpers like `unauthorized()` and `manifest()` build a fresh reply every time they're called.

</details>

**10. What does `mockResolvedValueOnce` do? Why does `replyingInTurn` have no default reply?**

<details>
<summary>Answer</summary>

It queues one reply for the next call that hasn't been answered yet, so calls get their replies in order. There's no default, so an unexpected extra call gets `undefined`. The code then crashes on the very next line and the test points straight at it, instead of quietly receiving a made-up answer.

</details>

**11. What does `neverAuth` check, and why doesn't it need to be a mock?**

<details>
<summary>Answer</summary>

It checks that the code under test never asks for a token (as with `checkApi`, or an open registry), because it throws if called. It records nothing, because there's nothing to inspect afterwards: being called at all is already the failure.

</details>

**12. Why does `objectContaining` make a test less likely to break for no reason?**

<details>
<summary>Answer</summary>

It checks only the fields you list (here `authorization`) and ignores the rest (like `accept`). If an unrelated header changes later, the test still passes, because it checks only what it's actually about.

</details>

**13. Why does a missing Docker Hub repository answer `401` and not `404`?**

<details>
<summary>Answer</summary>

If Docker Hub told strangers "no such repository", anyone could find out whether a *private* repository exists by asking. So it gives the same answer for "doesn't exist" and "not yours": the token doesn't grant access, and the retry gets `401` again.

</details>

## Next chapter

We have the manifest's bytes but haven't looked inside. Chapter 6
reads them, and the lesson is to trust nothing the server sends.
`JSON.parse` gives back `any`, the type that turns off type checking,
so a missing field shows up three functions later as a baffling
`undefined`. Step 3's four-line `if` showed how tedious checking by
hand is. `zod` lets you describe the shape once and get back either a
value you can trust or an error that names the bad field. You also saw
that one address can return two different kinds of manifest: an index
(one per CPU) or a single image manifest. Chapter 6 tells them apart
and picks the entry for your CPU.
