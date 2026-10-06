# Chapter 7: The Whole Pull, Rough Version

Chapter 6 ended knowing exactly which layers make up an image, and
having downloaded none of them. This chapter changes that, all the way
to the end. By the last page, the tool pulls a real image into a
folder, and you start a shell inside it with `runc`.

Getting there in one chapter means taking two shortcuts, and we'll say
so at the line where each one happens. Layers download one at a time
(Chapter 8 does them all at once), and the system's own `tar` command
unpacks them (Chapter 9 replaces it with our own code, which gets one
thing right that `tar` can't). Everything else is built properly: a
layer is never held in memory, every byte is checked against its
fingerprint, and a layer you already have is never downloaded twice.

New in this chapter: streams, `for await`, `async function*`, `pipeline`,
`createHash`, `node:fs/promises`, `beforeEach`/`afterEach`, `execFile`,
and `entries()`.

## Where we are

Pulling an image takes six stages. This chapter's are marked ▶:

- ✓ 1. Read the image name (Ch3)
- ✓ 2. Ask the registry, get a token (Ch4–5)
- ✓ 3. Read the manifest, pick the platform (Ch6)
- ▶ **4. Download the layers, check them** (this chapter; faster in Ch8)
- ▶ **5. Unpack them into a folder** (this chapter, roughly; properly in Ch9)
- ▶ **6. Run it with runc** (this chapter; more in Ch11)

Here's the tool as Chapter 6 left it. We'll pull into `/tmp/oci-demo/rootfs`
from now on, outside your project, because `runc` will want a folder
of its own:

```
$ npm start --silent -- alpine:3.20 /tmp/oci-demo/rootfs
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
would pull into /tmp/oci-demo/rootfs
```

```
$ ls /tmp/oci-demo/rootfs
```

```
ls: cannot access '/tmp/oci-demo/rootfs': No such file or directory
```

"Would pull into", and nothing there. That last line has been a
placeholder since Chapter 3.

Six chapters in, the tool can find any image on any registry, but it
has never produced a single file. This chapter fills in the remaining
three stages, roughly, so the tool works from start to finish. From
here on, each chapter makes a working tool better, and you can run the
result after every one.

By the end of this chapter you can:

- Download a layer of any size without holding it in memory, and refuse
  it if a single byte is wrong.
- Keep downloads in a cache, so pulling the same image twice costs
  nothing.
- Pull `alpine` into a folder and start a shell inside it with `runc`.

## A layer, by hand

A layer lives at `/v2/<repository>/blobs/<digest>`. ("Blob" is the
registry's word for any stored file: a layer, a config, a manifest.)
Ask Docker Hub for alpine's one layer, with a token as in Chapter 5:

```
$ TOKEN=$(curl -sS "https://auth.docker.io/token?service=registry.docker.io&scope=repository:library/alpine:pull" \
    | node -p 'JSON.parse(require("fs").readFileSync(0, "utf8")).token')
$ curl -sS -o /dev/null -D - -H "Authorization: Bearer $TOKEN" \
    https://registry-1.docker.io/v2/library/alpine/blobs/sha256:25f1d6b1951ac8eb3740558fe94cb83d377bdadf95fd9f98b50d2e1b96130471
```

```
HTTP/2 307
content-type: application/octet-stream
content-length: 0
location: https://production.cloudfront.docker.com/registry-v2/docker/registry/v2/blobs/sha256/25/25f1d6b1951ac8eb3740558fe94cb83d377bdadf95fd9f98b50d2e1b96130471/data?Expires=1791206293&Signature=PK7Nry1a0n…
```

(Headers trimmed, and the `location` cut short.) Not the layer:
`307` means "it's over there." The registry hands the actual download
to a separate server built for big files (CloudFront, here), with a
signed address that expires. Every big registry does something like
this. `curl -L` follows the redirect:

```
$ curl -sS -L -H "Authorization: Bearer $TOKEN" https://registry-1.docker.io/v2/library/alpine/blobs/sha256:25f1d6b1951ac8eb3740558fe94cb83d377bdadf95fd9f98b50d2e1b96130471 -o layer.tar.gz
$ wc -c layer.tar.gz
```

```
3630321 layer.tar.gz
```

Exactly the `size` from the manifest. Now its fingerprint:

```
$ sha256sum layer.tar.gz
```

```
25f1d6b1951ac8eb3740558fe94cb83d377bdadf95fd9f98b50d2e1b96130471  layer.tar.gz
```

Exactly the digest we asked for. This is the whole security story of
container images in one line: the manifest names each layer by the
hash of its bytes, so you can check what you got without trusting
whoever sent it. And what's inside?

```
$ tar -tzf layer.tar.gz | head
```

```
bin/
bin/arch
bin/ash
bin/base64
bin/bbconfig
bin/busybox
bin/cat
bin/chattr
bin/chgrp
bin/chmod
```

A compressed folder, as Chapter 1 said. Unpack it and you have Alpine's
files. Delete the download (`rm layer.tar.gz`). The code will do all of
this itself.

## The plan

1. **`RegistryClient.fetchBlob`**: ask for a blob, get its bytes as a
   stream.
2. **`src/store.ts`**: a `ContentStore`, a folder that keeps a file only
   if its bytes match its name.
3. **`src/pull.ts`**: `downloadLayer`, which fetches a layer into the
   store unless it's already there.
4. **`src/resolve.ts`**: check manifests by their digest too, as
   promised in Chapter 6.
5. **`src/unpack.ts`**: the shortcut. Let the system's `tar` unpack.
6. **`src/main.ts`**: put it together, and run it with `runc`.

## Step 1: ask for a layer

Every response so far was small, and we read it all at once with
`arrayBuffer()`. A layer can be hundreds of megabytes. Reading it all
at once means holding it all in memory, and a few big layers at once
could take gigabytes.

The fix is to handle the bytes as they arrive, a chunk at a time:
read a chunk, deal with it, drop it, get the next one. Data you handle
that way is a **stream**. A `Response` already gives you one: its
`body`. Nothing is read until someone asks for the next chunk.

How do you ask? With a loop:

```ts
for await (const chunk of response.body) {
  // chunk is a Uint8Array: the next few kilobytes
}
```

`for await` is a `for` loop that waits for each item to arrive, like
`async for` in Python. Anything you can loop over this way is an
**async iterable**, and TypeScript's name for its type is
`AsyncIterable<Uint8Array>`: "something that hands out `Uint8Array`
chunks, one at a time, when they're ready."

Add to `RegistryClient` in `src/registry.ts`, below `fetchManifest`:

```ts
  // A layer (or any blob), as a stream of chunks: nothing is held in memory.
  // Registries usually answer with a redirect to a download server;
  // fetch follows it on its own.
  async fetchBlob(repository: string, digest: string): Promise<AsyncIterable<Uint8Array>> {
    const url = `${this.baseUrl}${repository}/blobs/${digest}`
    const response = await this.authorizedGet(url, `repository:${repository}:pull`, {})
    if (response.status !== 200 || response.body === null) {
      throw new RegistryError(url, response.status, "unexpected status")
    }
    return response.body
  }
```

Most of the work is done by Chapter 5's `authorizedGet`: the `401`,
the token, the retry, and reusing a token we already have. The method
returns the stream itself, not its bytes. The caller decides where the
bytes go.

`fetch` follows the `307` on its own, like `curl -L`. And it does one
more careful thing: it drops our `authorization` header when the
redirect goes to a different server. Our Docker Hub token is none of
CloudFront's business.

`response.body` can be `null` (a response with no body at all), so
that's checked along with the status. After the `if`, the compiler
knows it isn't `null`.

To test it, a test needs to read a whole stream into a string. Add a
helper at the bottom of `src/registry.test.ts`:

```ts
// Read a whole stream into one string. Fine in a test, where it's tiny.
async function textOf(chunks: AsyncIterable<Uint8Array>): Promise<string> {
  let text = ""
  // TextDecoder with { stream: true } copes with a character split across chunks.
  const decoder = new TextDecoder()
  for await (const chunk of chunks) {
    text += decoder.decode(chunk, { stream: true })
  }
  return text + decoder.decode()
}
```

`{ stream: true }` matters for real text. A character like `é` is two
bytes in UTF-8, and a chunk can end between them. With `stream: true`
the decoder holds on to half a character until the next chunk arrives.
The final `decode()` with no argument hands over anything still held.

And the test, below it. A `new Response("hello")` has a real stream as
its body, so `replyingInTurn` from Chapter 5 works as is:

```ts
describe("RegistryClient.fetchBlob", () => {
  it("streams the blob, getting a token first if asked", async () => {
    // A 401 first, then the blob: the same dance as for a manifest.
    const { http, get } = replyingInTurn(unauthorized(), new Response("hello"))
    const client = new RegistryClient(http, "docker.io", tokenGiving("abc"))

    const chunks = await client.fetchBlob("library/alpine", "sha256:2cf24dba")

    expect(await textOf(chunks)).toBe("hello")
    expect(get).toHaveBeenNthCalledWith(
      2,
      "https://registry-1.docker.io/v2/library/alpine/blobs/sha256:2cf24dba",
      expect.objectContaining({ authorization: "Bearer abc" }),
    )
  })
})
```

> **Your turn.** A second test in the same `describe`: "throws
> RegistryError when the blob isn't there". The fake answers
> `new Response(null, { status: 404 })` (use `replyingWith`), the
> registry is `"ghcr.io"`, and the client gets `neverAuth`, since no
> token should be asked for.

Here it is:

```ts
  it("throws RegistryError when the blob isn't there", async () => {
    const { http } = replyingWith(new Response(null, { status: 404 }))

    // An async failure: await the expect, or the test ends too early.
    await expect(new RegistryClient(http, "ghcr.io", neverAuth).fetchBlob("x/y", "sha256:2cf24dba")).rejects.toThrow(
      RegistryError,
    )
  })
```

```
$ npm run check
```

```
 Test Files  6 passed (6)
      Tests  55 passed (55)
```

## Step 2: a store that checks what it keeps

The bytes need to go somewhere, and they need checking on the way.
Both jobs belong to one small class. A **content store** is a folder
where every file is named after the sha256 of its own bytes. That
simple rule buys three things:

- **Checking for free.** A file named `25f1d6b1…` that doesn't hash to
  `25f1d6b1…` is impossible by construction, because the store refuses
  to keep it.
- **A cache for free.** If the file is there, it's the right bytes. Its
  name proves it. So a second pull skips the download.
- **Sharing for free.** Two images built on the same Alpine layer store
  it once, because it has one name.

Docker, containerd and every other runtime keep layers this way.

The class has one job: keep a file only if its bytes match its name.
It doesn't know about registries, tokens or manifests. That's the
*single responsibility principle*, the "S" in SOLID: one class, one
reason to change.

New file, `src/store.ts`. First the error type and the easy parts:

```ts
import { createHash } from "node:crypto"
import { createWriteStream } from "node:fs"
import { access, mkdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import { pipeline } from "node:stream/promises"
import type { Descriptor } from "./manifest.ts"

export class StoreError extends Error {
  constructor(problem: string) {
    super(`store: ${problem}`)
    this.name = "StoreError"
  }
}

// "sha256:" then 64 hex characters: the only digests the store accepts.
const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/

// A folder of files, each named after the sha256 of its own bytes.
// Its one job: keep a file only if its bytes match its name.
export class ContentStore {
  private readonly root: string

  constructor(root: string) {
    this.root = root
  }

  // Where a blob lives: <root>/sha256/<hex>.
  pathFor(digest: string): string {
    // Only "sha256:" plus exactly 64 lowercase hex characters. Anything
    // else (sha512, "../", a "/") is refused, so a name can't escape the folder.
    if (!SHA256_DIGEST.test(digest)) {
      throw new StoreError(`unsupported digest ${digest}`)
    }
    return join(this.root, "sha256", digest.slice("sha256:".length))
  }

  // Is this blob already here? access() throws if the file is missing.
  async has(digest: string): Promise<boolean> {
    try {
      await access(this.pathFor(digest))
      return true
    } catch {
      return false
    }
  }
}
```

The imports are all from Node itself, no packages. Each `node:` module
is one area of the standard library, like Go's `crypto/sha256`, `os`
and `path/filepath`. `node:fs/promises` holds the file functions that
return Promises, so you can `await` them. `join` builds a path with the
right separators, like `filepath.Join`.

The digest goes straight into a file path, so `pathFor` checks it
itself. zod already checked it in Chapter 6, but the store can't know
every caller did. A digest like `sha256:../../.bashrc` would otherwise
point outside the store. The pattern also refuses other hash algorithms
(`DIGEST_PATTERN` allows `sha512:`), because we only compute sha256 and
can't check a file stored under any other name.

Now the method that does the real work. Add it below `has`:

```ts
  // Stream `chunks` to disk, hashing and counting them on the way.
  // Returns the file's path, or throws if the bytes aren't what
  // `expected` says. A bad file never appears under its real name.
  async put(expected: Descriptor, chunks: AsyncIterable<Uint8Array>): Promise<string> {
    const path = this.pathFor(expected.digest)
    const partial = `${path}.partial`
    // Make sure <root>/sha256 exists. recursive: true is "mkdir -p":
    // it creates missing parents and is fine if the folder is there.
    await mkdir(join(this.root, "sha256"), { recursive: true })

    const hash = createHash("sha256")
    let size = 0
    try {
      await pipeline(
        chunks,
        // A step in the middle: sees every chunk, passes it on unchanged.
        async function* (source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
          for await (const chunk of source) {
            size += chunk.length
            // Stop early: never write more than the manifest promised.
            if (size > expected.size) {
              throw new StoreError(`${expected.digest} is bigger than ${expected.size} bytes`)
            }
            hash.update(chunk)
            yield chunk
          }
        },
        createWriteStream(partial),
      )
      const actual = `sha256:${hash.digest("hex")}`
      if (size !== expected.size || actual !== expected.digest) {
        throw new StoreError(`expected ${expected.digest} (${expected.size} bytes), got ${actual} (${size} bytes)`)
      }
    } catch (err) {
      // Whatever went wrong, don't leave half a file behind.
      await rm(partial, { force: true })
      throw err
    }
    // rename() is all or nothing: the file appears complete, or not at all.
    await rename(partial, path)
    return path
  }
```

This is the heart of the chapter, so piece by piece.

**`pipeline(source, step, destination)`** connects streams in a row
and pushes every chunk through, start to end, like `a | b | c` in a
shell. It waits when the destination is slow: if the disk falls behind,
it stops asking the network for more until the disk catches up, so
chunks don't pile up in memory. It also cleans up: if any part fails,
it stops all of them, and the Promise it returns rejects with that
error.

**`async function*`** is a new kind of function: a *generator*. A
normal function returns once. A generator can hand out many values, one
at a time, with `yield`, like a Python generator. The `async` makes it
able to `await` between them. Here it takes in the chunks
(`for await ... of source`) and passes each one on (`yield chunk`)
after looking at it. That makes it a step in the middle of the pipe.
Its return type, `AsyncGenerator<Uint8Array>`, says "hands out
`Uint8Array`s, one at a time."

**`createHash("sha256")`** makes a hash you feed in pieces:
`hash.update(chunk)` for each chunk, then `hash.digest("hex")` once at
the end for the answer. Feeding it chunk by chunk gives the same result
as hashing the whole file at once. So the checksum is ready the moment
the last byte is written, and the file is never read twice.

**Counting bytes as they arrive** is about more than tidiness. A
broken or hostile server could send bytes forever. The manifest said
3,630,321 bytes, so byte 3,630,322 is an error, and we stop right
there, not when the disk is full.

**`.partial`, then `rename`.** The bytes go to `<digest>.partial`
first, and only get their real name once they're checked. Renaming a
file is all or nothing: there is never a moment when the real name
points at half a file. If the program crashes midway, there's a
`.partial` left over, but `has()` will never mistake it for the real
thing. And if anything fails, the `catch` deletes the `.partial`
(`force: true` means "and don't complain if it isn't there"), then
re-throws, so the caller still sees the error.

`hash` and `size` are declared outside the generator but changed inside
it. A function can use the variables around where it was written.
That's a *closure*, and Go and Python have them too.

### Testing against a real folder

The store's job is files, so its tests use a real folder, a fresh
empty one per test, in the system's temp area. Faking the disk would
mean faking `mkdir`, `rename`, `rm` and write streams, and the fakes
would be more code than the store.

Two test files will need a temp folder (Step 3 adds the second). So,
as with `fake-http.ts` and `test-manifests.ts`, the helper gets its own
file from the start. Create `src/temp-folder.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach } from "vitest"

// Call inside a describe(): every test gets a fresh, empty folder, and it's
// deleted afterwards. The folder changes per test, so this returns a
// function to ask for the current one, not the path itself.
export function useTempFolder(): () => string {
  let folder = ""
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "oci-pull-test-"))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })
  return () => folder
}
```

`beforeEach` and `afterEach` are Vitest's hooks: functions that run
before and after every test in the `describe` they're called from, like
`setUp` and `tearDown` in Python's `unittest`. `mkdtemp` makes a folder
with a random ending (`oci-pull-test-Xb3kQ9`), so tests never collide.

The return type `() => string` is "a function that takes nothing and
returns a string." Why not return the path itself? Because when
`useTempFolder()` runs, no test has started yet, so there's no folder.
A new one is made before each test. The function you get back reads
the variable at the moment you call it, so it always gives the current
test's folder.

The test data too, since Step 3 needs it as well. Create
`src/test-blobs.ts`:

```ts
// A tiny blob for tests: the five bytes "hello", and their real sha256
// (from `echo -n hello | sha256sum`).
export const HELLO = {
  mediaType: "text/plain",
  digest: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  size: 5,
}

// Text, sent as separate chunks the way a download arrives.
// `async function*` makes something you can loop over with `for await`.
export async function* chunksOf(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield new TextEncoder().encode(part)
  }
}
```

`chunksOf("hel", "lo")` is a fake download: the same kind of thing as
`response.body`, handing out two chunks. That's a fake network made
from five lines, with no `vi.fn` needed. The store only asks for "an
async iterable of chunks," and a generator is one.

Now `src/store.test.ts`:

```ts
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { ContentStore, StoreError } from "./store.ts"
import { useTempFolder } from "./temp-folder.ts"
import { chunksOf, HELLO } from "./test-blobs.ts"

describe("ContentStore", () => {
  const root = useTempFolder()

  it("keeps a blob under its own digest", async () => {
    const store = new ContentStore(root())

    const path = await store.put(HELLO, chunksOf("hel", "lo"))

    expect(path).toBe(join(root(), "sha256", "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"))
    expect(await readFile(path, "utf8")).toBe("hello")
    expect(await store.has(HELLO.digest)).toBe(true)
  })

  it("refuses bytes that don't match the digest, and leaves nothing behind", async () => {
    const store = new ContentStore(root())

    // Same length, different bytes: "jello" is not "hello".
    await expect(store.put(HELLO, chunksOf("jello"))).rejects.toThrow(StoreError)

    expect(await store.has(HELLO.digest)).toBe(false)
    expect(await readdir(join(root(), "sha256"))).toEqual([])
  })
})
```

The second test checks the cleanup: after a refused download, the
folder is empty. `readdir` lists a folder's files, like `os.ReadDir`.

Two more checks, then run them.

> **Your turn.** Two tests inside the same `describe`. "stops as soon as
> there are more bytes than promised": `put(HELLO, chunksOf("hello", " and much more"))`
> rejects with `"is bigger than 5 bytes"`. "refuses a digest that isn't
> sha256": `store.pathFor("sha512:abcd")` throws
> `"unsupported digest sha512:abcd"` (this one isn't async), and so does
> `store.pathFor("sha256:../../.bashrc")`.

Here it is:

```ts
  it("stops as soon as there are more bytes than promised", async () => {
    const store = new ContentStore(root())

    await expect(store.put(HELLO, chunksOf("hello", " and much more"))).rejects.toThrow("is bigger than 5 bytes")
  })

  it("refuses a digest that isn't sha256", () => {
    const store = new ContentStore(root())

    expect(() => store.pathFor("sha512:abcd")).toThrow("unsupported digest sha512:abcd")
    // A name that tries to climb out of the store's folder.
    expect(() => store.pathFor("sha256:../../.bashrc")).toThrow("unsupported digest")
  })
```

```
$ npm run check
```

```
 Test Files  7 passed (7)
      Tests  59 passed (59)
```

Now see the cleanup test earn its place. In `put`, delete the line
`await rm(partial, { force: true })` (and `rm` from the import, or the
compiler complains it's unused), then:

```
$ npm test
```

```
 FAIL  src/store.test.ts > ContentStore > refuses bytes that don't match the digest, and leaves nothing behind
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824.partial",
+ ]

 ❯ src/store.test.ts:28:51
     26|
     27|     expect(await store.has(HELLO.digest)).toBe(false)
     28|     expect(await readdir(join(root(), "sha256"))).toEqual([])
       |                                                   ^
     29|   })
     30|

 Test Files  1 failed | 6 passed (7)
      Tests  1 failed | 58 passed (59)
```

(Separator lines trimmed.) Line 27 still passed: the bad bytes never
got the real name, thanks to `.partial` and `rename`. But line 28
caught the leftover. Without the cleanup, every failed download would
leave a dead file in your cache forever. Put the line (and the import)
back.

## Step 3: download a layer into the store

Now join the two: fetch a layer from the registry, and put it in the
store, unless it's already there.

The function only needs one thing from the registry: `fetchBlob`. That
calls for the same move as `ManifestSource` in Chapter 6.

> **Your turn.** Create `src/pull.ts` with an exported interface
> `BlobSource` that has one method, `fetchBlob`, with the same
> signature as `RegistryClient.fetchBlob`. Then export a type
> `LayerResult` that is either the string `"downloaded"` or the string
> `"cached"`.

Here it is:

```ts
import type { Descriptor } from "./manifest.ts"
import type { ContentStore } from "./store.ts"

// All downloadLayer needs from a registry: one method, as in Chapter 6.
export interface BlobSource {
  fetchBlob(repository: string, digest: string): Promise<AsyncIterable<Uint8Array>>
}

// What happened to one layer, for the progress line.
export type LayerResult = "downloaded" | "cached"
```

`"downloaded" | "cached"` is a one-of type made of exact strings. A
function returning a `LayerResult` can return those two strings and no
others. A typo like `"cahced"` is a compile error, not a bug.

The function itself, below:

```ts
// Make sure one layer is in the store. If it's already there (its name
// is its checksum, so it can only be the right bytes), skip the download.
export async function downloadLayer(
  source: BlobSource,
  store: ContentStore,
  repository: string,
  layer: Descriptor,
): Promise<LayerResult> {
  if (await store.has(layer.digest)) {
    return "cached"
  }
  await store.put(layer, await source.fetchBlob(repository, layer.digest))
  return "downloaded"
}
```

Five lines, because the store does the hard part. Notice that nothing
here reads a chunk. The stream goes straight from `fetchBlob` into
`put`, and the bytes flow network → hash → disk without this function
ever touching them.

For the test, a fake `BlobSource` whose every blob is `"hello"`, with
its mock kept so a test can count the calls. It's the same shape as
Chapter 5's `FakeHttp`. Create `src/pull.test.ts`:

```ts
import { type Mock, describe, expect, it, vi } from "vitest"
import { type BlobSource, downloadLayer } from "./pull.ts"
import { ContentStore } from "./store.ts"
import { useTempFolder } from "./temp-folder.ts"
import { chunksOf, HELLO } from "./test-blobs.ts"

// The fake, and its mock method so a test can check the calls.
interface FakeSource {
  source: BlobSource
  fetchBlob: Mock<BlobSource["fetchBlob"]>
}

// A pretend registry whose every blob is the bytes of "hello".
function helloSource(): FakeSource {
  const fetchBlob = vi.fn<BlobSource["fetchBlob"]>(async () => chunksOf("hello"))
  return { source: { fetchBlob }, fetchBlob }
}

describe("downloadLayer", () => {
  const folder = useTempFolder()

  it("downloads a layer that isn't in the store", async () => {
    const { source, fetchBlob } = helloSource()
    const store = new ContentStore(folder())

    expect(await downloadLayer(source, store, "library/alpine", HELLO)).toBe("downloaded")
    expect(fetchBlob).toHaveBeenCalledWith("library/alpine", HELLO.digest)
    expect(await store.has(HELLO.digest)).toBe(true)
  })
})
```

The store here is the real one, in a temp folder. Only the network is
faked. That keeps the test honest about what really matters: the bytes
end up in the store, and get checked on the way.

> **Your turn.** "skips a layer that's already there": download `HELLO`
> once, then a second `downloadLayer` call returns `"cached"`, and
> `fetchBlob` was called only once in total.

Here it is:

```ts
  it("skips a layer that's already there", async () => {
    const { source, fetchBlob } = helloSource()
    const store = new ContentStore(folder())
    await downloadLayer(source, store, "library/alpine", HELLO)

    // The second time, the store already has it: no second download.
    expect(await downloadLayer(source, store, "library/alpine", HELLO)).toBe("cached")
    expect(fetchBlob).toHaveBeenCalledTimes(1)
  })
```

```
$ npm run check
```

```
 Test Files  8 passed (8)
      Tests  61 passed (61)
```

## Step 4: check manifests too

Chapter 6 left a gap: when we fetch a manifest *by digest* (the entry
picked from an index, or a user's `alpine@sha256:...`), we never check
that the bytes really hash to that digest. Layers are now checked, so
a server could still swap the manifest instead, pointing at different
layers. Close that door.

Hashing bytes we already hold in memory takes one line. Two files will
want it (`resolve.ts` now, and the tests), so it gets its own small
file, `src/digest.ts`:

```ts
import { createHash } from "node:crypto"

// "sha256:<hex>" for these bytes: the same fingerprint a registry uses.
export function sha256Digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}
```

That's `createHash` again, fed all the bytes in one `update` this time.
(The store can't use this function, because it never holds all the
bytes at once. Feeding the hash chunk by chunk is the whole point
there.)

In `src/resolve.ts`, add the check at the bottom:

```ts
// Are these the bytes we asked for? A digest names exact bytes, so a
// server can't swap in a different manifest under the same name.
function checkDigest(raw: RawManifest, digest: string): void {
  const actual = sha256Digest(raw.bytes)
  if (actual !== digest) {
    throw new ManifestError(`asked for ${digest}, got bytes for ${actual}`)
  }
}
```

Then use it in `resolveImage`. Right after the first `fetchManifest`:

```ts
  // Asked by digest? Then we know exactly which bytes to expect.
  if (DIGEST_PATTERN.test(reference)) {
    checkDigest(raw, reference)
  }
```

and right after the second one, the entry picked from the index:

```ts
  checkDigest(rawImage, entry.digest)
```

and the imports at the top:

```ts
import { sha256Digest } from "./digest.ts"
import { DIGEST_PATTERN } from "./reference.ts"
```

Why two checks, and why is the first one an `if`? To check a download
you need to know the right answer in advance:

- A **digest** (`sha256:c64c…`) is a fingerprint of exact bytes. Hash
  what arrived; the same fingerprint means the right bytes.
- A **tag** (`3.20`) is a name the publisher can move. Today it points
  at one image, and after a security fix, at another. Nothing in "3.20"
  says which bytes to expect, so there's nothing to compare.

So the first fetch is checked only if the user typed a digest
(`DIGEST_PATTERN` from Chapter 3 tells the two apart). The second fetch
is always checked: we fetch the entry we picked from the index by the
digest the index gave us, so now there's always a fingerprint to
compare. A tag pull is checked from the second step on.

Run the tests:

```
$ npm test
```

```
 FAIL  src/resolve.test.ts > resolveImage > follows an index to the entry for our platform
ManifestError: manifest: asked for sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e, got bytes for sha256:7ff2162921815d7cc8cd13d13b4fdc7b4ce3e05c63ae8dc788dbc87c01d98f1c
 ❯ checkDigest src/resolve.ts:54:11
     52|   const actual = sha256Digest(raw.bytes)
     53|   if (actual !== digest) {
     54|     throw new ManifestError(`asked for ${digest}, got bytes for ${actu…
       |           ^
     55|   }
     56| }
 ❯ resolveImage src/resolve.ts:41:3
 ❯ src/resolve.test.ts:37:20

 FAIL  src/resolve.test.ts > resolveImage > refuses an index that points to another index
AssertionError: expected [Function] to throw error including 'is another index, not an image' but got 'manifest: asked for sha256:c64c687cbe…'

Expected: "is another index, not an image"
Received: "manifest: asked for sha256:c64c687cbea9300178b30c95835354e34c4e4febc4badfe27102879de0483b5e, got bytes for sha256:c2a3b3a938ff2c7de4a0cee77973a95ac91f2bb5e52f82d5602927e716adceef"

 ❯ src/resolve.test.ts:51:83

 Test Files  1 failed | 7 passed (8)
      Tests  2 failed | 59 passed (61)
```

(Separator lines and one code excerpt trimmed.) The new check works,
and the first thing it catches is *our own test data*. In Chapter 6,
`ALPINE_AMD64` had its annotations trimmed, and `bytesOf` wrote compact
JSON. So the fixture's bytes were never the bytes Docker Hub sent, and
they hash to `7ff21629…`, not to the `c64c687c…` the index claims. The
check is right and the fixture was quietly lying.

The fix is to make the fixture the *real* bytes. Docker Hub's JSON is
indented with two spaces, and `JSON.stringify` can do exactly the same.
Its third argument is the indent. In `src/test-manifests.ts`, change
`bytesOf`:

```ts
// A value as the bytes a server would send: JSON text, UTF-8 encoded.
// Docker Hub indents with two spaces; the `null, 2` does the same, so
// ALPINE_AMD64 comes out byte for byte as Docker Hub sent it.
export function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2))
}
```

(The `null` in the middle is a slot for a filter function we don't
need.) Then replace `ALPINE_AMD64` with the complete manifest, every
field in the order the server sent it, all annotations included:

```ts
// The image manifest the amd64 entry points to: every field, in the
// server's order, so its bytes (see bytesOf) are exactly the real ones.
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
  annotations: {
    "com.docker.official-images.bashbrew.arch": "amd64",
    "org.opencontainers.image.base.name": "scratch",
    "org.opencontainers.image.created": "2026-04-16T23:53:23Z",
    "org.opencontainers.image.revision": "0db70ae354ee747109ce0b9a0cfbcd3c907bc822",
    "org.opencontainers.image.source":
      "https://github.com/alpinelinux/docker-alpine.git#0db70ae354ee747109ce0b9a0cfbcd3c907bc822:x86_64",
    "org.opencontainers.image.url": "https://hub.docker.com/_/alpine",
    "org.opencontainers.image.version": "3.20.10",
  },
}
```

and update the comment at the top of the file to match:

```ts
// Real manifests for tests, copied from Docker Hub's alpine:3.20
// (the index trimmed to a few entries; the amd64 manifest complete).
```

Copy those values exactly, because a single changed character gives a
different hash. That's the point.

```
$ npm test
```

```
 FAIL  src/resolve.test.ts > resolveImage > refuses an index that points to another index
