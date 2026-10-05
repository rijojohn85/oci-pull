# Chapter 4: The First Call to the Registry

Chapter 3 turned `alpine` into `docker.io/library/alpine:latest`
without touching the network. This chapter makes the program talk to a
real registry for the first time. It knocks on the front door, `/v2/`,
and reports what it hears back.

That's a small amount of work, but it raises the question the rest of
the book depends on: **how do you test code that talks to the
internet, without the internet?** The answer is a pattern you met in
miniature with the clock in Chapter 2.5 section 8. By the end of this
chapter it's real code, with real tests, that run in milliseconds with
the network unplugged.

New in this chapter: `fetch`, Node's built-in way to make an HTTP
request; `async`/`await` in real code; and your first *mock*, a pretend
function that also records how it was called.

## What the front door says

Chapter 1 showed that every registry answers on `/v2/`. Here's what
four real registries say when you knock without a token. `-D -` prints
the reply's headers, and `-o /dev/null` throws away the body:

```
$ curl -sS -o /dev/null -D - https://registry-1.docker.io/v2/
```

```
HTTP/2 401
docker-distribution-api-version: registry/2.0
www-authenticate: Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
```

```
$ curl -sS -o /dev/null -D - https://ghcr.io/v2/
```

```
HTTP/2 401
docker-distribution-api-version: registry/2.0
www-authenticate: Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/image:pull"
```

```
$ curl -sS -o /dev/null -D - https://mcr.microsoft.com/v2/
```

```
HTTP/2 200
docker-distribution-api-version: registry/2.0
```

(Headers trimmed to the ones that matter. The rest are dates and
caching hints.)

Three things to take from this:

- **`200` means "come in."** Microsoft's registry lets anyone read
  public images without a token.
- **`401` means "not without a token"**, and the reply says where to get
  one. That's the `www-authenticate` header. Remember from Chapter 1
  that a header is a `name: value` line sent along with the reply. This
  one is called a *challenge*: "prove who you are, and here's the
  address to ask." Chapter 5 reads it and fetches the token. This
  chapter only needs to notice it's there.
- **Anything else is a surprise**, and we should say so clearly
  rather than carry on.

One more detail. Notice the first command called
`registry-1.docker.io`, not `docker.io`. That's because `docker.io` is
the name people *type*. The API lives somewhere else. Ask `docker.io`
directly and you're sent to Docker's website:

```
$ curl -sS -o /dev/null -D - https://docker.io/v2/
```

```
HTTP/2 302
location: https://www.docker.com/v2/
```

`302` means "look over there instead." So our code needs one small
translation: `docker.io` → `registry-1.docker.io`. Every other registry
serves its API under its own name.

## The problem with testing this

The obvious way to write this is a function that calls `fetch` (Node's
built-in "make an HTTP request") and looks at the answer. It would work.
But think about its tests:

- They need the internet. No Wi-Fi on the train means no tests.
- They're slow. Each call costs a real round trip.
- They break when Docker Hub has a bad day, even though your code
  didn't change.
- And some answers can't be produced on demand. How would you test
  "the server said `401` but forgot the challenge header"? You'd have
  to find a broken registry.

The fix is the same trick as the clock in Chapter 2.5: **the code that
talks to the registry doesn't make its own HTTP client. It's handed
one.** In the program, you hand it the real one. In a test, you hand
it a pretend one that answers whatever the test needs.

There's a name for this idea. Code should depend on a *description* of
what it needs (an interface), not on one particular thing that does it
(`fetch`). It's called the **dependency inversion principle**, the "D"
in SOLID. It's the reason faking is possible at all, and it'll come back
in every chapter that touches the network, the disk, or the clock.

## Step 1: describe what we need from HTTP

What does registry code actually need? For now, one thing: "GET this
URL and give me the reply." So the description has exactly one method.

Create `src/http.ts`:

```ts
// The one thing our code needs from HTTP: "GET this URL, give me the reply."
// Code that talks to a registry asks for an HttpClient; it never calls
// fetch itself. That's what lets a test hand it a pretend one.
export interface HttpClient {
  // Response is the reply type built into Node (same as in browsers).
  // It holds the status code, the headers, and a body we can read later.
  get(url: string): Promise<Response>
}

// The real client: a thin wrapper around Node's built-in fetch.
export class FetchHttpClient implements HttpClient {
  // `async` makes this method return a Promise (a box that holds the
  // reply once it arrives). fetch already returns one, so we pass it on.
  async get(url: string): Promise<Response> {
    return fetch(url)
  }
}
```

A few things worth slowing down for.

**`fetch` and `Response` are built in.** No import needed, and no
package to install. Node ships the same `fetch` that browsers have.
`fetch(url)` sends the request and returns a *Promise* of a `Response`.
A quick reminder from Chapter 2.5 section 6: a Promise is a box that
holds a value *later*, and `await` opens the box, pausing only the
function that awaits.

