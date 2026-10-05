# Chapter 3: Reading an Image Name

Chapter 1 ended with this observation: you type `alpine:3.20`, and
Docker prints `docker.io/library/alpine:3.20`. Something filled in the
blanks. This chapter builds that something.

It's the right first piece for three reasons. It needs no network and
no disk, so it's pure logic that's easy to test. It has more edge cases
than you'd guess, so the tests are worth writing. And it produces the
value every later chapter starts from: a `Reference`.

Everything in this chapter goes into your project. Run `npm run check`
at the end; it should be green.

## Where we are

Pulling an image takes six stages. This chapter's is marked ▶:

- ▶ **1. Read the image name** (this chapter)
- · 2. Ask the registry, get a token (Ch4–5)
- · 3. Read the manifest, pick the platform (Ch6)
- · 4. Download the layers, check them (Ch7; faster in Ch8)
- · 5. Unpack them into a folder (Ch7 roughly; properly in Ch9)
- · 6. Run it with runc (Ch7; more in Ch11)

Every later stage starts from the name: the registry to call, the repository to ask about, the tag or digest to fetch. Get it wrong here, and every request after it goes to the wrong place.

By the end of this chapter you can:

- Turn anything a user types (`alpine`, `ghcr.io/x/y:1.0`, `alpine@sha256:...`) into its full, exact form.
- Refuse a bad name with a clear message, before any network call.
- Write and run your first real tests in TypeScript.

## The rules, from the source

The rules aren't invented — they're in the `distribution/reference`
package that Docker and every other registry client uses. Here's the
grammar, copied from that package's own doc comment:

```
reference := name [ ":" tag ] [ "@" digest ]
name      := [domain '/'] remote-name
domain    := host [':' port-number]
path      := path-component ['/' path-component]*
tag       := /[\w][\w.-]{0,127}/
digest    := digest-algorithm ":" digest-hex
```

In plain words, an image name is up to four things, and only the middle
one is required:

```
   ghcr.io / astral-sh/uv : 0.4.0
   ───┬───   ─────┬─────   ──┬──
 registry    repository     tag
```

and instead of a tag you may give a digest — the fingerprint from
Chapter 1 — after an `@`:

```
   alpine @ sha256:d9e853e8...
```

Leave parts out and defaults appear. Those defaults are also in the
source, in a file called `normalize.go`:

- no registry → `docker.io`
- registry is `docker.io` *and* the repository has no `/` →
  prefix `library/`
- no tag and no digest → `latest`

So `alpine` means `docker.io/library/alpine:latest`. That matches what
`docker pull alpine` printed in Chapter 1.

The interesting rule is how you tell a registry from the first part of
a repository. Both sit before a `/`:

```
ghcr.io/astral-sh/uv        ← ghcr.io is a registry
rijojohn85/oci-pull         ← rijojohn85 is part of the repository
```

There's no list of known registries. The real rule, from
`normalize.go`: the first part is a registry if it is exactly
`localhost`, or if it contains a `.` or a `:`. Hostnames have dots;
ports have colons; `localhost` is the special case with neither. That's
it. A dumb rule that has held up for a decade.

## What we're building

One function, `parseReference`, that takes the string a user typed and
returns a value with the blanks filled in — or throws, with a message
that says what's wrong.

This is worth naming before we write it: `parseReference` doesn't fetch
anything, doesn't read a config file, doesn't print anything, and
doesn't know a registry exists. It turns a string into a value. That's
its whole job, and it's why the tests below need no setup at all. Every
piece in this project is meant to be this boring. When a later chapter
has a piece that's hard to test, that's the signal it's doing two jobs.

## Start with a failing test

Create `src/reference.test.ts`:

```ts
// Vitest's building blocks. `import { a, b } from "x"` pulls named
// things out of another module (Go: import a package, use pkg.Name).
import { describe, expect, it } from "vitest"
// Our own file. Imports between our files are relative and end in .ts.
import { parseReference } from "./reference.ts"

// describe(name, fn) groups related tests under one heading.
// `() => { ... }` is a function with no name (Go: func() { ... }).
describe("parseReference", () => {
  // it(name, fn) is one test. Name it as a sentence about behaviour.
  it("fills in Docker Hub's defaults for a bare name", () => {
    // toEqual compares every field, deeply — not "same object in memory".
    expect(parseReference("alpine")).toEqual({
      kind: "tag",
      registry: "docker.io",
      repository: "library/alpine",
      tag: "latest",
    })
  })
})
```