...
      Tests  1 failed | 60 passed (61)
```

(Cut short.) One down. The amd64 fixture now hashes to exactly
`c64c687c…`, the real digest, and the "follows an index" test passes
with real bytes.

The one still failing hands the alpine index's bytes back under the
amd64 digest. It was testing "an index inside an index," but the
digest check now catches the wrong bytes first. To test the inner-index
rule, the outer index has to point at the inner one by its *true*
digest. `sha256Digest` can compute that. Replace the test in
`src/resolve.test.ts`:

```ts
  it("refuses an index that points to another index", async () => {
    // An outer index whose amd64 entry is the alpine index itself.
    // Its digest is computed, so the digest check passes and the
    // "another index" check is what's tested.
    const innerDigest = sha256Digest(bytesOf(ALPINE_INDEX))
    const outer = {
      schemaVersion: 2,
      manifests: [{ mediaType: OCI_INDEX, digest: innerDigest, size: 1, platform: amd64 }],
    }
    const fetchManifest = vi
      .fn<ManifestSource["fetchManifest"]>()
      .mockResolvedValueOnce(raw(OCI_INDEX, outer, INDEX_DIGEST))
      .mockResolvedValueOnce(raw(OCI_INDEX, ALPINE_INDEX, innerDigest))

    // An async failure: await the expect, or the test ends too early.
    await expect(resolveImage({ fetchManifest }, "library/alpine", "3.20", amd64)).rejects.toThrow(
      "is another index, not an image",
    )
  })
