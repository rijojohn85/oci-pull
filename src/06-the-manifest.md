# Chapter 6: The Manifest: Trusting Nothing from the Server

Chapter 5 ended holding the manifest as a bag of bytes. We printed its
type, its digest and its size, but never looked inside. This chapter
opens it up.

The lesson is in the title. The bytes come from a server on the
internet. TypeScript has no idea what's in them, and neither do we.
`JSON.parse` doesn't check anything. It hands back a value of type
`any`, which switches type checking off, so a missing field only shows
up later as a confusing crash somewhere else. We'll use a library,
`zod`, to describe the shape we expect once, and get back either a
value we can trust or an error that names the bad field.

Then the second job. One address can answer with two different kinds
of manifest: a single image, or a list with one image per kind of CPU.
We'll tell them apart, pick the entry for your machine, and follow it
to the real image manifest. By the end, the program prints the exact
layers it will download in Chapter 7.

New in this chapter: `zod`, `TextEncoder`/`TextDecoder`, `catch` with
no variable, `find`/`map`/`filter` on arrays, `Set`, `...` inside an
array, and the "I" in SOLID.

## Where we are

Pulling an image takes six stages. This chapter's is marked ▶:

- ✓ 1. Read the image name (Ch3)
- ✓ 2. Ask the registry, get a token (Ch4–5)
- ▶ **3. Read the manifest, pick the platform** (this chapter)
- · 4. Download the layers, check them (Ch7; faster in Ch8)
- · 5. Unpack them into a folder (Ch7 roughly; properly in Ch9)
- · 6. Run it with runc (Ch7; more in Ch11)

The manifest is the list of layers to download, so the next three stages depend on reading it correctly. It comes from a server we don't control, so nothing in it can be trusted until it's checked.

By the end of this chapter you can:

- Check any JSON from a server against a shape, and get a clear error naming the bad field.
- Go from a tag to the exact image manifest for your CPU.
- Print the layers the tool will download.

## Two kinds of manifest, by hand

Microsoft's registry needs no token, so plain `curl` is enough. Ask for
the `azurelinux/base/core:3.0` image, and say we can read Docker's
"list" format:

```
$ curl -sS -H "Accept: application/vnd.docker.distribution.manifest.list.v2+json" https://mcr.microsoft.com/v2/azurelinux/base/core/manifests/3.0
```

```
{
   "schemaVersion": 2,
   "mediaType": "application/vnd.docker.distribution.manifest.list.v2+json",
   "manifests": [
      {
         "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
         "size": 528,
         "digest": "sha256:8e53e07b6a3887d814c4d6f75038f16daf9f549216a57b0824b64f51fd25fb13",
         "platform": {
            "architecture": "amd64",
            "os": "linux",
            "os.version": "azurelinux-3.0"
         }
      },
      {
         "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
         "size": 528,
         "digest": "sha256:7e6f5bbc9a3f33e439c0aec20adb239dc6f1cd14b71e0792b3d6a618cda123e3",
         "platform": {
            "architecture": "arm64",
            "os": "linux",
            "os.version": "azurelinux-3.0",
            "variant": "v8"
         }
      }
   ]
}
```

This is an **index**: no files, only a list of other manifests, one
per platform. A *platform* is an operating system plus a kind of CPU
(`amd64` is the usual Intel/AMD laptop or server, `arm64` is an Apple
Silicon Mac or a Raspberry Pi 4). Some CPUs also have a `variant`, a
version of that CPU.

Each entry has the same three fields:

- **`mediaType`**: what kind of thing it points to.
- **`digest`**: its fingerprint. This is also its address: you fetch
  it by putting the digest where the tag usually goes.
- **`size`**: how many bytes it is.

That trio has a name in the spec: a **descriptor**. It's how every
manifest points at anything else.

So, fetch the `amd64` entry by its digest:

```
$ curl -sS -H "Accept: application/vnd.docker.distribution.manifest.v2+json" https://mcr.microsoft.com/v2/azurelinux/base/core/manifests/sha256:8e53e07b6a3887d814c4d6f75038f16daf9f549216a57b0824b64f51fd25fb13
```

```
{
   "schemaVersion": 2,
   "mediaType": "application/vnd.docker.distribution.manifest.v2+json",
   "config": {
      "mediaType": "application/vnd.docker.container.image.v1+json",
      "size": 603,
      "digest": "sha256:9c41197d3a2c9f837f56c0087c5401c7385380fb16a52c3cff331d652da4159f"
   },
   "layers": [
      {
         "mediaType": "application/vnd.docker.image.rootfs.diff.tar.gzip",
         "size": 32227940,
         "digest": "sha256:fe3d6e646b61abbc2ef0f910d48ee88fb9c99d0d6dc80c3c12dcff1788194f16"
      }
   ]
}
```

This is an **image manifest**, the one we actually want. Two parts,
both descriptors:

- **`config`**: a small JSON file with the image's settings (which
  command to run, environment variables). We'll fetch it later.
- **`layers`**: the compressed folders from Chapter 1, in the order
  they're stacked. This image has one, 32 MB. Chapter 7 downloads it.

Getting from a tag to the layers takes two requests when the server
sends an index (pick an entry, fetch it), and one when it sends an
image manifest straight away.

Each of the two kinds has two names, because Docker invented the format
and the OCI standard later adopted it with new names. The fields we
need are the same:

| | OCI standard name | Docker's older name |
|---|---|---|
| index | `application/vnd.oci.image.index.v1+json` | `application/vnd.docker.distribution.manifest.list.v2+json` |
| image manifest | `application/vnd.oci.image.manifest.v1+json` | `application/vnd.docker.distribution.manifest.v2+json` |

These are the four types Chapter 5 put in the `Accept` header. Docker
Hub sends the OCI names, while mcr and ghcr send Docker's.

One more thing to see. Docker Hub's `alpine:3.20` index (the one you
fetched with a token in Chapter 5) has entries like this mixed in with
the real ones (trimmed):

```
{
  "digest": "sha256:6243dec9286873e0392f0527f96c394684dc6fa12661f0bd19253dcd5561e70a",
  "mediaType": "application/vnd.oci.image.manifest.v1+json",
  "platform": {
    "architecture": "unknown",
    "os": "unknown"
  },
  "size": 838
}
```

`unknown/unknown` isn't an image you can run. It's a record of how the
`amd64` image was built, which Docker Hub stores next to it. Our code
must not pick it by accident. It won't, because no machine is
`unknown`, but it's a good reminder: the server sends what *it* likes,
not what we expect.

## The plan

1. **`src/manifest.ts`**: describe the two shapes with `zod`, turn
   bytes into a checked manifest, and pick the right index entry for a
   platform.
2. **`src/resolve.ts`**: go from a tag to an image manifest, making one
   request or two.
3. **`src/main.ts`**: print the platform, the manifest and its layers.

## Step 1: see the problem

First, see what goes wrong without checking. Make a throwaway file,
`src/try-any.ts`, with a made-up reply where one field is misspelled:

```ts
// A made-up reply with one field misspelled: "layrs", not "layers".
const bytes = new TextEncoder().encode('{"schemaVersion":2,"layrs":[]}')

// JSON.parse returns `any`: the compiler stops checking from here on.
const manifest = JSON.parse(new TextDecoder().decode(bytes))

console.log("layers:", manifest.layers.length)
```