**The interface returns the real `Response` type**, not one we made up.
That's on purpose. The real client stays a one-liner, and a test can
build a reply with `new Response(...)`, which is the same class `fetch`
itself returns. We'll see that in the tests.

**`implements HttpClient` is a promise to the compiler.** Remember that
TypeScript checks shape, not names (Chapter 2.5 section 1), so a class
would fit the interface even without the word `implements`. Writing it
makes the compiler check the class right here, instead of at the first
place someone uses it.

**The interface has one method**, not every HTTP method under the sun.
Keep a description as small as what its users really need, so fakes
stay small too. (That's the "I" in SOLID, *interface segregation*,
though the plain version is "don't ask for more than you use.") When
Chapter 5 needs to send headers, we'll widen it then.

## Step 2: one name, one place

The new code needs to know when a registry is Docker Hub. Chapter 3
already has that string: `DEFAULT_REGISTRY = "docker.io"` in
`reference.ts`. Typing `"docker.io"` again in a new file would be two
copies of one fact, and one day only one of them would get changed.
That's the "don't repeat yourself" rule, DRY: each fact lives in one
place.

> **Your turn.** Make `DEFAULT_REGISTRY` importable from other files.
> One word in `src/reference.ts`.

Here's the change:

```ts
/** Default registry used when none is specified (Docker Hub). */
// `export` lets other files import it. Nothing else changes.
export const DEFAULT_REGISTRY = "docker.io"
```

## Step 3: where the API lives

Create `src/registry.ts` and start it with the translation from
earlier:

```ts
// `import type` brings in a type only. It is erased when the program
// runs, so this file has no run-time link to http.ts at all.
import type { HttpClient } from "./http.ts"
import { DEFAULT_REGISTRY } from "./reference.ts"

// People type "docker.io", but Docker Hub's API lives on another host.
const DOCKER_HUB_API_HOST = "registry-1.docker.io"

// Turn the registry name from an image reference into the host to call.
export function apiHost(registry: string): string {
  return registry === DEFAULT_REGISTRY ? DOCKER_HUB_API_HOST : registry
}
```

`import type` came up in Chapter 2.5 section 7. It imports something
that only exists for the compiler. `HttpClient` is an interface, and
interfaces vanish when the program runs (types are labels, and labels
get stripped). So this line disappears entirely at run time, and the
setting `verbatimModuleSyntax` from Chapter 2 insists we say so.

## Step 4: two possible answers

`/v2/` can answer in two ways we understand: "come in," or "you need a
token, ask here." When a value can be one of a few shapes, Chapter 3's
tool for it is a union with a `kind` field. Each shape carries a
`kind` with a fixed string, and checking `kind` tells both you and the
compiler which shape you have.

> **Your turn.** Add an exported type `ApiCheck` to `registry.ts`.
> It's either `{ kind: "open" }` or
> `{ kind: "needs-token" }` plus a `challenge` string holding the
> `www-authenticate` value. Only the second shape has `challenge`.

Here's one way to write it:

```ts
// What the front door (/v2/) told us: one of two answers.
// `kind` tells them apart, like Reference in Chapter 3.
export type ApiCheck =
  | { kind: "open" } // 200: come in, no token needed
  | { kind: "needs-token"; challenge: string } // 401: here's where to ask
```

The shapes are written right inside the union this time, rather than as
two named interfaces like `TaggedReference` and `DigestedReference`.
Both work. Named interfaces pay off when other code refers to one shape
by name. Nobody will here, so inline keeps it short.

Why not one shape, `{ open: boolean; challenge?: string }`? Because
then `{ open: true, challenge: "..." }` would be allowed, and so would
`{ open: false }` with no challenge. Both are nonsense. With the union,
the compiler rejects them.

## Step 5: an error of our own

When the registry says something we don't understand, like `404` or
`500`, we throw. As in Chapter 3, we throw our own error class, not a
plain `Error`, so the caller can tell *our* "the registry said no"
apart from a real bug with `instanceof`.

> **Your turn.** Add a `RegistryError` class to `registry.ts`. It
> extends `Error` and keeps the `url` it called and the `status`
> number it got back, both `readonly`. The message should read like
> `https://example.com/v2/ answered 404: unexpected status`, so take a
> third constructor argument for the last part. Set `this.name` like
> `InvalidReferenceError` does.

Here it is:

```ts
// Thrown when the registry answers something we don't understand.
export class RegistryError extends Error {
  // readonly: set once in the constructor, never changed after.
  readonly url: string
  readonly status: number

  constructor(url: string, status: number, problem: string) {
    // super(...) runs Error's own constructor, which stores the message.
    super(`${url} answered ${status}: ${problem}`)
    // Shows up in stack traces instead of the generic "Error".
    this.name = "RegistryError"
    this.url = url
    this.status = status
  }
}
```