Reminders, since these were only introduced one chapter ago:
`describe` groups tests, `it` is one test named as a sentence, and the
`() => { ... }` is a function with no name. `toEqual` compares
structure — every field, deeply — rather than asking "is this the same
object in memory."

There's no `reference.ts` yet, so:

```
$ npm test
```

```
 FAIL  src/reference.test.ts [ src/reference.test.ts ]
Error: Cannot find module './reference.ts' imported from .../src/reference.test.ts
 ❯ src/reference.test.ts:2:1
      1| import { describe, expect, it } from "vitest";
      2| import { parseReference } from "./reference.ts";
       | ^
```

Good — the test runs and fails for the honest reason. This book isn't
test-first as a rule, but seeing a test fail *before* it passes is the
only way to know the test would ever catch anything. Do it for the
first test of each new file and you'll never ship a test that passes
for the wrong reason.

## The shape of the answer

Create `src/reference.ts`. First, the type of what we return.

A reference is a registry, a repository, and then *either* a tag *or* a
digest — never both, never neither. Chapter 2.5 section 4 had a name
for "one of these": a **union type**, written with `|`. And the trick
that makes a union usable is giving each shape a field whose value
identifies it, so an ordinary `if` or `switch` tells the compiler which
one you're holding:

```ts
// The fields every reference has. No `export`: only used in this file.
interface ReferenceBase {
  // readonly = set once when the object is made, never changed after.
  readonly registry: string   // e.g. "docker.io", "ghcr.io"
  readonly repository: string // e.g. "library/alpine"
}

// `extends` = "everything ReferenceBase has, plus these".
export interface TaggedReference extends ReferenceBase {
  // Typed as one exact string, not `string`. This field is how code
  // tells the two shapes apart.
  readonly kind: "tag"
  readonly tag: string // e.g. "3.20", "latest"
}

export interface DigestedReference extends ReferenceBase {
  readonly kind: "digest"
  readonly digest: string // e.g. "sha256:d9e853e8..."
}

// `|` means "or": a Reference is exactly one of the two shapes above.
// Never both a tag and a digest, never neither.
export type Reference = TaggedReference | DigestedReference
```

Points worth slowing down on:

- `kind` is typed as *one exact string*, not `string`. That's the
  identifying field. `"tag"` is both a type and a value here.
- `extends` on an interface means "everything that has, plus." Both
  kinds have a registry and a repository.
- `readonly` (Chapter 2.5 section 7) means assign once, never change.
  A parsed reference is a fact about what the user typed; nothing
  downstream should be rewriting it.
- `export` makes a name visible outside the file — the job a capital
  letter does in Go.

We could have used one interface with optional `tag?` and `digest?`
fields. That would let both be missing, or both be set, and every
reader of a `Reference` would have to check. The union makes the
impossible states impossible to write down. This is the whole reason
unions are worth the ceremony.

## An error type of our own

Next, what happens when the input is nonsense. Chapter 2.5 section 5:
throw `Error` objects, and make your own kind by extending `Error`.

```ts
// Our own kind of error. `extends Error` means it is an Error (has a
// message and a stack trace) plus whatever we add.
export class InvalidReferenceError extends Error {
  // The bad input, kept as data so callers needn't dig it out of the message.
  readonly input: string

  // Runs when someone writes `new InvalidReferenceError(input, problem)`.
  constructor(input: string, problem: string) {
    // super(...) runs Error's own constructor, which sets `message`.
    // Backtick strings with ${...} inside are TypeScript's f-strings.
    super(`invalid image reference "${input}": ${problem}`)
    // Makes stack traces say InvalidReferenceError, not plain Error.
    this.name = "InvalidReferenceError"
    this.input = input
  }
}
```

`super(...)` calls `Error`'s own constructor with the message text.
Setting `this.name` is what makes a stack trace say
`InvalidReferenceError` rather than a generic `Error`. Keeping `input`
as a field means a caller can report the bad value without
re-parsing the message string.