```

with `import { sha256Digest } from "./digest.ts"` at the top.

> **Your turn.** One more test, for the check itself: "refuses a
> manifest whose bytes don't match the digest it was asked for". Make
> `swapped`, a copy of `ALPINE_AMD64` with its layer's `size` changed to
> `1` (use `...` as in Chapter 6). The fake answers the index first,
> then `swapped` *claiming* to be `AMD64_DIGEST`. Expect a rejection
> containing `` `asked for ${AMD64_DIGEST}, got bytes for sha256:` ``.

Here it is:

```ts
  it("refuses a manifest whose bytes don't match the digest it was asked for", async () => {
    // The right name, the wrong bytes: one layer's size changed.
    const swapped = { ...ALPINE_AMD64, layers: [{ ...ALPINE_AMD64.layers[0], size: 1 }] }
    const fetchManifest = vi
      .fn<ManifestSource["fetchManifest"]>()
      .mockResolvedValueOnce(raw(OCI_INDEX, ALPINE_INDEX, INDEX_DIGEST))
      .mockResolvedValueOnce(raw(OCI_IMAGE, swapped, AMD64_DIGEST))

    await expect(resolveImage({ fetchManifest }, "library/alpine", "3.20", amd64)).rejects.toThrow(
      `asked for ${AMD64_DIGEST}, got bytes for sha256:`,
    )
  })