Same pattern as `InvalidReferenceError`: extend `Error`, pass a
message up with `super`, and keep the details as fields so code that
catches it can look at them, not just at the text.

## Step 6: the client

Now the class that actually knocks. It needs two things to do its job:
an HTTP client, and which registry to talk to. It *asks* for both in
its constructor and keeps them. That's exactly how `Stopwatch` took a
`Clock` in Chapter 2.5.

Reminders, since this is the first real class in the project:

- Fields are declared in the class body, then assigned in the
  constructor. The one-line shortcut
  `constructor(private readonly http: HttpClient)` is ruled out by
  `erasableSyntaxOnly` from Chapter 2, because Node can't strip it.
- `private` means only code inside the class can see the field.
- An `async` method returns a Promise. Inside it, `await` pauses *this
  method only* until the reply arrives. Nothing else is blocked, since
  there's one thread and it goes off to do other work.

> **Your turn.** Add a `RegistryClient` class to `registry.ts`.
>
> - Its constructor takes `http: HttpClient` and `registry: string`.
>   Keep the client in a `private readonly` field. Work out the base
>   URL once, `https://<apiHost>/v2/`, and keep that too.
> - One method, `async checkApi(): Promise<ApiCheck>`. It GETs the
>   base URL and then:
>   - on `200`, returns `{ kind: "open" }`
>   - on `401`, reads the `www-authenticate` header with
>     `response.headers.get("www-authenticate")` and returns
>     `needs-token` with it. `headers.get` returns `null` when the
>     header is missing, so throw a `RegistryError` in that case.
>   - on anything else, throws a `RegistryError`.
>
> `response.status` is the number (`200`, `401`, ...).

Here it is:

```ts
// Talks to one registry. It is *given* an HttpClient instead of calling
// fetch, so tests can pass a pretend one.
export class RegistryClient {
  private readonly http: HttpClient
  // Worked out once, here, instead of in every method.
  private readonly baseUrl: string

  constructor(http: HttpClient, registry: string) {
    this.http = http
    this.baseUrl = `https://${apiHost(registry)}/v2/`
  }

  // Knock on the front door and report what the registry said.
  async checkApi(): Promise<ApiCheck> {
    // await pauses this method (only this one) until the reply arrives.
    const response = await this.http.get(this.baseUrl)

    if (response.status === 200) {
      return { kind: "open" }
    }
    if (response.status === 401) {
      // headers.get gives `string | null`: the header may be missing.
      const challenge = response.headers.get("www-authenticate")
      if (challenge === null) {
        throw new RegistryError(this.baseUrl, 401, "no www-authenticate header")
      }
      // After the null check, challenge is a plain string.
      return { kind: "needs-token", challenge }
    }
    throw new RegistryError(this.baseUrl, response.status, "unexpected status")
  }
}
```

Three things to notice.

**`headers.get` returns `string | null`.** It's the built-in type, and
it's honest: a header may not be there. Try deleting the `null` check
and returning `challenge` anyway:

```
src/registry.ts(60,37): error TS2322: Type 'string | null' is not assignable to type 'string'.
  Type 'null' is not assignable to type 'string'.
```

The `if (challenge === null)` check is what makes the rest work. After
it, the compiler knows `challenge` is a plain `string`. This is
*narrowing* again, from Chapter 2.5 section 3: an ordinary `if` that
shrinks a type. (And `===`, never `==`, as in that same section.)

**Nothing here says `fetch`.** `RegistryClient` has no idea whether it's
talking to Docker Hub or to a test. It knows the `HttpClient` shape and
nothing more. That's dependency inversion, the "D" from earlier, now in
real code.

**`{ kind: "needs-token", challenge }` is short for
`{ kind: "needs-token", challenge: challenge }`.** When a field and a
variable share a name, you write it once. Go has no equivalent, and
Python's closest is `dict(challenge=challenge)`.

### The finished file, in order

`registry.ts` now reads, top to bottom: the two imports,
`DOCKER_HUB_API_HOST`, `apiHost`, `ApiCheck`, `RegistryError`,
`RegistryClient`. Small pieces first, then the thing built from them.

## Step 7: tests with a pretend HTTP client

Here's the new tool. Vitest has a helper, `vi.fn`, that makes a
**mock**: a pretend function that does whatever you tell it, *and*
records every call made to it (which arguments, how many times). Tests
can then ask "was this called, and with what?"

A mock is a fake that takes notes. We need both halves here. The fake
part lets us choose the registry's answer. The notes let us check
which URL our code asked for.

Create `src/registry.test.ts`:

```ts
// vi is Vitest's toolbox for pretend things; vi.fn makes a pretend function.
// Mock is the type of such a pretend function; `type` marks it as a
// type only, erased when the program runs.
import { describe, expect, it, type Mock, vi } from "vitest"
import type { HttpClient } from "./http.ts"
import { RegistryClient, RegistryError } from "./registry.ts"