`TextEncoder` turns a string into UTF-8 bytes (a `Uint8Array`, like
`[]byte("...")` in Go). `TextDecoder` goes the other way, like
`string(b)`. That's how our bytes from Chapter 5 become text that
`JSON.parse` can read.

Now ask the compiler what it thinks:

```
$ npx tsc --noEmit
```

Nothing. No errors. `manifest` is `any`, and on `any` every property
exists and every call is allowed. Run it:

```
$ node src/try-any.ts
```

```
file:///…/oci-pull/src/try-any.ts:7
console.log("layers:", manifest.layers.length)
                                       ^

TypeError: Cannot read properties of undefined (reading 'length')
    at file:///…/oci-pull/src/try-any.ts:7:40
    at ModuleJob.run (node:internal/modules/esm/module_job:569:25)
    at async node:internal/modules/esm/loader:650:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:105:5)

Node.js v26.10.0
```

(The path is shortened. Yours shows your own folder and Node version.)

This is the crash the type checker was supposed to prevent, and it
happened at runtime anyway. Here it's one line away from the cause, so
it's easy to find. In real code, the `undefined` would be passed along
through three functions before something finally calls `.length` on
it, and the message would say nothing about a misspelled field from
the server.

Chapter 5's `AnonymousAuthenticator` avoided this by hand: store the
value as `unknown` (the type that allows *nothing* until you check),
then four lines of `typeof` and `in` to check one field. A manifest has
dozens of fields, nested two levels deep. Doing that by hand would be
long and easy to get wrong.

Delete the file:

```
$ rm src/try-any.ts
```

## Step 2: zod

`zod` is a library for describing a shape as a value. That value can
then check any data at runtime and tell you exactly what doesn't fit.
It's one of the two packages this book allows (the other is `tar`, in
Chapter 9). Install it:

```
$ npm install zod
```

```
added 3 packages, and audited 45 packages in 829ms

14 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
```

(Your package counts and time will differ.) This time there's no
`--save-dev`. `zod` runs inside the program, so it goes under
`"dependencies"` in `package.json`, not `"devDependencies"`.

Try it on the same broken reply. A new throwaway file,
`src/try-zod.ts`:

```ts
import * as z from "zod"

// The shape we expect, written as a value that can check things.
const Manifest = z.object({
  schemaVersion: z.number(),
  layers: z.array(z.object({ digest: z.string() })),
})

// The same misspelled reply as before.
const bytes = new TextEncoder().encode('{"schemaVersion":2,"layrs":[]}')
const json: unknown = JSON.parse(new TextDecoder().decode(bytes))

const result = Manifest.safeParse(json)
if (result.success) {
  console.log("layers:", result.data.layers.length)
} else {
  console.log(z.prettifyError(result.error))
}
```

Line by line:

- `import * as z from "zod"` puts everything zod exports under one
  name, `z`, like `import zod as z` in Python.
- `z.object({...})` describes an object with these fields. `z.number()`,
  `z.string()` and `z.array(...)` describe the values. The result,
  `Manifest`, is a **schema**: a description of a shape that can also
  check data against it.
- `safeParse(json)` checks the data, and never throws. It returns one
  of two shapes: `{ success: true, data }` or `{ success: false, error }`.
  That's the same tagged one-of type from Chapter 3, with `success` as
  the tag.
- `z.prettifyError` turns the error into readable lines.

```
$ node src/try-zod.ts
```

```
✖ Invalid input: expected array, received undefined
  → at layers
```

It names the field and says what was wrong with it: we expected an
array and got nothing.

There's a second benefit. Inside `if (result.success)`, `result.data`
has a real type: zod worked it out from the schema. To see it, change
the `console.log` line to use `result.data.layrs.length` (misspelled)
and check:

```
$ npx tsc --noEmit
```

```
src/try-zod.ts(15,38): error TS2551: Property 'layrs' does not exist on type '{ schemaVersion: number; layers: { digest: string; }[]; }'. Did you mean 'layers'?
```

So both mistakes get caught. If the *server* gets a name wrong, zod
says so at runtime. If *we* get a name wrong, the compiler says so
before the program runs. With `any`, neither was caught.

Delete it:

```
$ rm src/try-zod.ts
```

## Step 3: describe the shapes

Now the real schemas, in a new file, `src/manifest.ts`. The descriptor
first, since everything else is built from it.

One rule needs to be the same everywhere: what a digest looks like.
Chapter 3 already wrote it, as `DIGEST_PATTERN` in `src/reference.ts`.
Rather than write it again, export it there. Add `export` in front:

```ts
// "<algorithm>:<at least 32 hex characters>", e.g. "sha256:d9e8...".
export const DIGEST_PATTERN = /^[a-z0-9]+(?:[.+_-][a-z0-9]+)*:[0-9a-fA-F]{32,}$/
```

That's DRY ("don't repeat yourself"): one rule, written once. If it
ever needs to change, the command line and the manifest check change
together.

Now `src/manifest.ts`:

```ts
import * as z from "zod"
import { DIGEST_PATTERN } from "./reference.ts"

// A pointer to one stored thing (a layer, a config, another manifest):
// what kind it is, its fingerprint, and how many bytes it has.
const DescriptorSchema = z.object({
  mediaType: z.string(),
  // The same rule Chapter 3 checks on the command line. Digests end up in
  // URLs and, in Chapter 7, in file names, so a strange one is refused.
  // The second argument is the message to show when it doesn't match.
  digest: z.string().regex(DIGEST_PATTERN, "not a digest"),
  // A whole number, zero or more.
  size: z.number().int().nonnegative(),
})

// Which OS and CPU an image is built for, e.g. linux + arm + v7.
const PlatformSchema = z.object({
  os: z.string(),
  architecture: z.string(),
  // Only some CPUs come in versions (arm v6, v7, ...).
  // .optional() means the field may be missing.
  variant: z.string().optional(),
})

// One entry of an index: a descriptor, plus the platform it's built for.
// .extend() copies every field of DescriptorSchema and adds more.
const IndexEntrySchema = DescriptorSchema.extend({
  platform: PlatformSchema.optional(),
})

// An index: a list of manifests, one per platform.
const ImageIndexSchema = z.object({
  // z.literal(2): exactly the number 2, nothing else.
  schemaVersion: z.literal(2),
  manifests: z.array(IndexEntrySchema),
})
```

A few things that look new:

- **Chained checks.** `z.string().regex(...)` is "a string, *and* it
  matches this pattern." `z.number().int().nonnegative()` is "a number,
  a whole one, not below zero." Each call adds one more rule.
- **Why check the digest so strictly?** The digest is the one field we
  use to build things: a URL in this chapter, a file name in Chapter 7.
  A server that sends `"../../etc/passwd"` as a digest shouldn't get
  that far. The size check is there for the same reason: Chapter 7
  will use it to decide how much to download.
- **`platform` is optional** on an index entry. The spec allows
  entries without one. We don't make up a default for it. Step 6 skips
  those entries.
- **`schemaVersion: z.literal(2)`.** There was a version 1, long
  retired, with a different shape. If a server ever sends one, we
  refuse it here rather than misread it.