```

That's exactly the attack the check exists for: a manifest that says
the layer is a different size (or a different layer entirely), served
under the trusted name.

```
$ npm run check
```

```
 Test Files  8 passed (8)
      Tests  62 passed (62)
```

## Step 5: the shortcut: let `tar` unpack

Now the first deliberate shortcut. Your system already has `tar`, and
it can unpack a layer, so for now we run it as a separate program.

Create `src/unpack.ts`:

```ts
import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { promisify } from "node:util"

// execFile runs a program with a list of arguments (no shell in between,
// so odd characters in a path can't do harm). promisify turns its
// callback style into a function that returns a Promise.
const run = promisify(execFile)

// SHORTCUT, replaced in Chapter 9: let the system's tar unpack a layer.
// It gets the files right, but not deletions between layers.
export async function unpackWithSystemTar(layerFile: string, folder: string): Promise<void> {
  await mkdir(folder, { recursive: true })
  // -x extract, -z it's gzipped, -f from this file, -C into this folder.
  await run("tar", ["-xzf", layerFile, "-C", folder])
}
```

`execFile` is Node's `exec.Command(...).Run()` from Go, or
`subprocess.run([...])` from Python. It passes the arguments as a list,
straight to `tar`, with no shell to misread a space or a `;` in a path.

Many older Node functions report back by calling a function you pass
in (a *callback*) instead of returning a Promise. `promisify` wraps one
of those so you can `await` it. If `tar` exits with an error, the
Promise rejects.

As in the store, `mkdir(folder, { recursive: true })` is `mkdir -p`: it creates parent
folders too, and doesn't complain if the folder exists.

Why is this a shortcut and not the real thing? Two reasons, both fixed
in Chapter 9. First, layers can *delete* files from the layers below
them, using specially named marker files. `tar` knows nothing about
that, so it unpacks the markers as ordinary files. Second, some layers
aren't gzipped (newer ones use a format called zstd). For `alpine`,
neither matters, so the shortcut works.

No test for this one. It's three lines that call another program, and
Chapter 9 replaces it with code that does get tested.

```
$ npm run check
```

```
 Test Files  8 passed (8)
      Tests  62 passed (62)