Why a class instead of `throw new Error("bad reference")`? Because the
command-line layer in Chapter 10 needs to tell "the user typed a bad
name" (their fault, print the message, exit 1) apart from "the network
died" (not their fault, different exit code). `instanceof` answers that
in one line. A string message can't.

## The defaults, named

```ts
// Each default written exactly once. `const` = this name can never be
// pointed at a different value.
const DEFAULT_REGISTRY = "docker.io"
const DEFAULT_TAG = "latest"
const OFFICIAL_PREFIX = "library/" // Docker Hub's folder for official images
```

Three constants rather than three string literals sprinkled through the
function. If `"docker.io"` appeared in four places, a future change
would mean finding all four — and the one you miss is the bug. Write
each fact once. That's the whole of the "don't repeat yourself" rule,
and it applies to strings as much as to code.

## Splitting the registry off

```ts
// The rule from normalize.go: the first part before "/" is a registry
// only if it is "localhost" or contains a "." or a ":".
// No `export`, so private to this file (Go: a lowercase name).
function looksLikeRegistry(candidate: string): boolean {
  return candidate === "localhost" || candidate.includes(".") || candidate.includes(":")
}

// Returns TWO values as a fixed-length array (a "tuple"). The names
// inside [...] are labels for readers only. Go: (string, string).
function splitRegistry(name: string): [registry: string, repository: string] {
  const slash = name.indexOf("/") // -1 means "not found"
  if (slash === -1) {
    // "alpine": no slash at all, so it can't have a registry.
    return [DEFAULT_REGISTRY, name]
  }
  const head = name.slice(0, slash) // slice(a, b) is Python's s[a:b]
  if (!looksLikeRegistry(head)) {
    // "rijojohn85/oci-pull": the first part is a user, not a host.
    return [DEFAULT_REGISTRY, name]
  }
  // "ghcr.io/astral-sh/uv": split at the first slash.
  return [head, name.slice(slash + 1)]
}
```

No `export` on either, so they're private to this file — Go's lowercase
name. `looksLikeRegistry` is a separate function with a name that says
what the rule *is*; inlining those three comparisons into the `if`
below would work and read worse.

The return type `[registry: string, repository: string]` is a **tuple**:
an array with a fixed length and a type per position. The names are
labels for readers and editors only. It's the closest thing TypeScript
has to Go's multiple return values. `slice(a, b)` is Python's `s[a:b]`.

## Peeling the string, one named step at a time

The plan is to peel the input from the right: cut off the digest (after
`@`), then the tag (after the last `:`), then split the registry off the
front, and whatever is left is the repository.

You could write that as one long function, and a first draft usually
is one. It works, but it's forty lines doing four jobs, and you have to
read all forty to find out what those jobs are. The clean-code move is
to give each job its own small function with a name that says what it
does. `parseReference` then becomes a short list of steps that reads
like the paragraph above. Each helper is small enough to check by eye,
and a bug has one obvious place to live.

Each peeling step needs to hand back **two** things: the piece it found,
and the string with that piece cut off, ready for the next step. Here's
the digest step:

```ts
// Finds "@<digest>" at the end, checks it, and cuts it off.
// Returns an object with two fields: the digest it found (or undefined
// if there was no "@"), and the string that's left without it.
function extractDigest(
  rest: string,
  input: string, // the original text, only used in error messages
): { digest: string | undefined; rest: string } {
  const at = rest.indexOf("@") // -1 means "not found"
  if (at === -1) {
    // No digest: hand the string back unchanged.
    // `{ rest }` is shorthand for `{ rest: rest }`.
    return { digest: undefined, rest }
  }
  const digest = rest.slice(at + 1) // everything after "@"
  if (!DIGEST_PATTERN.test(digest)) {
    throw new InvalidReferenceError(input, `"${digest}" is not a valid digest`)
  }
  // rest.slice(0, at) is everything BEFORE "@": the digest is gone.
  return { digest, rest: rest.slice(0, at) }
}
```

The return type `{ digest: string | undefined; rest: string }` describes
an object shape written inline, without a separate `interface`. That's
fine for a private helper whose result is unpacked immediately. It's
TypeScript's version of Go's `(string, string)` two-value return,
except each value has a name.