> **Your turn.** Below `ImageIndexSchema`, add `ImageManifestSchema`:
> `schemaVersion` is the literal `2`, `config` is one descriptor, and
> `layers` is an array of descriptors.

Here it is:

```ts
// An image manifest: one config, and the layers in the order they apply.
const ImageManifestSchema = z.object({
  schemaVersion: z.literal(2),
  config: DescriptorSchema,
  layers: z.array(DescriptorSchema),
})
```

We have the checks. Now we need TypeScript types to go with them, for
function parameters and return values. We could write
`interface ImageManifest { ... }` by hand. But then the same shape
would be written twice, once as a check and once as a type, and sooner
or later the two would disagree. zod can produce the type *from* the
schema instead. Add at the bottom:

```ts
// z.infer reads a schema and gives back the matching TypeScript type.
// The shape is written once, so the check and the type can't drift apart.
export type Descriptor = z.infer<typeof DescriptorSchema>
export type Platform = z.infer<typeof PlatformSchema>
export type IndexEntry = z.infer<typeof IndexEntrySchema>
export type ImageIndex = z.infer<typeof ImageIndexSchema>
export type ImageManifest = z.infer<typeof ImageManifestSchema>
```

`typeof DescriptorSchema`, used in a type, means "the type of this
value." `z.infer<...>` takes that and gives back the type of the data
it accepts. Hover over `Platform` in your editor and you'll see
`{ os: string; architecture: string; variant?: string | undefined }`.
You never wrote that type out; zod worked it out from the schema.

Notice what's exported: the types, not the schemas. Other files will
use `ImageManifest` as a type. Only this file checks data.

```
$ npm run check
```

```
 Test Files  4 passed (4)
      Tests  36 passed (36)
```

Still 36. Nothing uses the new file yet.

## Step 4: bytes in, manifest out

Now the function the rest of the program will call. It takes the
`mediaType` and `bytes` from Chapter 5's `RawManifest`, and returns
either an index or an image manifest.

Which schema to use comes from the media type, so we need the two
lists from the table. Add to `src/manifest.ts`, below the types:

```ts
// The server's content-type says which shape to expect. Each shape has
// two names, the OCI standard's and Docker's older one, with the same
// fields. `readonly string[]` lets includes() take any string.
export const INDEX_TYPES: readonly string[] = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]
export const IMAGE_TYPES: readonly string[] = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
]

// What parseManifest found: an index or an image manifest.
export type Manifest = { kind: "index", index: ImageIndex } | { kind: "image", manifest: ImageManifest }
```

`readonly string[]` is an array nobody can add to or change. `Manifest`
is a tagged one-of type again, tagged by `kind`, like `ApiCheck` in
Chapter 4.

Those four strings already exist once, in `MANIFEST_TYPES` in
`src/registry.ts`. Now they're here too. The registry should *ask for*
exactly the formats this file can *read*, so build its list from these
two. In `src/registry.ts`, replace the `MANIFEST_TYPES` array and its
comment with:

```ts
// Every manifest format manifest.ts can read, sent in the Accept header.
// The lists live there, so a new format is added in one place only.
const MANIFEST_TYPES = [...INDEX_TYPES, ...IMAGE_TYPES]
```

and add the import at the top:

```ts
import { IMAGE_TYPES, INDEX_TYPES } from "./manifest.ts"
```

`...` inside `[ ]` spreads an array's items into a new array, like
`[*a, *b]` in Python or `append(a, b...)` in Go. Chapter 5 used the
same `...` to copy an object's fields. This is DRY again: support a
fifth format later, and you change one list in `manifest.ts`. The
`Accept` header follows on its own.

While you're in `registry.ts`, the comment above `RawManifest` says
"That's Chapter 6." Change it to say where the reading happens now:

```ts
// A manifest as it arrived: not read or checked yet. parseManifest does that.
```

> **Your turn.** Back in `src/manifest.ts`, below the `Manifest` type,
> add a `ManifestError` class, our own error type for anything wrong
> with a manifest. Like `AuthError`: extends `Error`, takes a `problem`
> string, the message is `manifest: <problem>`, and `name` is
> `"ManifestError"`.

Here it is:

```ts
export class ManifestError extends Error {
  constructor(problem: string) {
    // super() runs Error's constructor with our message.
    super(`manifest: ${problem}`)
    this.name = "ManifestError"
  }
}
```

Next, bytes to JSON. This is where untrusted data enters, so it's
where we turn `any` into `unknown`:

```ts
// Bytes in, `unknown` out. JSON.parse returns `any`; the declared return
// type turns it into `unknown` right here, so nothing past this line can
// use the value without checking it first.
function parseJson(bytes: Uint8Array): unknown {
  // TextDecoder turns UTF-8 bytes into a string, like string(b) in Go.
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(text)
  } catch {
    // `catch {` with no (err): we only need to know that it failed.
    throw new ManifestError("body is not JSON")
  }
}
```

`JSON.parse` throws a `SyntaxError` on text that isn't JSON (an HTML
error page from a proxy, say). We swap that for our own error, so that
`main` can print it nicely. `catch {` without `(err)` is allowed when
you don't need the error itself.

One more helper, to turn zod's error into ours:

```ts
// prettifyError lists every problem zod found, one per line, each with
// the path to the bad field.
function invalid(mediaType: string, error: z.ZodError): ManifestError {
  return new ManifestError(`not a valid ${mediaType}\n${z.prettifyError(error)}`)
}
```

Now `parseManifest`. The index branch:

```ts
export function parseManifest(mediaType: string, bytes: Uint8Array): Manifest {
  const json = parseJson(bytes)

  if (INDEX_TYPES.includes(mediaType)) {
    // safeParse never throws. It returns { success: true, data } or
    // { success: false, error }; checking `success` tells the compiler which.
    const result = ImageIndexSchema.safeParse(json)
    if (!result.success) {
      throw invalid(mediaType, result.error)
    }
    return { kind: "index", index: result.data }
  }
  // ... the image branch goes here
  throw new ManifestError(`unsupported media type "${mediaType}"`)
}
```

After `if (!result.success) { throw ... }`, the compiler knows the
other case is the only one left, so `result.data` is an `ImageIndex`.
That's the same narrowing as `switch (check.kind)` in Chapter 4.

The last line handles anything else. The registry sent a type we never
asked for, so we refuse it instead of guessing.

> **Your turn.** Replace `// ... the image branch goes here` with the
> same thing for `IMAGE_TYPES`: check with `ImageManifestSchema`, throw
> `invalid(...)` on failure, and return `{ kind: "image", manifest: ... }`.

Here it is:

```ts
  if (IMAGE_TYPES.includes(mediaType)) {
    // Same as above, with the image manifest's schema.
    const result = ImageManifestSchema.safeParse(json)
    if (!result.success) {
      throw invalid(mediaType, result.error)
    }
    return { kind: "image", manifest: result.data }
  }
```

The two branches look alike. They differ in the schema and the `kind`.
Folding them into one function needs a function that works for *any*
schema and returns whatever type that schema describes. That's a
*generic* function, and writing our own is Chapter 8's job. Two short
branches are easy enough to read for now.

```
$ npm run check
```