// What replyingWith hands back: a pretend HttpClient to give to the
// code under test, and its `get` to ask afterwards what it was called with.
interface FakeHttp {
  http: HttpClient
  get: Mock<HttpClient["get"]>
}

// Build a pretend HttpClient whose get() always returns `response`.
function replyingWith(response: Response): FakeHttp {
  // HttpClient["get"] means "the type of HttpClient's get method",
  // so the pretend function must take and return the same things.
  const get = vi.fn<HttpClient["get"]>(async () => response)
  // { get } is short for { get: get }. It has the shape of an
  // HttpClient, and shape is all TypeScript checks.
  const http: HttpClient = { get }
  return { http, get }
}

describe("RegistryClient.checkApi", () => {
  // The test function is async, so it can await. Vitest waits for it.
  it("reports open when the registry answers 200", async () => {
    // A real Response object, built by hand: no body, status 200.
    const { http } = replyingWith(new Response(null, { status: 200 }))

    const result = await new RegistryClient(http, "mcr.microsoft.com").checkApi()

    expect(result).toEqual({ kind: "open" })
  })
})
```

Read `replyingWith` slowly. It's the whole trick.

- `vi.fn(async () => response)` makes a function that, whatever it's
  called with, returns a Promise of `response`. It's `async` because
  `HttpClient.get` returns a Promise.
- The `<HttpClient["get"]>` in angle brackets tells `vi.fn` which
  function it's pretending to be. `HttpClient["get"]` reads as "the
  type of the `get` method on `HttpClient`," the same square brackets
  you'd use to pull a field out of an object, applied to a type. Now if
  `HttpClient.get` ever changes, this line stops compiling instead of
  quietly drifting apart from it.
- `{ get }` is an object with one field, `get`. That's an `HttpClient`,
  because it has the right shape (Chapter 2.5 section 1 again). No
  class needed, and no `implements`.
- `new Response(null, { status: 200 })` builds a reply by hand: no
  body, status `200`. It's the same `Response` class that `fetch`
  returns, so `RegistryClient` can't tell the difference.

### The angle brackets, `<...>`

`<...>` isn't an operator. Nothing in it runs. It's a **blank in a type,
filled in**. Some types are only half-finished on their own. "A Promise"
of *what*? "A pretend function" pretending to be *which* function? The
angle brackets hold the answer. Chapter 2.5 section 9 called these
*generics*; here they are in real code.

You've seen them in two places, and they mean the same thing in both:

```ts
// 1. After a type name: fill in the type's blank.
//    "A Promise that will hold a Response."
get(url: string): Promise<Response>
//    "A pretend function, pretending to be HttpClient's get."
get: Mock<HttpClient["get"]>