The tag step has the same shape:

```ts
// Finds ":<tag>" at the end, checks it, and cuts it off.
function extractTag(
  rest: string,
  input: string,
): { tag: string | undefined; rest: string } {
  const colon = rest.lastIndexOf(":")
  const lastSlash = rest.lastIndexOf("/")
  // A colon only starts a tag if it comes AFTER the last "/".
  // In "localhost:5000/dev/app" the colon is a port, not a tag.
  if (colon === -1 || colon <= lastSlash) {
    return { tag: undefined, rest }
  }
  const tag = rest.slice(colon + 1)
  if (!TAG_PATTERN.test(tag)) {
    throw new InvalidReferenceError(input, `"${tag}" is not a valid tag`)
  }
  return { tag, rest: rest.slice(0, colon) }
}
```

And now the function that uses them:

```ts
export function parseReference(input: string): Reference {
  if (input === "") {
    // throw ends the function and hands the error to whoever called us.
    throw new InvalidReferenceError(input, "the name is empty")
  }

  // Each step takes the previous step's leftover string.
  // `{ digest, rest: restAfterDigest }` unpacks the returned object:
  // take its `digest` field into a variable called `digest`, and its
  // `rest` field into a variable called `restAfterDigest`.
  const { digest, rest: restAfterDigest } = extractDigest(input, input)
  const { tag, rest: restAfterTag } = extractTag(restAfterDigest, input)
  // Unpack the two-value tuple from splitRegistry into two names.
  const [registry, name] = splitRegistry(restAfterTag)

  // `cond ? a : b` is an if that produces a value (Python: a if cond else b).
  // Only single-word Docker Hub names get "library/" in front.
  const repository = registry === DEFAULT_REGISTRY && !name.includes("/")
    ? OFFICIAL_PREFIX + name
    : name

  if (!REPOSITORY_PATTERN.test(repository)) {
    throw new InvalidReferenceError(input, `"${name}" is not a valid repository name`)
  }

  // A digest wins over a tag if both were given (Docker does the same).
  if (digest !== undefined) {
    return { kind: "digest", registry, repository, digest }
  }
  // `??` = "the left side, unless it's missing, then the right side".
  return { kind: "tag", registry, repository, tag: tag ?? DEFAULT_TAG }
}
```

Things to notice:

**Every name is `const`.** `const` means a name can't be pointed at a
different value later; `let` means it can. The long version of this
function needed `let rest` and reassigned it after each step. With each
step's output under its own name (`restAfterDigest`, `restAfterTag`),
nothing is ever reassigned, and you can read any line knowing exactly
what each name holds. Default to `const` and use `let` only when you
really must reassign. (There's also an old keyword, `var`, with confusing
scoping rules. Never use it.)

**Why rename `rest`?** Both helpers return a field called `rest`. You
can't unpack two things into the same name in one scope, so
`rest: restAfterDigest` means "the field is called `rest`, but call it
`restAfterDigest` here." The new name also says which step it came from.

**`string | undefined`.** `digest` and `tag` might not be there, so their
type is "a string, or missing": a union again, this time with
`undefined`. TypeScript won't let us use either as a plain string until
we've ruled out `undefined`. That's why the bottom of the function
checks `digest !== undefined` and writes `tag ?? DEFAULT_TAG`.

**`{ kind: "digest", registry, repository, digest }`**: writing just
`registry` is shorthand for `registry: registry`, when the field and the
variable share a name.

### The trap: a helper that shortens a string must return the shorter string

This bug is easy to write, and it happened for real while this chapter
was being tested. Here is a first draft of `extractDigest` that returns
only the digest:

```ts
// BROKEN: finds the digest but can't cut it off the string.
function extractDigest(rest: string, input: string): string | undefined {
  const at = rest.indexOf("@")
  if (at === -1) {
    return undefined
  }
  const digest = rest.slice(at + 1)
  if (!DIGEST_PATTERN.test(digest)) {
    throw new InvalidReferenceError(input, `"${digest}" is not a valid digest`)
  }
  return digest // the digest comes back, but the caller's string still has it
}
```