```
 Test Files  4 passed (4)
      Tests  36 passed (36)
```

The registry tests still pass. They only check the `authorization`
header, so the new order of the four types in `Accept` doesn't matter
to them.

## Step 5: test it with real manifests

Tests need manifests, and two test files will need the same ones
(Step 7 adds the second). So, like `fake-http.ts` in Chapter 5, they go
in a shared file from the start. That's DRY for test data. Create
`src/test-manifests.ts`, using the real `alpine:3.20` data from Docker
Hub:

```ts
// Real manifests for tests, copied from Docker Hub's alpine:3.20
// (annotations dropped, and only a few of the index's entries kept).

export const OCI_INDEX = "application/vnd.oci.image.index.v1+json"
export const OCI_IMAGE = "application/vnd.oci.image.manifest.v1+json"

export const AMD64_DIGEST = "sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e"
export const ARM_V7_DIGEST = "sha256:bd05c4d38cbeb5cfb34883906276560353a6b0282fb5c4b9dd3bd40f5143d7c3"
export const ARM64_DIGEST = "sha256:45e09956dc667c5eff3583c9d94830261fb1ca0be10a0a7db36266edf5de9e1d"

// An index: one entry per platform. The unknown/unknown entry is a
// build record Docker Hub keeps next to each image, not something to run.
export const ALPINE_INDEX = {
  schemaVersion: 2,
  mediaType: OCI_INDEX,
  manifests: [
    { mediaType: OCI_IMAGE, digest: AMD64_DIGEST, size: 1023, platform: { architecture: "amd64", os: "linux" } },
    {
      mediaType: OCI_IMAGE,
      digest: "sha256:6243dec9286873e0392f0527f96c394684dc6fa12661f0bd19253dcd5561e70a",
      size: 838,
      platform: { architecture: "unknown", os: "unknown" },
    },
    { mediaType: OCI_IMAGE, digest: ARM_V7_DIGEST, size: 1024, platform: { architecture: "arm", os: "linux", variant: "v7" } },
    { mediaType: OCI_IMAGE, digest: ARM64_DIGEST, size: 1026, platform: { architecture: "arm64", os: "linux", variant: "v8" } },
  ],
}

// The image manifest the amd64 entry points to.
export const ALPINE_AMD64 = {
  schemaVersion: 2,
  mediaType: OCI_IMAGE,
  config: {
    mediaType: "application/vnd.oci.image.config.v1+json",
    digest: "sha256:bf8527eb54c3680e728d5b4b383a8ba730d72dae7236fbc8dff97ed6b224a731",
    size: 612,
  },
  layers: [
    {
      mediaType: "application/vnd.oci.image.layer.v1.tar+gzip",
      digest: "sha256:25f1d6b1951ac8eb3740558fe94cb83d377bdadf95fd9f98b50d2e1b96130471",
      size: 3630321,
    },
  ],
  annotations: { "org.opencontainers.image.version": "3.20.10" },
}

// A value as the bytes a server would send: JSON text, UTF-8 encoded.
export function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value))
}
```

Notice `ALPINE_AMD64` has two fields our schema doesn't mention:
`mediaType` and `annotations`. That's on purpose, as the first test
shows. Create `src/manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { ManifestError, parseManifest } from "./manifest.ts"
import { ALPINE_AMD64, ALPINE_INDEX, bytesOf, OCI_IMAGE } from "./test-manifests.ts"

describe("parseManifest", () => {
  it("reads an image manifest and drops fields it doesn't know", () => {
    const result = parseManifest(OCI_IMAGE, bytesOf(ALPINE_AMD64))

    // No mediaType, no annotations: zod keeps only the fields we described.
    expect(result).toEqual({
      kind: "image",
      manifest: { schemaVersion: 2, config: ALPINE_AMD64.config, layers: ALPINE_AMD64.layers },
    })
  })

  // Both names for an index give the same result.
  it.each([
    "application/vnd.oci.image.index.v1+json",
    "application/vnd.docker.distribution.manifest.list.v2+json",
  ])("reads an index sent as %s", (mediaType) => {
    const result = parseManifest(mediaType, bytesOf(ALPINE_INDEX))

    expect(result.kind).toBe("index")
  })

  it("names the field that's wrong", () => {
    // The layer's size as a string: "3630321", not 3630321.
    const broken = { ...ALPINE_AMD64, layers: [{ ...ALPINE_AMD64.layers[0], size: "3630321" }] }

    // A regex: the message must mention layers[0].size. The \ before
    // [ ] and . makes them plain characters, not regex syntax.
    expect(() => parseManifest(OCI_IMAGE, bytesOf(broken))).toThrow(/layers\[0\]\.size/)
  })

  it("refuses a digest that isn't one", () => {
    const sneaky = { ...ALPINE_AMD64, config: { ...ALPINE_AMD64.config, digest: "../../etc/passwd" } }

    expect(() => parseManifest(OCI_IMAGE, bytesOf(sneaky))).toThrow(ManifestError)
  })
})
```

The first test shows something zod does by default: **fields the
schema doesn't mention are dropped**. What comes out has exactly the
fields we described, and nothing else. The `"os.version"` field from
mcr is dropped the same way. Code further on can never come to rely on
a field we never checked.

The broken manifests are built with `...` from the good one, changing
just one field: `{ ...ALPINE_AMD64, layers: [...] }` is "everything
from `ALPINE_AMD64`, but with these `layers`." Each test is then
exactly one mistake away from real data.

> **Your turn.** Two more tests inside the same `describe`.
> "refuses a media type it doesn't know": `parseManifest("text/html", ...)`
> throws `'unsupported media type "text/html"'`. "refuses a body that
> isn't JSON": the bytes of the text `<html>` (use `new TextEncoder().encode`)
> throw `"body is not JSON"`.

Here it is:

```ts
  it("refuses a media type it doesn't know", () => {
    expect(() => parseManifest("text/html", bytesOf(ALPINE_AMD64))).toThrow('unsupported media type "text/html"')
  })

  it("refuses a body that isn't JSON", () => {
    // Plain text, not JSON: what a proxy's error page might look like.
    const html = new TextEncoder().encode("<html>")

    expect(() => parseManifest(OCI_IMAGE, html)).toThrow("body is not JSON")
  })
```

```
$ npm run check
```

```
 Test Files  5 passed (5)
      Tests  43 passed (43)
```

Seven new tests. To see the real message a user would get, make one
more throwaway file, `src/try-broken.ts`, with *two* mistakes at once:

```ts
import { parseManifest } from "./manifest.ts"
import { ALPINE_AMD64, bytesOf, OCI_IMAGE } from "./test-manifests.ts"

// Two things wrong: a size that's a string, and a digest that's a path.
const broken = {
  ...ALPINE_AMD64,
  config: { ...ALPINE_AMD64.config, digest: "../../etc/passwd" },
  layers: [{ ...ALPINE_AMD64.layers[0], size: "3630321" }],
}

try {
  parseManifest(OCI_IMAGE, bytesOf(broken))
} catch (err) {
  // String(err) is "<name>: <message>", the way main would show it.
  console.log(String(err))
}
```

```
$ node src/try-broken.ts
```