// 2. After a function name, in a call: fill in the function's blank.
//    "vi.fn, make me a pretend version of HttpClient's get."
vi.fn<HttpClient["get"]>(async () => response)
```

Your other languages have the same thing with different brackets. Go
writes `[]` (`func First[T any](items []T) T`, called as `First[int](...)`). Python also
uses `[]` (`list[str]`, `dict[str, int]`). TypeScript uses `<>`.

**Most of the time you don't write them.** TypeScript fills the blank
from what you pass. `first([1, 2, 3])` in Chapter 2.5 worked out
`T = number` by itself. You write `<...>` when it would guess too
little. `vi.fn` is exactly that case. Given only
`async () => response`, it sees a function that takes *nothing*, so it
fills the blank with "a function of no arguments." Two things go wrong:

- **The pretend function's notes become useless.** `get.mock.calls[0]`
  (the arguments of the first call) would be typed as an empty list, so
  reading the URL out of it fails:

  ```
  error TS2493: Tuple type '[]' of length '0' has no element at index '0'.
  ```

  With `<HttpClient["get"]>`, it's typed as `[url: string]`.
- **A wrong pretend reply isn't caught where you wrote it.** With the
  brackets, returning something that isn't a `Response` is flagged on
  the `vi.fn` line itself:

  ```
  error TS2345: Argument of type '() => Promise<string>' is not assignable to parameter of type '(url: string) => Promise<Response>'.
    Type 'Promise<string>' is not assignable to type 'Promise<Response>'.
      Type 'string' is not assignable to type 'Response'.
  ```

  Read the message top down. It names what you gave, then what was
  wanted, and then narrows it down to the actual mismatch: `string`
  where a `Response` should be.

So the brackets say "this is what I'm pretending to be." The compiler
then holds the pretend function to it, and types its notes to match.

One last thing, so it's never confusing: `<` and `>` still mean "less
than" and "greater than" in ordinary expressions like `a < b`. Where
they sit tells you which. Right after a type name or function name,
they're a blank being filled in.

**The return type, `FakeHttp`.** TypeScript could work out what
`replyingWith` returns on its own, from the `return { http, get }` line.
We write it anyway, for two reasons. First, the reader sees what comes
back without reading the body. Second, if the body ever changes by
mistake, the compiler flags the function itself instead of some test
further down. `Mock<HttpClient["get"]>` is Vitest's type for "a pretend
version of `HttpClient`'s `get`." It's what `vi.fn<HttpClient["get"]>`
makes, and it has the call-recording parts (`toHaveBeenCalledWith`
reads them) on top of being callable like the real `get`.

The return type is a named interface rather than written inline after
the `)`, because
`{ http: HttpClient; get: Mock<HttpClient["get"]> }` crammed onto the
function's first line is hard to read. Naming it also documents it.

This book writes a return type on every function from here on, even
small helpers. It costs a few words and removes a guess.

Run it:

```
$ npm test
```

It passes. Nothing left your machine.

> **Your turn.** Add a test that the registry answering `401` with a
> `www-authenticate` header gives back `needs-token` with that exact
> challenge. `new Response` takes headers as a plain object:
> `{ status: 401, headers: { "www-authenticate": challenge } }`.

Here it is, inside the `describe`:

```ts
  it("reports needs-token with the challenge when it answers 401", async () => {
    // The real challenge Docker Hub sent us, copied from curl above.
    const challenge = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"'
    const { http } = replyingWith(
      new Response(null, { status: 401, headers: { "www-authenticate": challenge } }),
    )

    const result = await new RegistryClient(http, "docker.io").checkApi()

    // { kind, challenge } shorthand again: the field has the variable's name.
    expect(result).toEqual({ kind: "needs-token", challenge })
  })
```

### Checking what our code asked for

So far the mock only *answered*. Now use its notes. The interesting
logic is `apiHost`: did `docker.io` really turn into
`registry-1.docker.io`? `expect(get).toHaveBeenCalledWith(url)` asks
the mock "were you ever called with exactly this?"

We want to check three registries the same way, which is a job for
`it.each` from Chapter 3. It takes a table of rows and runs one test
per row, and `$name` in the title is filled in from each row.

> **Your turn.** Write an `it.each` over three rows, `docker.io`,
> `ghcr.io` and `localhost:5000`, each paired with the URL it should
> call. Each test answers `200` and awaits `checkApi()`, then checks
> `get` with `toHaveBeenCalledWith`.

Here it is:

```ts
  // it.each runs the same test once per row; $registry fills the name.
  it.each([
    { registry: "docker.io", url: "https://registry-1.docker.io/v2/" },
    { registry: "ghcr.io", url: "https://ghcr.io/v2/" },
    { registry: "localhost:5000", url: "https://localhost:5000/v2/" },
  ])("calls $url for $registry", async ({ registry, url }) => {
    const { http, get } = replyingWith(new Response(null, { status: 200 }))

    await new RegistryClient(http, registry).checkApi()

    // Did our code ask for the right URL? The pretend function recorded it.
    expect(get).toHaveBeenCalledWith(url)
  })
```

`({ registry, url })` pulls two fields out of the row by name. It's the
same "take things out of a value" syntax as `const [image, outputDir] =
argv` in `main.ts`, but with `{}` for fields instead of `[]` for
positions.

#### What a mock failure looks like

To see the notes pay off, break `apiHost` on purpose. Make it
`return registry`, forgetting the Docker Hub case, and run the tests:

```
 FAIL  src/registry.test.ts > RegistryClient.checkApi > calls https://registry-1.docker.io/v2/ for docker.io
AssertionError: expected "vi.fn()" to be called with arguments: [ 'https://registry-1.docker.io/v2/' ]

Received:

  1st vi.fn() call:

  [
-   "https://registry-1.docker.io/v2/",
+   "https://docker.io/v2/",
  ]


Number of calls: 1
```

The mock shows what it expected (`-`) next to what it actually got
(`+`). That's the bug, spelled out, and no network was involved.
Put `apiHost` back.

### Testing that something throws, when it's async

In Chapter 3, `expect(() => parseReference("")).toThrow(...)` wrapped
the call in a function, so `expect` could call it and catch what it
threw. An `async` function doesn't throw that way. It returns a Promise
right away, and the Promise *rejects* later (fails, holding the error).
So the check is different:

```ts
  it("throws RegistryError when a 401 has no challenge", async () => {
    // A 401 with no www-authenticate header: a broken registry, on demand.
    const { http } = replyingWith(new Response(null, { status: 401 }))

    // .rejects waits for the promise to fail, then checks the error.
    // The promise must be awaited, or the test ends before it fails.
    await expect(new RegistryClient(http, "docker.io").checkApi()).rejects.toThrow(
      "no www-authenticate header",
    )
  })