It looks finished. It finds the digest, checks it, and returns it. But
it can't change the caller's string: assigning to a parameter inside a
function only changes the function's own copy, the same as in Go and
Python. So the caller still holds `alpine@sha256:d9e8...`, and passes
that to `extractTag`, which finds the last `:` (the one inside `sha256:`),
treats the hex after it as a tag (hex is valid tag text), and leaves
`alpine@sha256` as the name. Three tests fail, all with the same message:

```
 FAIL  src/reference.test.ts > parseReference > reads a digest reference
InvalidReferenceError: invalid image reference "alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc": "alpine@sha256" is not a valid repository name
```

Read the failure like a detective: the repository came out as
`alpine@sha256`, so the `@` part was never cut off. That points straight
at the digest step. Every failing test has an `@` in it. Every passing
one doesn't.

The fix is the version above: return both the piece *and* what's left.
That's why both helpers have the same return shape. It's a pattern worth
recognising: **any step in a pipeline that consumes part of its input
must hand back the unconsumed part.**

The three patterns near the top of the file are the grammar above,
written as regular expressions:

```ts
// Regular expressions go between slashes, not quotes. .test(s) → true/false.
// ^ and $ pin the match to the WHOLE string, not just a piece of it.

// A word character, then up to 127 more of: word chars, "." or "-".
const TAG_PATTERN = /^[\w][\w.-]{0,127}$/
// "<algorithm>:<at least 32 hex characters>", e.g. "sha256:d9e8...".
const DIGEST_PATTERN = /^[a-z0-9]+(?:[.+_-][a-z0-9]+)*:[0-9a-fA-F]{32,}$/
// Lowercase words joined by ".", "_", "__" or dashes, separated by "/".
// Straight from the grammar's path-component rule.
const REPOSITORY_PATTERN = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/
```

In TypeScript a regular expression is written between slashes rather
than in quotes, and `.test(s)` returns true or false. `^` and `$` pin
it to the whole string — without them, `TAG_PATTERN` would happily
match a good tag hiding inside a bad one. The repository one is
unpleasant to look at; it's a direct transcription of `path-component`
from the grammar, and the important part is that it demands lowercase,
which is why `Alpine` is rejected. Docker agrees, and says so in almost
the same words:

```
$ docker pull Alpine
```

```
invalid reference format: repository name (library/Alpine) must be lowercase
```

## Using the union

One small function, to end the file:

```ts
// The part of the URL after /manifests/: a tag or a digest.
export function target(ref: Reference): string {
  // Switching on `kind` tells the compiler which shape `ref` is.
  switch (ref.kind) {
    case "tag":
      return ref.tag    // here ref is a TaggedReference, so .tag exists
    case "digest":
      return ref.digest // here ref is a DigestedReference
  }
  // No default needed: the compiler knows both cases are covered.
  // Remove one and it refuses to compile.
}
```

This is the bit of the URL that goes after `/manifests/` — Chapter 1's
`curl` calls used a tag first, then a digest, in exactly that slot.

It's also the payoff for the union. Inside `case "tag"`, TypeScript
knows `ref` is a `TaggedReference`, so `ref.tag` is allowed. Inside
`case "digest"`, it's a `DigestedReference`. Reaching for `ref.tag`
before the `switch` is an error:

```
error TS2339: Property 'tag' does not exist on type 'Reference'.
  Property 'tag' does not exist on type 'DigestedReference'.
```

And if you delete the second `case`:

```
error TS2366: Function lacks ending return statement and return type does not include 'undefined'.
```

The compiler noticed a shape you forgot. Add a third kind of reference
next year and every `switch` that doesn't handle it stops compiling —
which is the "open for extension, closed for modification" idea doing
something useful rather than being a slogan: you extend the union, and
the compiler hands you the list of places to update.

### The finished file, in order

You've written `reference.ts` in pieces. Top to bottom, the file is:
the error class, the three interfaces and the `Reference` type, the
three default constants, the three patterns, `looksLikeRegistry`,
`splitRegistry`, `extractDigest`, `extractTag`, `parseReference`, and
`target`. Things a function
uses come before the function, so the file reads top-down without
jumping ahead.

## The rest of the tests