```
ManifestError: manifest: not a valid application/vnd.oci.image.manifest.v1+json
✖ not a digest
  → at config.digest
✖ Invalid input: expected number, received string
  → at layers[0].size
```

Both problems are listed, each with the path to its field, and our own
`"not a digest"` message is used for the first. Compare that with
Step 1's `Cannot read properties of undefined`. Delete the file:

```
$ rm src/try-broken.ts
```

## Step 6: pick the platform

Now for the index: find the entry that matches this machine.

First, what *is* this machine? Node knows its CPU as `process.arch`.
But Node and registries name some CPUs differently. Registries use
Go's names (the tools that made the format are written in Go), and
Node doesn't:

| Node (`process.arch`) | Registry (`architecture`) |
|---|---|
| `x64` | `amd64` |
| `ia32` | `386` |
| `arm64` | `arm64` |

So a small lookup table, for just the names that differ. Add to
`src/manifest.ts`, at the bottom:

```ts
// Node names some CPUs differently from registries (which use Go's
// names). Only the ones that differ are listed here.
const NODE_TO_REGISTRY_ARCH: Record<string, string> = {
  x64: "amd64",
  ia32: "386",
}

// The platform to pull for this machine. The OS is always linux: an
// image is a Linux folder, even on a Mac (Docker runs it in a Linux VM).
// `arch` defaults to this machine's CPU; a test can pass another one.
export function hostPlatform(arch: string = process.arch): Platform {
  return { os: "linux", architecture: NODE_TO_REGISTRY_ARCH[arch] ?? arch }
}

// "linux/arm/v7", or "linux/amd64" when there's no variant.
export function formatPlatform(platform: Platform): string {
  // filter() drops a missing variant, so there's no trailing "/".
  return [platform.os, platform.architecture, platform.variant].filter((part) => part !== undefined).join("/")
}
```

`NODE_TO_REGISTRY_ARCH[arch] ?? arch` means "the registry's name if
the table has one, or else the same name." (`??` is "or, if that's
missing.") Because of `noUncheckedIndexedAccess`, the compiler treats a
lookup in a `Record` as possibly `undefined`, so the `??` is required
here, not just tidy.

The `arch` parameter has a default value: `process.arch`. The program
calls `hostPlatform()` and gets this machine. A test calls
`hostPlatform("ia32")` and gets a 32-bit PC without needing one. The
function takes what it depends on as an argument, so a test can pass a
fake, the same way `RegistryClient` takes an `HttpClient`. Here the
fake is just a string.

Now matching and picking:

```ts
// Same OS and CPU. The variant only counts if we asked for one.
function matches(have: Platform | undefined, want: Platform): boolean {
  return (
    have !== undefined &&
    have.os === want.os &&
    have.architecture === want.architecture &&
    (want.variant === undefined || have.variant === want.variant)
  )
}

// The index entry for `want`, or an error that lists what's on offer.
export function pickPlatform(index: ImageIndex, want: Platform): IndexEntry {
  // find() returns the first entry the arrow function says yes to, or undefined.
  const found = index.manifests.find((entry) => matches(entry.platform, want))
  if (found !== undefined) {
    return found
  }
  const offered = index.manifests
    .map((entry) => entry.platform)
    // After this filter, the compiler knows no undefined is left.
    .filter((platform) => platform !== undefined)
    .map(formatPlatform)
  // A Set keeps one of each; [...set] turns it back into an array.
  const unique = [...new Set(offered)]
  throw new ManifestError(`no image for ${formatPlatform(want)}; this one has ${unique.join(", ")}`)
}
```

Three array methods you'll use all the time, each taking a small
function (an *arrow function*, `(x) => ...`, like Python's
`lambda x: ...`):

- **`find`** returns the first item the function says yes to, or
  `undefined` if none. Like `next((e for e in xs if ...), None)` in
  Python.
- **`map`** makes a new array with the function applied to each item.
  `.map(formatPlatform)` passes our named function directly. No arrow
  needed when it already takes one argument.
- **`filter`** keeps the items the function says yes to.

A **`Set`** is a collection that keeps one copy of each value, like
Python's `set`. Docker Hub's index has `unknown/unknown` eight times,
and the error message should list it once.

The error message matters. When there's no image for your CPU, "not
found" is useless. A list of what *is* available tells the user right
away whether they typed the wrong image or picked an image that wasn't
built for their machine.

`matches` only compares the variant when we asked for one.
`hostPlatform` never asks, so on an `arm64` machine it matches
`linux/arm64/v8`. Asking for `arm/v7` explicitly still picks exactly
v7.

The tests. Add to `src/manifest.test.ts`, below the `parseManifest`
block. First, a helper that turns the index fixture into a checked
`ImageIndex`, the same way the program does:

```ts
// The index, read the same way the program reads it.
function alpineIndex(): ImageIndex {
  const result = parseManifest("application/vnd.oci.image.index.v1+json", bytesOf(ALPINE_INDEX))
  // Narrow the one-of type; anything else is a broken test, not a bug.
  if (result.kind !== "index") {
    throw new Error("expected an index")
  }
  return result.index
}

describe("pickPlatform", () => {
  it.each([
    { want: { os: "linux", architecture: "amd64" }, digest: AMD64_DIGEST },
    { want: { os: "linux", architecture: "arm64" }, digest: ARM64_DIGEST },
    { want: { os: "linux", architecture: "arm", variant: "v7" }, digest: ARM_V7_DIGEST },
  ])("picks $digest for $want.architecture", ({ want, digest }) => {
    expect(pickPlatform(alpineIndex(), want).digest).toBe(digest)
  })

  it("lists what's on offer when nothing matches", () => {
    expect(() => pickPlatform(alpineIndex(), { os: "linux", architecture: "riscv64" })).toThrow(
      "no image for linux/riscv64; this one has linux/amd64, unknown/unknown, linux/arm/v7, linux/arm64/v8",
    )
  })
})
```

Update the imports at the top of the file to bring in the new names:

```ts
import { formatPlatform, hostPlatform, ManifestError, parseManifest, pickPlatform, type ImageIndex } from "./manifest.ts"
import {
  ALPINE_AMD64,
  ALPINE_INDEX,
  AMD64_DIGEST,
  ARM64_DIGEST,
  ARM_V7_DIGEST,
  bytesOf,
  OCI_IMAGE,
} from "./test-manifests.ts"
```

The `arm64` row is worth a look: we ask for no variant, and the entry
has `v8`. It's picked anyway, which is the rule in `matches`.

> **Your turn.** A `describe("hostPlatform")` with one `it.each` over
> three rows: `x64` gives `"linux/amd64"`, `arm64` gives
> `"linux/arm64"`, `ia32` gives `"linux/386"`. Check through
> `formatPlatform(hostPlatform(arch))`.

Here it is:

```ts
describe("hostPlatform", () => {
  // $arch and $expected in the title are filled in from each row.
  it.each([
    { arch: "x64", expected: "linux/amd64" },
    { arch: "arm64", expected: "linux/arm64" },
    { arch: "ia32", expected: "linux/386" },
  ])("turns Node's $arch into $expected", ({ arch, expected }) => {
    expect(formatPlatform(hostPlatform(arch))).toBe(expected)
  })
})
```

```
$ npm run check
```