```

Two differences from Chapter 3. You pass the Promise itself (no
wrapping function), and you put `.rejects` before `.toThrow`, which
means "wait for this to fail, then check the error." And the whole
line is `await`ed.

That `await` matters. Leave it off and Vitest catches you:

```
 FAIL  src/registry.test.ts > RegistryClient.checkApi > throws RegistryError when a 401 has no challenge
Error: Promise returned by `expect(actual).rejects.toThrow(expected)` was not awaited. This assertion is asynchronous and must be awaited; otherwise, it is not guaranteed to complete before the test finishes:

await expect(actual).rejects.toThrow(expected)
```

Without the `await`, the test function would finish (and pass) before
the Promise ever got a chance to fail. Vitest now refuses to let that
slide. Older test runners didn't, and tests like that passed for years
while checking nothing.

This is also the "broken registry, on demand" from earlier. A `401`
with no challenge header is hard to find in the wild. Here it's one
line.

> **Your turn.** Last test: `checkApi` throws a `RegistryError` for
> any status it doesn't know. Use `it.each([404, 500])`. For a list of
> plain values, the title uses `%i` (an integer) instead of `$name`.
> This time pass the *class* `RegistryError` to `toThrow`, which
> checks the error's type instead of its message.

Here it is:

```ts
  // One test per status. %i in the title is replaced by the number.
  it.each([404, 500])("throws RegistryError on status %i", async (status) => {
    // { status } is short for { status: status }.
    const { http } = replyingWith(new Response(null, { status }))

    // toThrow(SomeClass) passes if the error is an instance of that class.
    await expect(new RegistryClient(http, "example.com").checkApi()).rejects.toThrow(
      RegistryError,
    )
  })
```

Now `npm test`:

```
 Test Files  3 passed (3)
      Tests  23 passed (23)
```

Seven new tests covering every branch of `checkApi`, including one a
real registry would almost never give you, all without a single
network call.

## Step 8: wire it into the program

`main` now has to wait on the network. That means it becomes
`async`, and, as Chapter 2.5 warned, `async` spreads upward. Whoever
calls `main` must `await` it too.

First, the printing. Turning an `ApiCheck` into a line of text is its
own small job, so it gets its own small function. It's the same kind
of job as `target()` in Chapter 3: a `switch` on `kind` with a `case`
for each shape, and no `default`. That last part is what lets the
compiler complain if a third kind is ever added and forgotten here.

> **Your turn.** In `src/main.ts`, write
> `describeApiCheck(check: ApiCheck): string`. For `open` it returns
> `api        open, no token needed`. For `needs-token` it returns two
> lines, `api        needs a token` then `challenge  <the challenge>`.
> `\n` inside a string is a line break.

Here it is:

```ts
// One line of output for each kind of answer. The switch has no
// default: add a third kind to ApiCheck and this stops compiling.
function describeApiCheck(check: ApiCheck): string {
  switch (check.kind) {
    case "open":
      return "api        open, no token needed"
    case "needs-token":
      // Inside this case, the compiler knows check has `challenge`.
      return `api        needs a token\nchallenge  ${check.challenge}`
  }
}
```

Now the rest of `src/main.ts`. The changes are the imports, `async`,
the `Promise<number>` return type, two new lines in the middle, and one
more error class in the `catch`:

```ts
import { FetchHttpClient } from "./http.ts"
import { InvalidReferenceError, parseReference, target } from "./reference.ts"
// `type ApiCheck` inside the braces: this one name is a type only and
// gets erased; the other two are real values kept at run time.
import { type ApiCheck, RegistryClient, RegistryError } from "./registry.ts"

export function usage(): string {
  return "usage: oci-pull <image> <output-dir>"
}

// describeApiCheck from above goes here.