Replace `src/reference.test.ts` with:

```ts
import { describe, expect, it } from "vitest"
import { InvalidReferenceError, parseReference, target } from "./reference.ts"

describe("parseReference", () => {
  it("fills in Docker Hub's defaults for a bare name", () => {
    // toEqual: the WHOLE object must match, every field.
    expect(parseReference("alpine")).toEqual({
      kind: "tag",
      registry: "docker.io",
      repository: "library/alpine",
      tag: "latest",
    })
  })

  it("keeps an explicit tag", () => {
    // toMatchObject: only the fields listed must match; others are ignored.
    expect(parseReference("alpine:3.20")).toMatchObject({
      repository: "library/alpine",
      tag: "3.20",
    })
  })

  it("does not add library/ to a user's own repository", () => {
    expect(parseReference("rijojohn85/oci-pull:v1")).toMatchObject({
      registry: "docker.io",
      repository: "rijojohn85/oci-pull",
    })
  })

  // it.each runs the same test once per row. Each row's values become
  // the function's parameters. %s in the name is replaced by the first value.
  it.each([
    ["ghcr.io/astral-sh/uv:latest", "ghcr.io", "astral-sh/uv"],
    ["localhost:5000/dev/app:v2", "localhost:5000", "dev/app"], // colon = port
    ["registry.example.com:5000/team/app", "registry.example.com:5000", "team/app"],
  ])("splits the registry out of %s", (input, registry, repository) => {
    // { registry, repository } = { registry: registry, repository: repository }
    expect(parseReference(input)).toMatchObject({ registry, repository })
  })

  it("reads a digest reference", () => {
    const ref = parseReference(
      "alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc",
    )
    expect(ref).toEqual({
      kind: "digest",
      registry: "docker.io",
      repository: "library/alpine",
      digest: "sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc",
    })
  })

  it("prefers the digest when both a tag and a digest are given", () => {
    const ref = parseReference(
      "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc",
    )
    expect(ref.kind).toBe("digest") // toBe: plain === comparison
  })

  // %j prints the value JSON-quoted, so the empty string shows as "".
  it.each([
    ["", "the name is empty"],
    ["alpine:", "is not a valid tag"],
    ["alpine@sha256:xyz", "is not a valid digest"],
    ["Alpine", "is not a valid repository name"], // uppercase not allowed
  ])("rejects %j", (input, problem) => {
    // expect() gets a FUNCTION here, `() => ...`, so it can call it and
    // catch the throw. Passing parseReference(input) directly would throw
    // before expect() ever ran.
    expect(() => parseReference(input)).toThrow(InvalidReferenceError) // right kind
    expect(() => parseReference(input)).toThrow(problem) // message contains this
  })
})

describe("target", () => {
  it("is the tag for a tagged reference", () => {
    expect(target(parseReference("alpine:3.20"))).toBe("3.20")
  })

  it("is the digest for a digested reference", () => {
    // "a".repeat(64) builds a 64-character string of a's: a fake but valid digest.
    expect(target(parseReference("alpine@sha256:" + "a".repeat(64)))).toBe(
      "sha256:" + "a".repeat(64),
    )
  })
})
```

Four things here are new:

- **`toMatchObject`** checks only the fields you list, where `toEqual`
  demands the whole object match. Use it when a test cares about two
  fields out of four; the test then won't break when an unrelated field
  changes.
- **`it.each([...])`** runs the same test body once per row, filling in
  the parameters. `%s` and `%j` in the name are placeholders for the
  row's values (plain, and JSON-quoted). This is how you test six
  inputs without six near-identical copies of the same test — the
  "write it once" rule, applied to tests.
- **`expect(() => ...).toThrow(X)`** needs a function, not a
  value. If you wrote `expect(parseReference("")).toThrow(...)`,
  the throw would happen while building the argument and the test would
  error out instead of passing. Wrapping it in `() =>` hands `expect` a
  function it can call and watch.
- **`toThrow(SomeErrorClass)`** checks the kind; passing a string
  instead checks that the message *contains* it. We assert both, so a
  future refactor can't quietly change either.