```
 Test Files  5 passed (5)
      Tests  50 passed (50)
```

## Step 7: from a tag to an image manifest

Now put the pieces in order: fetch, parse, and if it's an index, pick
and fetch again. This needs the registry, but only one thing from it:
`fetchManifest`.

`resolveImage` could take a whole `RegistryClient`. But then a test
would have to build one, with a fake `HttpClient` and an
`Authenticator`, just to hand back two manifests. Instead, it asks for
an interface with only the method it calls. That's the **interface
segregation principle**, the "I" in SOLID: don't make code depend on
methods it doesn't use. `RegistryClient` already has a `fetchManifest`
with the right shape, so it fits the interface without any change.
(Remember from Chapter 2.5, a type is a shape: no `implements` needed.)

Create `src/resolve.ts`:

```ts
import { type ImageManifest, ManifestError, parseManifest, pickPlatform, type Platform } from "./manifest.ts"
import type { RawManifest } from "./registry.ts"

// All resolveImage needs from a registry is this one method. Asking for
// a small interface, not the whole RegistryClient, means a test can fake
// it with a one-method object, and no HTTP is involved at all.
export interface ManifestSource {
  fetchManifest(repository: string, reference: string): Promise<RawManifest>
}

// The image manifest to pull, and its digest, if known.
export interface ResolvedImage {
  readonly digest: string | null
  readonly manifest: ImageManifest
}

// Tag (or digest) in, image manifest for `want` out. One request if the
// server sends an image manifest; two if it sends an index first.
export async function resolveImage(
  source: ManifestSource,
  repository: string,
  reference: string,
  want: Platform,
): Promise<ResolvedImage> {
  const raw = await source.fetchManifest(repository, reference)
  const first = parseManifest(raw.mediaType, raw.bytes)
  if (first.kind === "image") {
    // A single-platform image: nothing to pick.
    return { digest: raw.digest, manifest: first.manifest }
  }

  // An index: pick our platform, then fetch that entry by its digest.
  const entry = pickPlatform(first.index, want)
  const rawImage = await source.fetchManifest(repository, entry.digest)
  const second = parseManifest(rawImage.mediaType, rawImage.bytes)
  if (second.kind === "index") {
    throw new ManifestError(`${entry.digest} is another index, not an image`)
  }
  return { digest: entry.digest, manifest: second.manifest }
}
```

Two things to notice:

- **The digest returned.** If we went through an index, it's the
  entry's digest: the manifest we actually used. If the server sent an
  image manifest straight away, it's whatever the server put in its
  `docker-content-digest` header, which may be missing (`null`).
- **An index pointing to another index** is allowed by the spec, but
  rare, and following it could loop forever on a broken server. We
  refuse it with a clear message. See "What this chapter doesn't do."

Tests, in a new file `src/resolve.test.ts`. The fake source is a
`vi.fn` typed as the interface's method:

```ts
import { describe, expect, it, vi } from "vitest"
import type { RawManifest } from "./registry.ts"
import { type ManifestSource, resolveImage } from "./resolve.ts"
import { ALPINE_AMD64, ALPINE_INDEX, AMD64_DIGEST, bytesOf, OCI_IMAGE, OCI_INDEX } from "./test-manifests.ts"

// Docker Hub's digest for the alpine:3.20 index.
const INDEX_DIGEST = "sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc"
const amd64 = { os: "linux", architecture: "amd64" }

// What fetchManifest would return for this value.
function raw(mediaType: string, value: unknown, digest: string): RawManifest {
  return { mediaType, digest, bytes: bytesOf(value) }
}

describe("resolveImage", () => {
  it("returns an image manifest straight away", async () => {
    // A mock fetchManifest that always answers with the amd64 manifest.
    const fetchManifest = vi.fn<ManifestSource["fetchManifest"]>(async () => raw(OCI_IMAGE, ALPINE_AMD64, AMD64_DIGEST))

    // { fetchManifest } is a whole ManifestSource: the interface has one method.
    const result = await resolveImage({ fetchManifest }, "library/alpine", "3.20", amd64)

    expect(result.digest).toBe(AMD64_DIGEST)
    // toHaveLength checks an array's .length.
    expect(result.manifest.layers).toHaveLength(1)
    expect(fetchManifest).toHaveBeenCalledTimes(1)
  })
})
```

`{ fetchManifest }` is short for `{ fetchManifest: fetchManifest }`,
an object with one property. That's the whole fake. Compare it with
the `RegistryClient` tests in Chapter 5, which had to fake HTTP
responses, headers and tokens.

> **Your turn.** A second test, "follows an index to the entry for our
> platform". The fake answers *in turn*: first the index
> (`raw(OCI_INDEX, ALPINE_INDEX, INDEX_DIGEST)`), then the amd64 image
> manifest. Use `vi.fn<...>()` with no implementation, then
> `.mockResolvedValueOnce(...)` once for each reply, as in Chapter 5's
> `replyingInTurn` (each call returns the mock, so they can be chained).
> Check that the second call asked for `AMD64_DIGEST`, and that
> `result.digest` is `AMD64_DIGEST`.

Here it is:

```ts
  it("follows an index to the entry for our platform", async () => {
    // The index first, then the image manifest it points to.
    // Each mockResolvedValueOnce queues one reply, in order.
    const fetchManifest = vi
      .fn<ManifestSource["fetchManifest"]>()
      .mockResolvedValueOnce(raw(OCI_INDEX, ALPINE_INDEX, INDEX_DIGEST))
      .mockResolvedValueOnce(raw(OCI_IMAGE, ALPINE_AMD64, AMD64_DIGEST))

    const result = await resolveImage({ fetchManifest }, "library/alpine", "3.20", amd64)

    // The 2nd request used the digest picked from the index.
    expect(fetchManifest).toHaveBeenNthCalledWith(2, "library/alpine", AMD64_DIGEST)
    expect(result.digest).toBe(AMD64_DIGEST)
  })
```

And one for the refusal. The second reply is an index again:

```ts
  it("refuses an index that points to another index", async () => {
    const fetchManifest = vi
      .fn<ManifestSource["fetchManifest"]>()
      .mockResolvedValueOnce(raw(OCI_INDEX, ALPINE_INDEX, INDEX_DIGEST))
      .mockResolvedValueOnce(raw(OCI_INDEX, ALPINE_INDEX, AMD64_DIGEST))

    // An async failure: await the expect, or the test ends too early.
    await expect(resolveImage({ fetchManifest }, "library/alpine", "3.20", amd64)).rejects.toThrow(
      "is another index, not an image",
    )
  })
```

```
$ npm run check
```

```
 Test Files  6 passed (6)
      Tests  53 passed (53)
```

## Step 8: print it

`main` doesn't print the raw manifest anymore. It prints what we're
about to download: the platform, the manifest's digest, the config, and
a line per layer. In `src/main.ts`, replace `describeManifest` with:

```ts
// What we're about to pull: the platform, the manifest's digest, the
// config, and one line per layer.
function describeImage(platform: Platform, resolved: ResolvedImage): string {
  // Pull two fields out of the manifest into their own names.
  const { config, layers } = resolved.manifest
  // map() turns each layer into a line. Its second argument is the
  // position (0, 1, ...), so +1 counts from 1 for people.
  const layerLines = layers.map(
    (layer, i) => `layer ${i + 1}/${layers.length}  ${layer.digest}  ${megabytes(layer.size)}`,
  )
  return [
    `platform   ${formatPlatform(platform)}`,
    `manifest   ${resolved.digest ?? "(not sent)"}`,
    `config     ${config.digest}`,
    // ...layerLines puts each line in as its own item.
    ...layerLines,
  ].join("\n")
}

// 3630321 -> "3.6 MB". The _ in 1_000_000 is only for reading; it's ignored.
function megabytes(bytes: number): string {
  // toFixed(1): one digit after the point, as a string.
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}
```

And in `main`, replace the `describeManifest(...)` line with:

```ts
    // This machine's platform; the registry client is the manifest source.
    const platform = hostPlatform()
    const resolved = await resolveImage(registry, ref.repository, target(ref), platform)
    console.log(describeImage(platform, resolved))
```

`registry` is passed where a `ManifestSource` is expected. It has a
matching `fetchManifest`, so it fits. The variable is called
`resolved`, not `image`, because `main` already has an `image`: the
command-line argument.

Then add the imports:

```ts
import { formatPlatform, hostPlatform, type Platform } from "./manifest.ts"
import { resolveImage, type ResolvedImage } from "./resolve.ts"
```

Ask the checker what's left:

```
$ npm run check
```

```
> oci-pull@1.0.0 check
> npm run typecheck && npm run test


> oci-pull@1.0.0 typecheck
> tsc --noEmit

src/main.ts(5,30): error TS6133: 'RawManifest' is declared but its value is never read.
```

`describeManifest` was the only thing that used `RawManifest`, and
it's gone. `noUnusedLocals` from Chapter 2 catches the leftover import.
(Your line and column may differ if your imports are in a different
order.)

> **Your turn.** Two fixes in `main.ts`. Remove `type RawManifest` from
> the `./registry.ts` import. Then make a broken manifest print a clean
> message instead of a stack trace: import `ManifestError` from
> `./manifest.ts`, and add it to the errors the `catch` prints.

Here it is:

```ts
import { formatPlatform, hostPlatform, ManifestError, type Platform } from "./manifest.ts"
import { InvalidReferenceError, parseReference, target } from "./reference.ts"
import { type ApiCheck, RegistryClient, RegistryError } from "./registry.ts"

// ...

  } catch (err) {
    // Any of our own errors: print the message, exit 1.
    if (
      err instanceof InvalidReferenceError ||
      err instanceof RegistryError ||
      err instanceof AuthError ||
      err instanceof ManifestError
    ) {
      console.error(err.message)
      return 1
    }
    throw err
  }
```

That list of four is getting long. Chapter 10 tidies it up, when all
the errors are in.

```
$ npm run check
```

```
 Test Files  6 passed (6)
      Tests  53 passed (53)
```

The order of `src/main.ts`, top to bottom: imports, `usage`,
`describeApiCheck`, `describeImage`, `megabytes`, `main`.

## Try it

Docker Hub, which sends an OCI index:

```
$ npm start --silent -- alpine:3.20 ./rootfs
```

```
registry   docker.io
repository library/alpine
tag        3.20
api        needs a token
challenge  Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
platform   linux/amd64
manifest   sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e
config     sha256:bf8527eb54c3680e728d5b4b383a8ba730d72dae7236fbc8dff97ed6b224a731
layer 1/1  sha256:25f1d6b1951ac8eb3740558fe94cb83d377bdadf95fd9f98b50d2e1b96130471  3.6 MB
would pull into ./rootfs
```

That's the `amd64` entry from the index, and the same digests that are
in `test-manifests.ts`. On an Apple Silicon Mac or other `arm64`
machine, you'll see `platform linux/arm64` and a different manifest.
That's the point of this step. (Digests also change whenever `alpine`
is rebuilt.)

Microsoft's registry, which sends Docker's list format:

```
$ npm start --silent -- mcr.microsoft.com/azurelinux/base/core:3.0 ./rootfs
```

```
registry   mcr.microsoft.com
repository azurelinux/base/core
tag        3.0
api        open, no token needed
platform   linux/amd64
manifest   sha256:8e53e07b6a3887d814c4d6f75038f16daf9f549216a57b0824b64f51fd25fb13
config     sha256:9c41197d3a2c9f837f56c0087c5401c7385380fb16a52c3cff331d652da4159f
layer 1/1  sha256:fe3d6e646b61abbc2ef0f910d48ee88fb9c99d0d6dc80c3c12dcff1788194f16  32.2 MB
would pull into ./rootfs
```

The same manifest we fetched with curl at the start of the chapter,
found by the code this time.

GitHub's registry:

```
$ npm start --silent -- ghcr.io/containerd/busybox:1.36 ./rootfs
```

```
registry   ghcr.io
repository containerd/busybox
tag        1.36
api        needs a token
challenge  Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/image:pull"
platform   linux/amd64
manifest   sha256:907ca53d7e2947e849b839b1cd258c98fd3916c60f2e6e70c30edbf741ab6754
config     sha256:66ba00ad3de8677a3fa4bc4ea0fc46ebca0f14db46ca365e7f60833068dd0148
layer 1/1  sha256:205dae5015e78dd8c4d302e3db4eb31576fac715b46d099fe09680ba28093a7a  2.6 MB
would pull into ./rootfs
```

Asking by digest. This skips the index: the server sends the image
manifest straight away, and `resolveImage` makes one request:

```
$ npm start --silent -- alpine@sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e ./rootfs
```

```
registry   docker.io
repository library/alpine
digest     sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e
api        needs a token
challenge  Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
platform   linux/amd64
manifest   sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e
config     sha256:bf8527eb54c3680e728d5b4b383a8ba730d72dae7236fbc8dff97ed6b224a731
layer 1/1  sha256:25f1d6b1951ac8eb3740558fe94cb83d377bdadf95fd9f98b50d2e1b96130471  3.6 MB
would pull into ./rootfs
```

A digest names exactly one manifest, and that one is for `amd64`. If
you ran this on an `arm64` machine, it would still answer with this
`amd64` manifest, because we didn't pick it. See the gaps below.

Last, an image with more than one layer:

```
$ npm start --silent -- node:22-alpine ./rootfs
```

```
registry   docker.io
repository library/node
tag        22-alpine
api        needs a token
challenge  Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
platform   linux/amd64
manifest   sha256:2c752226d477b4a886378baa95b9af252be59301b725fdb0b7e15208131505a8
config     sha256:7c3b093add7c43400ee83b815ab2cda98794a10045bcf76ce9bb2f89b97cbc5c
layer 1/4  sha256:e2de96513ba9eb53b431787ec8a65cdde380ac4772a3e4c4b714dcfde2a102b5  3.8 MB
layer 2/4  sha256:f7f2d304681aaa935c9cfd180850cf616ae843efce7682873d6521ded7268937  55.6 MB
layer 3/4  sha256:e554276b05e6306c5ad33cd85bfa7f0693083e21f6114db5abf60a20fb413039  1.3 MB
layer 4/4  sha256:d39db1cf9caa4f49c5a2e67111fbe6e0d5eea8ede550cb82f3dc2b79712688d6  0.0 MB
would pull into ./rootfs
```