```

## Step 6: put it together

In `src/main.ts`, `describeImage` stops printing the layers. They now
get one line each as they download, with the result. Replace it with:

```ts
// What we're about to pull: the platform, the manifest's digest, and
// the config. Each layer gets its own line as it downloads.
function describeImage(platform: Platform, resolved: ResolvedImage): string {
  return [
    `platform   ${formatPlatform(platform)}`,
    `manifest   ${resolved.digest ?? "(not sent)"}`,
    `config     ${resolved.manifest.config.digest}`,
  ].join("\n")
}
```

Then, in `main`, replace the `would pull into` line with the real
thing:

```ts
    // Downloads go into a cache that outlives this run, so a layer that's
    // already there is never downloaded twice.
    const store = new ContentStore(join(homedir(), ".cache", "oci-pull"))
    const { layers } = resolved.manifest
    // ROUGH: one layer at a time. Chapter 8 downloads them all at once.
    // entries() gives [position, item] pairs, like enumerate() in Python.
    for (const [i, layer] of layers.entries()) {
      const result = await downloadLayer(registry, store, ref.repository, layer)
      console.log(`layer ${i + 1}/${layers.length}  ${layer.digest}  ${megabytes(layer.size)}  ${result}`)
    }

    // Unpack in order: each layer goes on top of the ones before it.
    for (const layer of layers) {
      await unpackWithSystemTar(store.pathFor(layer.digest), outputDir)
    }
    console.log(`unpacked   ${outputDir}`)