// Now `async`: it waits on the network, so it returns Promise<number>.
export async function main(argv: string[]): Promise<number> {
  const [image, outputDir] = argv
  if (image === undefined || outputDir === undefined) {
    console.error(usage())
    return 2
  }

  try {
    const ref = parseReference(image)
    console.log(`registry   ${ref.registry}`)
    console.log(`repository ${ref.repository}`)
    console.log(`${ref.kind === "tag" ? "tag       " : "digest    "} ${target(ref)}`)

    // The only place that picks the *real* HTTP client. Everything
    // below this line just uses whatever it was given.
    const registry = new RegistryClient(new FetchHttpClient(), ref.registry)
    console.log(describeApiCheck(await registry.checkApi()))

    console.log(`would pull into ${outputDir}`)
    return 0
  } catch (err) {
    // Either of our own errors: print the message, exit 1.
    if (err instanceof InvalidReferenceError || err instanceof RegistryError) {
      console.error(err.message)
      return 1
    }
    throw err
  }
}
```

The `import { type ApiCheck, ... }` line mixes a type and two values in
one import. Chapter 2.5 section 7 had `import type { ... }` for a line
that's *all* types. Putting `type` in front of a single name does the
same thing for just that name.

Notice where `new FetchHttpClient()` is: in `main`, not in
`RegistryClient`. `main` is where the program decides which real
pieces to use and hands them to the pieces that need them.
Chapter 10 makes this the job of one file. For now, it's one line.

### The `await` that `async` spreads to

`main` returns `Promise<number>` now, not `number`. Leave `cli.ts` as it
was and run the type check:

```
$ npm run typecheck
```

```
src/cli.ts(2,1): error TS2322: Type 'Promise<number>' is not assignable to type 'string | number | null | undefined'.
```

That's the forgotten-`await` bug from Chapter 2.5 section 6, caught.
`process.exitCode` wants a number, and it's being handed the box the
number will arrive in. Without the type check, Node would try to use a
Promise as an exit code.

Fix `src/cli.ts`:

```ts
import { main } from "./main.ts"

// await at the top level of a file: allowed in modules. Node waits for
// main to finish, then exits with the code it returned.
process.exitCode = await main(process.argv.slice(2))
```

`await` outside any function is allowed in a module, which our project
is, thanks to `"type": "module"` in `package.json` from Chapter 2. In
Go terms, it's `main()` blocking until the work is done, which is what
you'd expect anyway.

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
would pull into ./rootfs
```

Our program asked `registry-1.docker.io`, not `docker.io`, and got back
the same challenge curl did.

Microsoft's registry, which needs no token:

```
$ npm start --silent -- mcr.microsoft.com/azurelinux/base/core:3.0 ./rootfs
```

```
registry   mcr.microsoft.com
repository azurelinux/base/core
tag        3.0
api        open, no token needed
would pull into ./rootfs
```

A host that isn't a registry at all:

```
$ npm start --silent -- example.com/foo ./rootfs
$ echo $?
```

```
registry   example.com
repository foo
tag        latest
https://example.com/v2/ answered 404: unexpected status
1
```

That's our `RegistryError`: caught in `main`, message printed, exit
code `1`.

### When the network itself fails

One more, a host that doesn't exist:

```
$ npm start --silent -- nosuch.invalid/foo ./rootfs
```

```
registry   nosuch.invalid
repository foo
tag        latest
node:internal/deps/undici/undici:13510
      Error.captureStackTrace(err);
            ^

TypeError: fetch failed
    at node:internal/deps/undici/undici:13510:13
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)
    at async RegistryClient.checkApi (file:///.../src/registry.ts:51:22)
    at async main (file:///.../src/main.ts:40:34)
    at async file:///.../src/cli.ts:5:20 {
  [cause]: Error: getaddrinfo ENOTFOUND nosuch.invalid
      ...
    code: 'ENOTFOUND',
    hostname: 'nosuch.invalid'
  }
}
```

A loud crash, and on purpose. `fetch` couldn't even find the host, so
it threw (`ENOTFOUND` is "no such name"). That isn't one of *our*
errors, so `main` re-threw it, as Chapter 3 decided: never hide an
error you don't understand.

Two things are worth reading in that trace. First, the `at async ...`
lines. The error started deep inside `fetch`, then came back out
through every `await`: `checkApi`, then `main`, then `cli.ts`. That's
Chapter 2.5's rule in action. When an awaited Promise fails, the
`await` re-throws, so `try`/`catch` works across `await`s exactly like
across normal calls. Second, `[cause]`. `fetch` wraps the real reason
(the DNS lookup failed) inside its own `TypeError`. A friendly message
for this case is part of Chapter 12's tidy-up.

## Commit

```
$ npm run check
$ git add -A
$ git commit -m "Knock on the registry's front door"
```

## What you should now be able to answer

Try to answer each one in your own words first. Then open the answer to check.

**1. What does `/v2/` answer on Docker Hub, and on Microsoft's registry? What does each answer mean?**

<details>
<summary>Answer</summary>

Docker Hub answers `401` with a `www-authenticate` challenge: "not without a token, and here's where to get one". Microsoft's registry answers `200`: "come in, no token needed for public images".

</details>

**2. Why does our code call `registry-1.docker.io` when the user typed `docker.io`?**

<details>
<summary>Answer</summary>