Four layers, stacked in this order. The image's config (which we'll
read later) records the command that made each one. Layer 1 is Alpine
itself (3.24 here, a newer one than `alpine:3.20`, so a different
digest). Layer 2 installs Node, layer 3 installs `yarn`, and layer 4
adds one small script, `docker-entrypoint.sh`. That last one is 447
bytes, so it rounds down to `0.0 MB`. Chapter 8 downloads them all at
once, and Chapter 9 stacks them into one folder.

## What this chapter doesn't do

- **Check the manifest's own digest.** When we fetch a manifest by
  digest, we should make sure the bytes really hash to that digest.
  Otherwise a server could send different bytes with the right name.
  Computing a `sha256` is Chapter 7's main job (for layers). We'll
  check manifests there too.
- **Choose a platform from the command line.** Docker has
  `--platform linux/arm64`. Ours always uses this machine's CPU.
  `resolveImage` already takes `want` as an argument, so adding the
  option in Chapter 10 needs no change here.
- **Check the platform when asking by digest.** A digest that names a
  single image manifest is used as is, even if it's built for another
  CPU. The manifest doesn't say which CPU it's for. The config does,
  and we don't read the config yet.
- **Follow an index inside an index.** The spec allows it; real
  registries hardly ever send one. We refuse it with a clear error,
  rather than risk following a chain that never ends.
- **Tell 32-bit ARM versions apart.** On a 32-bit ARM machine,
  `hostPlatform` asks for `arm` with no variant, and `matches` takes
  the first `arm` entry (often v6, which runs fine on v7 but slower).
  Node doesn't report the ARM version directly, and few people pull on
  those machines.

## Commit

```
$ npm run check
$ git add -A
$ git commit -m "Parse the manifest with zod and pick the platform"
```

## What you should now be able to answer

Try to answer each one in your own words first. Then open the answer
to check.

**1. Why did `manifest.layers.length` compile without errors in Step 1, and still crash?**

<details>
<summary>Answer</summary>

`JSON.parse` returns `any`, and on `any` the compiler allows every
property and every call, so it had nothing to complain about. At
runtime the object had `layrs`, not `layers`, so `manifest.layers` was
`undefined`, and reading `.length` of `undefined` threw a `TypeError`.

</details>

**2. Where does our code turn `any` into `unknown`, and why there?**

<details>
<summary>Answer</summary>

In `parseJson`, whose declared return type is `unknown`. That's the
exact point where untrusted bytes become a value. From there on,
nothing can use the value without checking it first, and the only
check is a zod schema.

</details>

**3. What is a zod schema, and what does `safeParse` return?**

<details>
<summary>Answer</summary>

A schema is a description of a shape, written as a value, that can
check data at runtime. `safeParse` never throws. It returns either
`{ success: true, data }`, where `data` has a real type, or
`{ success: false, error }`, which lists every problem with its field
path. Checking `success` tells the compiler which one you have.

</details>

**4. What does `z.infer<typeof ImageManifestSchema>` give you, and why use it instead of writing an interface?**

<details>
<summary>Answer</summary>

It gives the TypeScript type of the data the schema accepts. If you
wrote an interface by hand as well, the same shape would be written
twice, once as a check and once as a type, and sooner or later they'd
disagree. With `z.infer` it's written once and both come from it.

</details>

**5. What happens to fields the server sends that our schema doesn't mention, like `annotations` or `os.version`?**

<details>
<summary>Answer</summary>

`z.object` drops them. The parsed value has exactly the fields we
described and nothing else. So no code further on can come to depend
on a field we never checked.

</details>

**6. Why is the digest checked with `DIGEST_PATTERN` instead of just "a string"?**

<details>
<summary>Answer</summary>

The digest is what we build things from: a URL now, a file name in
Chapter 7. A server that sends `"../../etc/passwd"` as a digest must be
stopped before it gets there. Reusing Chapter 3's pattern also keeps
one rule for "what a digest looks like" in one place (DRY).

</details>

**7. What's the difference between an index and an image manifest, and how does our code tell which one it got?**

<details>
<summary>Answer</summary>

An index is a list of manifests, one per platform. An image manifest
has a config and the layers to download. The code goes by the
`content-type` header: `parseManifest` checks whether the media type
is in `INDEX_TYPES` or `IMAGE_TYPES`, and anything else is refused.

</details>

**8. Why does every manifest kind have two media type names?**

<details>
<summary>Answer</summary>

Docker invented the format, and the OCI standard later adopted it with
its own names. The fields we use are the same in both. Docker Hub
sends the OCI names, while mcr and ghcr send Docker's, so we accept
both.

</details>

**9. Why is `MANIFEST_TYPES` in `registry.ts` now built from `INDEX_TYPES` and `IMAGE_TYPES`?**

<details>
<summary>Answer</summary>

The registry should ask for exactly the formats `manifest.ts` can read.
Keeping the list in one place (DRY) means a new format is added in
one file, and the `Accept` header follows on its own.

</details>

**10. Why does `hostPlatform` take `arch` as a parameter with a default, instead of reading `process.arch` inside?**

<details>
<summary>Answer</summary>

So a test can ask for any CPU (`"ia32"`, `"arm64"`) without needing
that machine. The program calls `hostPlatform()` and gets this
machine. It's the same idea as passing `HttpClient` into
`RegistryClient`: take what you depend on as an argument, so a test can
pass a fake.

</details>

**11. Why doesn't `pickPlatform` ever choose the `unknown/unknown` entries, and why does its error list what's on offer?**

<details>
<summary>Answer</summary>

Those entries are build records, not runnable images, and no real
machine is `unknown/unknown`, so they never match. The error lists the
platforms the image *does* have, so the user can see right away
whether they typed the wrong image or the image wasn't built for their
CPU. A `Set` removes duplicates from that list.

</details>

**12. What is the interface segregation principle, and where did we use it?**

<details>
<summary>Answer</summary>

It's the "I" in SOLID: code shouldn't depend on methods it doesn't
use. `resolveImage` asks for a `ManifestSource`, an interface with
only `fetchManifest`, not the whole `RegistryClient`. So its tests fake
it with a one-method object and no HTTP at all, and `RegistryClient`
fits it as is because a type is a shape.

</details>

**13. When does `resolveImage` make one request, and when two?**

<details>
<summary>Answer</summary>

One when the server answers with an image manifest straight away, as
it does for a digest of a single image. Two when it answers with an
index: we pick our platform's entry, then fetch that entry by its
digest. If the second answer is another index, we refuse it.

</details>

## Next chapter

We know exactly which layers to fetch, with their digest and size, but
haven't downloaded a byte of them, and `./rootfs` is still empty.
Chapter 7 closes that gap all the way: by its end, the tool pulls a
whole image and you run Alpine with `runc`. A layer can be hundreds of
megabytes, so we can't hold it in memory the way we held the manifest.
It has to flow through: read a little, write a little. That's a
*stream*. While the bytes go by, we compute their `sha256` and refuse
the file if it doesn't match the digest. The same check closes this
chapter's first gap, for manifests. Two parts will be rough on purpose
(one layer at a time, and the system's `tar` command to unpack), and
Chapters 8 and 9 replace them.