```

The store lives in `~/.cache/oci-pull`, the usual place on Linux for
files a program can rebuild. `homedir()` is your home folder.

`registry` is passed as a `BlobSource`. It has a matching `fetchBlob`,
so it fits, just as it fits `ManifestSource`. One object, seen through
two small interfaces.

`for (const [i, layer] of layers.entries())` loops over position and
item together. `[i, layer]` unpacks each pair into two names, the way
`for i, layer in enumerate(layers)` does in Python.

The order of the second loop matters. Layer 2 is unpacked on top of
layer 1, so if both have `/etc/hosts`, layer 2's copy wins. That's how
an image's layers make one folder.

> **Your turn.** Finish `main.ts`. Import `homedir` from `node:os`,
> `join` from `node:path`, `downloadLayer` from `./pull.ts`,
> `ContentStore` and `StoreError` from `./store.ts`, and
> `unpackWithSystemTar` from `./unpack.ts`. Then add `StoreError` to
> the errors the `catch` prints.

Here it is:

```ts
import { homedir } from "node:os"
import { join } from "node:path"
import { AnonymousAuthenticator, AuthError } from "./auth.ts"
import { FetchHttpClient } from "./http.ts"
import { formatPlatform, hostPlatform, ManifestError, type Platform } from "./manifest.ts"
import { downloadLayer } from "./pull.ts"
import { InvalidReferenceError, parseReference, target } from "./reference.ts"
import { type ApiCheck, RegistryClient, RegistryError } from "./registry.ts"
import { resolveImage, type ResolvedImage } from "./resolve.ts"
import { ContentStore, StoreError } from "./store.ts"
import { unpackWithSystemTar } from "./unpack.ts"