Why these particular cases? Each one is a rule from the grammar that a
naive implementation gets wrong: the `library/` prefix (only for
single-word Hub repositories), the dot/colon/localhost rule, a colon
that's a port rather than a tag, digest winning over tag, and the four
inputs that must be rejected rather than silently accepted. That's the
standard to hold tests to — one per rule that could plausibly break,
not one per line of code.

```
$ npm run check
```

```
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

### What a failure looks like

Worth seeing once, since you'll be reading these for the rest of the
book. Change the first test to expect `"alpine"` instead of
`"library/alpine"` and run again:

```
 FAIL  src/reference.test.ts > parseReference > fills in Docker Hub's defaults for a bare name
AssertionError: expected { kind: 'tag', …(3) } to deeply equal { kind: 'tag', …(3) }

- Expected
+ Received

-   "repository": "alpine",
+   "repository": "library/alpine",
```

`- Expected` is what the test asked for, `+ Received` is what the code
produced, and only the differing lines are shown. Put it back.

## Wire it into the program

`src/main.ts` becomes:

```ts
import { InvalidReferenceError, parseReference, target } from "./reference.ts"

export function usage(): string {
  return "usage: oci-pull <image> <output-dir>"
}

// Returns an exit code instead of exiting, so it can be tested.
export function main(argv: string[]): number {
  // Pull the first two elements out of the array into two names.
  // Each is `string | undefined`: the array might be shorter than two.
  const [image, outputDir] = argv
  // Checking the values (not argv.length) teaches the compiler that
  // both are plain strings from here on.
  if (image === undefined || outputDir === undefined) {
    console.error(usage()) // console.error writes to stderr
    return 2
  }

  try {
    const ref = parseReference(image)
    console.log(`registry   ${ref.registry}`)
    console.log(`repository ${ref.repository}`)
    // Pick the label from `kind`, then let target() pick the value.
    console.log(`${ref.kind === "tag" ? "tag       " : "digest    "} ${target(ref)}`)
    console.log(`would pull into ${outputDir}`)
    return 0
  } catch (err) {
    // A caught value's type is `unknown`: anything can be thrown.
    // instanceof checks it, and inside the if it's our error type.
    if (err instanceof InvalidReferenceError) {
      console.error(err.message)
      return 1 // the user typed a bad name
    }
    throw err // not ours: re-throw rather than hide a real bug
  }
}
```

Two changes from Chapter 2 worth explaining.

The argument check is now `image === undefined || outputDir === undefined`
rather than `argv.length !== 2`. Both are correct at run time, but only
the first convinces the compiler: `noUncheckedIndexedAccess` (Chapter
2) types `argv[0]` as "string or missing," and checking `length` doesn't
teach it otherwise. Checking the values themselves does, so `image` is
a plain `string` from that line on. This is the narrowing idea from
Chapter 2.5 section 2 — an ordinary `if` shrinking a type — turning up
in real code for the first time.

And the `catch` re-throws anything that isn't ours. Chapter 2.5 section
5: a caught value is `unknown`, because anything can be thrown, so you
check with `instanceof` before using it. Swallowing unknown errors is
how a program ends up printing "something went wrong" for a bug it
could have crashed loudly on.

Try it:

```
$ npm start -- alpine ./rootfs
```

```
registry   docker.io
repository library/alpine
tag        latest
would pull into ./rootfs
```

(The bare `--` separates npm's own arguments from your program's.)

```
$ npm start -- ghcr.io/astral-sh/uv:0.4.0 ./rootfs
```

```
registry   ghcr.io
repository astral-sh/uv
tag        0.4.0
```

```
$ npm start -- alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc ./rootfs
```

```
registry   docker.io
repository library/alpine
digest     sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc
```

And a bad one:

```
$ npm start --silent -- Alpine ./rootfs
$ echo $?
```

```
invalid image reference "Alpine": "Alpine" is not a valid repository name
1
```

The exit code survives: `main` returned `1`, `cli.ts` put it in
`process.exitCode`, Node exited with it, and npm passed it along.
`--silent` just hides npm's own two lines of "here's the command I'm
running" so the output above is only our program's.

## Commit

```
$ npm run check
$ git add -A
$ git commit -m "Parse image references"
```

## What you should now be able to answer

Try to answer each one in your own words first. Then open the answer to check.

**1. What are the four parts of an image name, and which are optional?**

<details>
<summary>Answer</summary>

Registry, repository, tag, and digest (after `@`). Only the repository is required. The rest have defaults or can be left out.

</details>

**2. What three defaults does a bare `alpine` pick up?**

<details>
<summary>Answer</summary>

Registry `docker.io`, the `library/` prefix (because it's Docker Hub and the name has no `/`), and tag `latest`. So it becomes `docker.io/library/alpine:latest`.

</details>

**3. How do you tell a registry from the first part of a repository?**

<details>
<summary>Answer</summary>

Look at the part before the first `/`. It's a registry only if it is exactly `localhost`, or it contains a `.` (a hostname) or a `:` (a port). Otherwise it's part of the repository, as in `rijojohn85/oci-pull`.

</details>

**4. Why is `Reference` a union of two interfaces instead of one interface with two optional fields?**

<details>
<summary>Answer</summary>

One interface with `tag?` and `digest?` would allow both to be missing, or both to be set. Every user of a `Reference` would then have to check for those nonsense cases. The union allows exactly one: tagged *or* digested. The impossible states can't even be written.

</details>

**5. What does the `kind` field do, and what happens if you forget a `case`?**

<details>
<summary>Answer</summary>

`kind` is the field that says which shape you hold (`"tag"` or `"digest"`). A `switch` on it narrows the type, so each `case` can use that shape's own field. Forget a `case` and the function fails to compile ("Function lacks ending return statement..."). The compiler finds the shape you forgot.

</details>

**6. Why does `localhost:5000/dev/app` have no tag?**

<details>
<summary>Answer</summary>

A `:` only starts a tag if it comes *after* the last `/`. Here the only colon comes before it, so it's the port of the registry `localhost:5000`. With no tag given, the reference gets the default, `latest`.

</details>

**7. Why do `extractDigest` and `extractTag` both return the leftover string, and what broke when one of them didn't?**

<details>
<summary>Answer</summary>

Each step cuts a piece off the end, and the next step must work on what's left. A function can't change the caller's string, so it has to hand the shorter string back. The first draft of `extractDigest` returned only the digest. `extractTag` then still saw `alpine@sha256:...`, took the hex after the last `:` as a tag, and left `alpine@sha256` as the repository. Every test with an `@` failed with "not a valid repository name".

</details>

**8. Why does `parseReference` need no `let` at all?**

<details>
<summary>Answer</summary>

Each step's result gets its own `const` name (`restAfterDigest`, `restAfterTag`) instead of reusing one variable. Nothing is ever reassigned, so every name means one thing on every line.

</details>

**9. Why does `parseReference` throw its own error class instead of a plain `Error`?**

<details>
<summary>Answer</summary>

So callers can tell "the user typed a bad name" apart from every other failure with a single `instanceof` check. `main` prints the message and exits `1` for this one, and re-throws anything else. The class also keeps the bad `input` as a field, so nobody has to dig it out of the message.

</details>

**10. Why is `expect(() => parseReference("")).toThrow(...)` wrapped in a function?**

<details>
<summary>Answer</summary>

Without the wrapper, `parseReference("")` would run, and throw, while the argument to `expect` is being worked out, before `expect` ever gets control. The test would crash instead of passing. Handing `expect` a function lets it call that function itself and catch the throw.

</details>

**11. Why did `argv.length !== 2` have to become a check on the values?**

<details>
<summary>Answer</summary>

Because of `noUncheckedIndexedAccess`, `image` and `outputDir` are typed `string | undefined`, and checking the array's length doesn't change that for the compiler. Checking `image === undefined || outputDir === undefined` does: after that `if`, both are plain strings (narrowing).

</details>

## Next chapter

Chapter 4 makes the first real HTTP call — to `/v2/`, the front door
from Chapter 1, which answers `401` and tells us where to get a token.
That means `fetch`, `async`/`await` for real, and a problem: a test
that talks to Docker Hub is slow, needs the internet, and fails when
Docker Hub is down. The answer is the pattern from Chapter 2.5 section
8 — the piece asks for what it needs instead of making it — and it's
what makes every test in the rest of this book run in milliseconds with
the network unplugged.