`docker.io` is the name people *type*, but Docker Hub's API lives on `registry-1.docker.io`. Asking `docker.io/v2/` gets a `302` redirect to Docker's website. `apiHost` makes that one translation. Every other registry serves its API under its own name.

</details>

**3. What's wrong with a test that calls the real Docker Hub?**

<details>
<summary>Answer</summary>

It needs the internet, it's slow, and it fails when Docker Hub has a bad day even though your code didn't change. It also can't produce rare answers on demand, like a `401` with no challenge header.

</details>

**4. Why does `RegistryClient` take an `HttpClient` in its constructor instead of calling `fetch`? What's the name for that idea?**

<details>
<summary>Answer</summary>

So the program can hand it the real client and a test can hand it a pretend one. `RegistryClient` can't tell the difference. It depends on a description (the interface), not on one particular thing (`fetch`). That's the **dependency inversion principle**, the "D" in SOLID.

</details>

**5. Why does `HttpClient` have one method and not five?**

<details>
<summary>Answer</summary>

Because the registry code needs only "GET this URL". A description should be as small as what its users really need, so fakes stay small too. That's the "I" in SOLID, interface segregation: don't ask for more than you use. It can grow when a real need appears, as it does in Chapter 5.

</details>

**6. Why does `HttpClient.get` return the built-in `Response` instead of a type of our own?**

<details>
<summary>Answer</summary>

The real client stays a one-liner (`return fetch(url)`). Tests can also build a reply with `new Response(...)`, which is the very class `fetch` returns, so the code under test can't tell a fake reply from a real one.

</details>

**7. What's the difference between a fake and a mock? What does `toHaveBeenCalledWith` check?**

<details>
<summary>Answer</summary>

A fake is a pretend version that answers whatever the test needs. A mock is a fake that also *takes notes*: it records every call and its arguments. `toHaveBeenCalledWith(x)` asks the mock "were you ever called with exactly these arguments?", for example the right URL.

</details>

**8. What does `HttpClient["get"]` mean as a type?**

<details>
<summary>Answer</summary>

"The type of the `get` method on `HttpClient`", so `(url: string) => Promise<Response>`. It uses the same square brackets as reading a field from an object, but applied to a type.

</details>

**9. What do the angle brackets in `vi.fn<HttpClient["get"]>(...)` do, and what two things go wrong if you leave them off?**

<details>
<summary>Answer</summary>

They fill in the blank of `vi.fn`: *which* function the mock pretends to be. Without them, `vi.fn` guesses from `async () => response` a function that takes no arguments. Then (1) its notes are typed as empty, so reading the URL from `get.mock.calls[0]` fails to compile (TS2493). And (2) a wrong pretend reply, like a string instead of a `Response`, isn't caught on the line where you wrote it.

</details>

**10. Why does `headers.get` return `string | null`, and what makes `challenge` a plain `string` afterwards?**

<details>
<summary>Answer</summary>

Because the header might not be in the reply, and `null` is how the built-in type says "not there". The `if (challenge === null) { throw ... }` check narrows it: after that line, the compiler knows it's a plain `string`.

</details>

**11. How is testing a throw from an `async` function different from Chapter 3's `toThrow`? What goes wrong without the `await`?**

<details>
<summary>Answer</summary>

An `async` function doesn't throw straight away. It returns a Promise that *rejects* (fails, holding the error) later. So you pass the Promise itself, use `.rejects.toThrow(...)`, and `await` the whole line. Without the `await`, the test function ends before the Promise fails, and the check never runs. Vitest now refuses this with "Promise returned by `expect(actual).rejects.toThrow(expected)` was not awaited".

</details>

**12. Why did `cli.ts` stop compiling when `main` became `async`?**

<details>
<summary>Answer</summary>

An `async` function returns `Promise<number>`, a box the number will arrive in, and `process.exitCode` wants an actual number. The type check caught it (TS2322), which is the forgotten-`await` bug. The fix is `process.exitCode = await main(...)` at the top level of `cli.ts`.

</details>

**13. Why does a network failure crash the program instead of printing a tidy message?**

<details>
<summary>Answer</summary>

`fetch` threw its own `TypeError` (the cause was `ENOTFOUND`: no such host), and that isn't one of *our* error classes. `main` re-throws errors it doesn't understand rather than hiding them, as decided in Chapter 3. A friendly message for this case comes in Chapter 12.

</details>

## Next chapter

Docker Hub said no, and told us where to ask. Chapter 5 reads that
challenge (`realm`, `service`), asks `auth.docker.io` for a token, and
tries again with the token attached. That needs a fake that answers
*differently each time it's called*: `401` first, then a token, then
`200`. It also needs the `HttpClient` interface to grow a way to send
headers. We'll add it without touching the code that decides *when* a
token is needed, which is the "O" in SOLID: open to new additions,
closed to rewrites.