// ...

  } catch (err) {
    // Any of our own errors: print the message, exit 1.
    if (
      err instanceof InvalidReferenceError ||
      err instanceof RegistryError ||
      err instanceof AuthError ||
      err instanceof ManifestError ||
      err instanceof StoreError
    ) {
      console.error(err.message)
      return 1
    }
    throw err
  }
```

```
$ npm run check
```

```
 Test Files  8 passed (8)
      Tests  62 passed (62)
```

The order of `src/main.ts`, top to bottom: imports, `usage`,
`describeApiCheck`, `describeImage`, `megabytes`, `main`.

## Try it

The moment six chapters have been building towards:

```
$ npm start --silent -- alpine:3.20 /tmp/oci-demo/rootfs
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
layer 1/1  sha256:25f1d6b1951ac8eb3740558fe94cb83d377bdadf95fd9f98b50d2e1b96130471  3.6 MB  downloaded
unpacked   /tmp/oci-demo/rootfs
```

Downloaded, checked, stored and unpacked. Run it again:

```
$ npm start --silent -- alpine:3.20 /tmp/oci-demo/rootfs
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
layer 1/1  sha256:25f1d6b1951ac8eb3740558fe94cb83d377bdadf95fd9f98b50d2e1b96130471  3.6 MB  cached
unpacked   /tmp/oci-demo/rootfs
```

`cached`: the store already had a file with that name, so it had the
right bytes. The manifest was still fetched, because a tag can move to
a new image, and asking is how we'd find out.

Now give it to `runc`. `runc` wants a *bundle*: a folder holding
`rootfs/` and a `config.json` that says what to run and how to isolate
it. `runc spec` writes a default config. `--rootless` makes one that
works without `sudo`: you're root inside the container, but only
inside it.

```
$ cd /tmp/oci-demo
$ runc spec --rootless
$ runc run demo
```

You get a shell inside the container. Type the commands after `/ #`:

```
/ # cat /etc/alpine-release
3.20.10
/ # whoami
root
/ # ls /
bin    etc    lib    mnt    proc   run    srv    tmp    var
dev    home   media  opt    root   sbin   sys    usr
/ # exit
```

That's Alpine 3.20.10, running from files our TypeScript downloaded,
checked and unpacked. `runc` is the same program Docker uses underneath
to start every container. (If `runc run` complains about your system,
try `sudo runc spec` and `sudo runc run demo` instead, without
`--rootless`. Chapter 11 looks at what's in `config.json`.)

Now a bigger image, timed. `cd` back to your project first:

```
$ time npm start --silent -- node:22-alpine /tmp/oci-node/rootfs
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
layer 1/4  sha256:e2de96513ba9eb53b431787ec8a65cdde380ac4772a3e4c4b714dcfde2a102b5  3.8 MB  downloaded
layer 2/4  sha256:f7f2d304681aaa935c9cfd180850cf616ae843efce7682873d6521ded7268937  55.6 MB  downloaded
layer 3/4  sha256:e554276b05e6306c5ad33cd85bfa7f0693083e21f6114db5abf60a20fb413039  1.3 MB  downloaded
layer 4/4  sha256:d39db1cf9caa4f49c5a2e67111fbe6e0d5eea8ede550cb82f3dc2b79712688d6  0.0 MB  downloaded
unpacked   /tmp/oci-node/rootfs

real	0m13.099s
user	0m3.756s
sys	0m1.089s
```

Four layers, stacked into one folder. (Your time will depend on your
connection, and the `time` lines look different in zsh.) And Node runs
inside it:

```
$ cd /tmp/oci-node
$ runc spec --rootless
$ runc run node-demo
```

```
/ # node --version
v22.23.3
/ # exit
```

## What this chapter doesn't do

- **Download layers at the same time.** Look at that run: 13 seconds,
  and fewer than 5 of them were the computer doing anything (`user`
  plus `sys`). The rest was waiting, mostly on layer 2 while layers 1,
  3 and 4 sat in line behind it. Chapter 8 downloads them all at once,
  with a limit, and retries a download that fails halfway.
- **Handle deleted files, or non-gzip layers.** The system `tar` unpacks
  a layer's "this file was deleted" markers as ordinary files, and
  can't read zstd layers. Chapter 9 replaces it.
- **Resume a broken download.** If the connection drops at 90%, the
  `.partial` file is deleted and the next run starts from zero.
- **Clean up the cache.** `~/.cache/oci-pull` only ever grows. Delete
  it by hand whenever you like; the next pull rebuilds what it needs.
- **Read the image's config.** `runc` ran `sh` because that's what
  `runc spec` puts in by default, not because the image asked for it.
  The config blob says what the image really wants to run. Chapter 11
  uses it.
- **Print a neat error when `tar` fails.** A `tar` failure isn't one
  of our error types, so it ends with a stack trace. Chapter 10 tidies
  all of the errors.

## Commit

```
$ npm run check
$ git add -A
$ git commit -m "Download, check and unpack layers; run alpine with runc"
```

## What you should now be able to answer

Try to answer each one in your own words first. Then open the answer
to check.

**1. What happens when you ask Docker Hub for a layer, and what does `fetch` do about it?**

<details>
<summary>Answer</summary>

The registry answers `307` with a `location` header: a signed, expiring
address on a separate download server (CloudFront). `fetch` follows
the redirect on its own, like `curl -L`, and drops the `authorization`
header because the new server is a different one, so our token isn't
sent there.

</details>

**2. Why read a layer as a stream instead of with `arrayBuffer()`?**

<details>
<summary>Answer</summary>

`arrayBuffer()` holds the whole body in memory at once, and a layer
can be hundreds of megabytes. A stream hands over a chunk at a time,
so each chunk can be hashed, written to disk and dropped before the
next arrives. Memory use stays small however big the layer is.

</details>

**3. What does `for await (const chunk of x)` do, and what kind of thing can `x` be?**

<details>
<summary>Answer</summary>

It's a loop that waits for each item to arrive before running the body,
like `async for` in Python. `x` must be an async iterable, something
that hands out values one at a time when they're ready, such as a
`Response`'s `body` or an `async function*` generator.

</details>

**4. What does `pipeline` do that a hand-written loop wouldn't?**

<details>
<summary>Answer</summary>

It connects source, middle steps and destination, and pushes each chunk
through in order. It slows the source down when the destination (the
disk) falls behind, so chunks don't pile up in memory. And if any part
fails, it stops all of them and rejects with that error.

</details>

**5. What is an `async function*`, and what job does ours do in `put`?**

<details>
<summary>Answer</summary>

A generator: a function that hands out many values one at a time with
`yield`, and can `await` between them. Ours sits in the middle of the
pipeline. For each chunk, it counts the bytes, feeds the hash, and
passes the chunk on unchanged to the file.

</details>

**6. Why name files in the store after their own sha256?**

<details>
<summary>Answer</summary>

Because the name then proves the content. The store refuses bytes that
don't match, so a file under a name is always the right bytes. That
gives a cache for free (if it's there, it's correct, so skip the
download) and sharing for free (two images with the same layer store
it once).

</details>

**7. Why write to `.partial` first and `rename` at the end?**

<details>
<summary>Answer</summary>

Renaming is all or nothing, so the real name never points at a
half-written or unchecked file, even if the program crashes midway.
`has()` only looks for the real name, so a leftover `.partial` can never
be mistaken for a good layer. On any error, the `.partial` is deleted
too.

</details>

**8. Why does `put` check the size while the bytes are arriving, and not just at the end?**

<details>
<summary>Answer</summary>

A broken or hostile server could send bytes forever. The manifest
promised an exact size, so the first byte past it is already an error.
Stopping there protects the disk, instead of finding out only after
it's full.

</details>

**9. Why were the store's tests run against a real folder instead of a fake disk?**

<details>
<summary>Answer</summary>

The store's whole job is files: `mkdir`, writing, `rename`, `rm`.
Faking all of those would be more code than the store, and would test
the fake, not the real behaviour. A fresh temp folder per test (from
`useTempFolder`, with `beforeEach`/`afterEach`) is fast and honest.

</details>

**10. The new manifest digest check made two Chapter 6 tests fail. What was wrong, and how was it fixed?**

<details>
<summary>Answer</summary>

The test data wasn't the real bytes: `ALPINE_AMD64` had its
annotations trimmed and `bytesOf` wrote compact JSON, so it hashed to
a different digest than the one the index claimed. The fix was to use
the complete manifest and write it with `JSON.stringify(value, null, 2)`,
the same two-space indent Docker Hub uses, so the bytes are exactly the
real ones and hash to the real digest.

</details>

**11. Why can only digest requests be checked, not tag requests?**

<details>
<summary>Answer</summary>

A check needs a right answer to compare against. A digest is a
fingerprint of exact bytes, so we hash what arrived and compare. A tag
like `3.20` is a name that can be moved to a new image at any time, so
it doesn't say which bytes to expect. That's why the first fetch is
checked only when the user typed a digest. The second fetch, the entry
picked from the index, is always checked, because we fetch it by the
digest the index gave us.

</details>

**12. Why is `unpackWithSystemTar` called a shortcut, and why does `execFile` get a list of arguments?**

<details>
<summary>Answer</summary>

It's a shortcut because `tar` doesn't understand layers' "this file
was deleted" markers (and can't read zstd layers), so Chapter 9
replaces it. `execFile` passes the arguments straight to the program,
with no shell in between, so a space or `;` in a path can't be misread
as part of a command.

</details>

**13. What does `runc spec --rootless` give you, and why did `whoami` say `root`?**

<details>
<summary>Answer</summary>

A default `config.json` for a bundle, set up so the container runs
without `sudo`. Inside the container you're mapped to root, so
`whoami` says `root`, but that's only true inside it. Outside, the
process still runs as your ordinary user.

</details>

## Next chapter

The tool works from start to finish, but look at the timing again:
13 seconds for `node:22-alpine`, with the computer busy for under 5 of
them. Layers 1, 3 and 4 sat waiting in line while layer 2 downloaded.
Chapter 8 downloads all the layers at once. "All at once" needs a limit
(an image can have 50 layers, and a registry won't like 50 connections
from you), so we'll write a small limiter ourselves. That's our first
*generic* function: one that works for any kind of value, which also
lets us fold Chapter 6's two `safeParse` branches into one. We'll also
retry a download that fails halfway, and test the waiting between
retries by faking the *clock*, so a test that "waits 10 seconds" takes
a millisecond.
