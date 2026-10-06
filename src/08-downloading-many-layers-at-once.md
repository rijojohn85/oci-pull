# Chapter 8: Downloading Many Layers at Once

Chapter 7 left the tool working from start to finish, with two
shortcuts. This chapter removes the first one: layers downloading one
at a time. By the end, the tool downloads up to three layers at once,
tries a failed download again, and you'll have tests that "wait"
several seconds in no time at all.

This chapter is also built in a new way. We'll grow one function until
it does everything, with all the logic written inline. Once it works and
its tests pass, we'll split it into small helpers, one step at a time,
running the same tests after each step. That's "make it work, then make
it right," the method Martin Fowler's *Refactoring* opens with.

New in this chapter: function types, `Promise.all`, sharing one
iterator between workers, `yield*`, `Map`, default values when taking
fields out of an object, `**`, `mockRejectedValueOnce`, generic
functions (`<T>`), `return await`, and fake timers
(`vi.useFakeTimers`).

## Where we are

Pulling an image takes six stages. This chapter's is marked ▶:

- ✓ 1. Read the image name (Ch3)
- ✓ 2. Ask the registry, get a token (Ch4–5)
- ✓ 3. Read the manifest, pick the platform (Ch6)
- ▶ **4. Download the layers, check them** (Ch7; this chapter makes it fast and sturdy)
- ✓ 5. Unpack them into a folder (Ch7, roughly; properly in Ch9)
- ✓ 6. Run it with runc (Ch7; more in Ch11)

Here's the tool as Chapter 7 left it, pulling `nginx:1.27-alpine` with
an empty cache. This image has eight layers, and six of them are tiny:

```
$ time npm start --silent -- nginx:1.27-alpine /tmp/oci-nginx/rootfs
```

```
registry   docker.io
repository library/nginx
tag        1.27-alpine
api        needs a token
challenge  Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
platform   linux/amd64
manifest   sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8
config     sha256:6769dc3a703c719c1d2756bda113659be28ae16cf0da58dd5fd823d6b9a050ea
layer 1/8  sha256:f18232174bc91741fdf3da96d85011092101a032a93a388b79e99e69c2d5c870  3.6 MB  downloaded
layer 2/8  sha256:61ca4f733c802afd9e05a32f0de0361b6d713b8b53292dc15fb093229f648674  1.8 MB  downloaded
layer 3/8  sha256:b464cfdf2a6319875aeb27359ec549790ce14d8214fcb16ef915e4530e5ed235  0.0 MB  downloaded
layer 4/8  sha256:d7e5070240863957ebb0b5a44a5729963c3462666baa2947d00628cb5f2d5773  0.0 MB  downloaded
layer 5/8  sha256:81bd8ed7ec6789b0cb7f1b47ee731c522f6dba83201ec73cd6bca1350f582948  0.0 MB  downloaded
layer 6/8  sha256:197eb75867ef4fcecd4724f17b0972ab0489436860a594a9445f8eaff8155053  0.0 MB  downloaded
layer 7/8  sha256:34a64644b756511a2e217f0508e11d1a572085d66cd6dc9a555a082ad49a3102  0.0 MB  downloaded
layer 8/8  sha256:39c2ddfd6010082a4a646e7ca44e95aca9bf3eaebc00f17f7ccc2954004f2a7d  15.5 MB  downloaded
unpacked   /tmp/oci-nginx/rootfs

real	0m7.579s
user	0m1.085s
sys	0m0.321s
```

7.6 seconds, and the computer was busy for about 1.4 of them (`user`
plus `sys`). The rest was waiting. Layers 3 to 7 are less than 0.05 MB
each, yet each one waited its turn. A download costs a few round trips
before the first byte arrives: ask the registry, get sent to the
download server (the `307` from Chapter 7), connect there. Those round
trips cost the same for 1 KB as for 15 MB, and we paid for them eight
times in a row.

There's a second problem you can't see in a good run. If the connection
drops during layer 8, the whole pull fails, and the next run starts
layer 8 from zero.

## Why this chapter

Real images have more layers than nginx: 10 to 20 is common, and some
have 50. Downloading them in line makes every pull as slow as the sum
of all the waiting. Downloading them together makes it about as slow as
the biggest layer. And a pull that takes a minute should survive a
network hiccup without making you start over.

By the end of this chapter you can:

- Download all of an image's layers at the same time, but never more
  than three at once.
- Try a failed download again, waiting a little longer each time.
- Write a generic function: one that works for any type of value.
- Grow a function inline, then split it into helpers without changing
  a single test.

## The plan

We'll build `downloadLayers` in `src/pull.ts`: "make sure every layer
of this image is in the store." Each step adds one thing to it, inline:

1. Move Chapter 7's loop out of `main` into `downloadLayers`. Same
   behavior, but now it can be tested.
2. Start all the downloads at once.
3. Limit how many run at the same time.
4. Try a failed download again.

By then `downloadLayers` is about 40 lines and does four jobs. Then we
split it:

5. Pull out the "how many at once" part as `mapWithLimit`.
6. Pull out the "try again" part as `retry`, and test its waiting with
   a fake clock.
7. Use the same idea, a generic function, to fold Chapter 6's two
   copy-pasted `safeParse` branches into one.

The tests from steps 1 to 4 test `downloadLayers` from the outside:
what goes in, what comes out, what ends up in the store. They don't
know about any helper, so they must pass unchanged after every split.
That's how we'll know a split didn't break anything.

## Step 1: move the loop out of `main`

Here's the loop as Chapter 7 left it in `main.ts`:

```ts
    // ROUGH: one layer at a time. Chapter 8 downloads them all at once.
    // entries() gives [position, item] pairs, like enumerate() in Python.
    for (const [i, layer] of layers.entries()) {
      const result = await downloadLayer(registry, store, ref.repository, layer)
      console.log(`layer ${i + 1}/${layers.length}  ${layer.digest}  ${megabytes(layer.size)}  ${result}`)
    }
```

Everything this chapter adds would go here, in `main`, which can't be
tested without the real Docker Hub. So first we move the loop into
`src/pull.ts`, as `downloadLayers`. It shouldn't print, though: a
function that prints is hard to test, and `main` is the one that
decides what the screen shows. So `downloadLayers` takes a function to
call each time a layer finishes, and `main` passes one that prints.

Add this to the end of `src/pull.ts`:

```ts
// Called as each layer finishes: where it is in the list, the layer, and
// what happened to it. main uses it to print a progress line.
export type OnLayer = (index: number, layer: Descriptor, result: LayerResult) => void

// Settings for downloadLayers. The ? means the caller may leave it out.
export interface DownloadOptions {
  onLayer?: OnLayer
}

// Make sure every layer is in the store. Returns what happened to each
// one, in the same order as `layers`.
export async function downloadLayers(
  source: BlobSource,
  store: ContentStore,
  repository: string,
  layers: readonly Descriptor[],
  options: DownloadOptions = {},
): Promise<LayerResult[]> {
  // Take onLayer out of options; if it's missing, use a function that does nothing.
  const { onLayer = () => {} } = options
  const results: LayerResult[] = []
  // ROUGH, still: one layer at a time, as in Chapter 7.
  for (const [i, layer] of layers.entries()) {
    const result = await downloadLayer(source, store, repository, layer)
    results.push(result)
    onLayer(i, layer, result)
  }
  return results
}
```

**`OnLayer` is a function type.** It describes a function by what it
takes and what it gives back: three arguments, returns nothing
(`void`). It's the same as Go's `func(int, Descriptor, LayerResult)`,
or Python's `Callable[[int, Descriptor, LayerResult], None]`.

**`options`** groups the settings into one object. It has one field
now, and three more by the end of the chapter. The `?` in `onLayer?`
makes the field optional (as `headers?` did in Chapter 5), and
`options: DownloadOptions = {}` lets a caller leave out the whole
object. Adding a new optional field later won't break any code that
calls `downloadLayers`, including the tests.

**`const { onLayer = () => {} } = options`** takes the field out of the
object and gives it a default for when it's missing: here, an arrow
function that does nothing. After this line `onLayer` is never
`undefined`, so the loop can call it without checking.

**`readonly Descriptor[]`** promises that `downloadLayers` won't change
the list it's given (Chapter 6 used `readonly` the same way).

Now `main.ts`. Change the import from `downloadLayer` to
`downloadLayers`, and replace the loop with:

```ts
    // Print a line as each layer finishes.
    await downloadLayers(registry, store, ref.repository, layers, {
      onLayer: (i, layer, result) => {
        console.log(`layer ${i + 1}/${layers.length}  ${layer.digest}  ${megabytes(layer.size)}  ${result}`)
      },
    })
```

The arrow function's parameters have no types written on them. They
don't need any: `onLayer` must be an `OnLayer`, so the compiler already
knows `i` is a number, `layer` a `Descriptor` and `result` a
`LayerResult`.

### Tests from the outside

These tests are the ones that must survive every split later on, so
they only look at what `downloadLayers` does from the outside. They
need layers with real bytes, and a fake registry that serves them. Add
to `src/pull.test.ts`, below the existing tests. First two helpers:

```ts
// A layer whose bytes are `text`: its real digest and size, the way a
// manifest would list it.
function layerOf(text: string): Descriptor {
  const bytes = new TextEncoder().encode(text)
  return { mediaType: "text/plain", digest: sha256Digest(bytes), size: bytes.length }
}

// A pretend registry that serves each text under its own digest.
function textSource(...texts: string[]): FakeSource {
  // A Map is a dictionary; new Map() takes a list of [key, value] pairs.
  const byDigest = new Map(texts.map((text) => [layerOf(text).digest, text]))
  // ?? "": an unknown digest gets empty bytes, which won't match its digest.
  const fetchBlob = vi.fn<BlobSource["fetchBlob"]>(async (_repository, digest) => chunksOf(byDigest.get(digest) ?? ""))
  return { source: { fetchBlob }, fetchBlob }
}
```

`layerOf` uses Chapter 7's `sha256Digest` to compute a real digest, so
the store accepts the bytes. `textSource` returns the same `FakeSource`
shape as Chapter 7's `helloSource`, so a test can still check the calls
on `fetchBlob`. A `Map` is TypeScript's dictionary, like a Go `map` or
a Python `dict`; `get` returns `undefined` for a missing key.

Add to the imports at the top: `sha256Digest` from `./digest.ts`,
`type Descriptor` from `./manifest.ts`, and `downloadLayers` next to
`downloadLayer`.

Then the first test:

```ts
describe("downloadLayers", () => {
  const folder = useTempFolder()

  it("downloads every layer and reports each one", async () => {
    const { source } = textSource("one", "two", "three")
    const store = new ContentStore(folder())
    const layers = [layerOf("one"), layerOf("two"), layerOf("three")]
    const onLayer = vi.fn()

    await downloadLayers(source, store, "library/alpine", layers, { onLayer })

    expect(onLayer).toHaveBeenCalledTimes(3)
    expect(onLayer).toHaveBeenCalledWith(1, layers[1], "downloaded")
    for (const layer of layers) {
      expect(await store.has(layer.digest)).toBe(true)
    }
  })
})
```

`vi.fn()` with nothing inside is a fake function that does nothing and
records its calls, which is all `onLayer` needs to be here.

> **Your turn.** A second test in the same `describe`: "returns what
> happened to each layer, in the layers' order". Serve `"one"`,
> `"two"`, `"three"`. Put `"two"` in the store first with
> `downloadLayer`. Then `downloadLayers` on all three returns
> `["downloaded", "cached", "downloaded"]`.

Here it is:

```ts
  it("returns what happened to each layer, in the layers' order", async () => {
    const { source } = textSource("one", "two", "three")
    const store = new ContentStore(folder())
    const layers = [layerOf("one"), layerOf("two"), layerOf("three")]
    // Put the middle one in the store first.
    await downloadLayer(source, store, "library/alpine", layerOf("two"))

    expect(await downloadLayers(source, store, "library/alpine", layers)).toEqual(["downloaded", "cached", "downloaded"])
  })
```

"In the layers' order" sounds too obvious to test right now, with one
loop doing one layer at a time. It won't be obvious after Step 2.

```
$ npm run check
```

```
 Test Files  8 passed (8)
      Tests  64 passed (64)
```

## Step 2: start them all at once

The loop waits for each download before starting the next, because of
the `await` inside it. To run them together, start them all first, and
wait afterwards.

In JavaScript, calling an `async` function starts it right away. The
call returns a promise at once, and the work carries on in the
background, like `go f()` in Go, except you also get something to wait
on. (Python is different: calling an `async def` function does
nothing until you await it or hand it to `asyncio.gather`.)

So `layers.map(async (layer) => ...)` starts every download and gives
back a list of promises. `Promise.all` turns that list into one promise
that finishes when all of them have, with their results in the same
order as the list. It's Python's `asyncio.gather`, or a Go
`WaitGroup` that also collects the results.

In `downloadLayers`, replace everything from `const results` down to
`return results` with:

```ts
  // map starts every download right away and gives back a list of
  // promises, one per layer. Promise.all waits for all of them and
  // gives back their results in the same order as the list.
  return Promise.all(
    layers.map(async (layer, i) => {
      const result = await downloadLayer(source, store, repository, layer)
      onLayer(i, layer, result)
      return result
    }),
  )
```

The `await` is still there, but now it's inside each layer's own
function: each download waits for itself, not for the others.

```
$ npm run check
```

```
 Test Files  8 passed (8)
      Tests  64 passed (64)
```

Same tests, still green. Now the real thing (delete the cache first,
so every layer really downloads):

```
$ rm -rf ~/.cache/oci-pull /tmp/oci-nginx
$ time npm start --silent -- nginx:1.27-alpine /tmp/oci-nginx/rootfs
```

```
registry   docker.io
repository library/nginx
tag        1.27-alpine
api        needs a token
challenge  Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
platform   linux/amd64
manifest   sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8
config     sha256:6769dc3a703c719c1d2756bda113659be28ae16cf0da58dd5fd823d6b9a050ea
layer 4/8  sha256:d7e5070240863957ebb0b5a44a5729963c3462666baa2947d00628cb5f2d5773  0.0 MB  downloaded
layer 6/8  sha256:197eb75867ef4fcecd4724f17b0972ab0489436860a594a9445f8eaff8155053  0.0 MB  downloaded
layer 5/8  sha256:81bd8ed7ec6789b0cb7f1b47ee731c522f6dba83201ec73cd6bca1350f582948  0.0 MB  downloaded
layer 7/8  sha256:34a64644b756511a2e217f0508e11d1a572085d66cd6dc9a555a082ad49a3102  0.0 MB  downloaded
layer 3/8  sha256:b464cfdf2a6319875aeb27359ec549790ce14d8214fcb16ef915e4530e5ed235  0.0 MB  downloaded
layer 2/8  sha256:61ca4f733c802afd9e05a32f0de0361b6d713b8b53292dc15fb093229f648674  1.8 MB  downloaded
layer 1/8  sha256:f18232174bc91741fdf3da96d85011092101a032a93a388b79e99e69c2d5c870  3.6 MB  downloaded
layer 8/8  sha256:39c2ddfd6010082a4a646e7ca44e95aca9bf3eaebc00f17f7ccc2954004f2a7d  15.5 MB  downloaded
unpacked   /tmp/oci-nginx/rootfs

real	0m5.422s
user	0m0.968s
sys	0m0.249s
```

5.4 seconds instead of 7.6. (Network times vary from run to run, so
yours will differ, but the gap should be there.) Look at the order: the
small layers finished first and the 15.5 MB one last. That's why
`onLayer` gets the layer's position: the lines no longer come out in
order, so each one has to say which layer it's about. And it's why
Step 1's order test matters: `Promise.all` keeps the results in the
list's order, whatever order the downloads finish in.

There's a catch, though. "Start them all" means *all*. An image with
50 layers opens 50 connections at once. The registry may take that
badly, and on a slow line 50 downloads each get a fiftieth of the
speed, so all of them are slow, and some may time out. Docker itself
downloads three layers at a time by default (its
`--max-concurrent-downloads` setting). We need a limit too.

## Step 3: no more than three at once

This time the test comes first, because it shows the problem for real.
It needs a way to count how many downloads are running at the same
time.

First add the setting to `DownloadOptions`, above `onLayer`:

```ts
  // The most layers downloading at the same time (3 if left out).
  limit?: number
```

Then, in `src/pull.test.ts`, a helper above `describe("downloadLayers"`:

```ts
// Wait `ms` milliseconds. setTimeout calls resolve when the time is up,
// and that finishes the promise.
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

`setTimeout(fn, ms)` calls `fn` once, after `ms` milliseconds; it's the
callback version of Go's `time.Sleep`. Wrapping it in a `new Promise`
turns it into something you can `await`, the same trick `promisify`
did for `execFile` in Chapter 7.

And the test, at the end of the `describe`:

```ts
  it("downloads at most `limit` layers at the same time", async () => {
    const texts = ["a", "b", "c", "d", "e"]
    const { source } = textSource(...texts)
    const store = new ContentStore(folder())
    let running = 0
    let most = 0
    // Wrap the fake to count downloads in progress: from the request
    // until the last byte, with a short pause so they overlap.
    const counting: BlobSource = {
      fetchBlob: async (repository, digest) => {
        running += 1
        most = Math.max(most, running)
        const chunks = await source.fetchBlob(repository, digest)
        return (async function* (): AsyncGenerator<Uint8Array> {
          await pause(5)
          // yield* passes along every chunk of another stream.
          yield* chunks
          running -= 1
        })()
      },
    }

    await downloadLayers(counting, store, "library/alpine", texts.map(layerOf), { limit: 2 })

    expect(most).toBe(2)
  })
```

`counting` wraps the fake registry. A download counts as running from
the moment it's asked for until its last byte has been read. The
generator (Chapter 7's `async function*`) waits 5 ms before passing on
the bytes, so the downloads overlap long enough to be counted.
`yield* chunks` passes along every chunk of another stream, a short
way to write `for await (const c of chunks) yield c`. `most` records
the highest count seen.

`limit` is ignored so far, so this should fail:

```
$ npm run check
```

```
 FAIL  src/pull.test.ts > downloadLayers > downloads at most `limit` layers at the same time
AssertionError: expected 5 to be 2 // Object.is equality

- Expected
+ Received

- 2
+ 5

 ❯ src/pull.test.ts:118:18
    116|     await downloadLayers(counting, store, "library/alpine", texts.map(…
    117|
    118|     expect(most).toBe(2)
       |                  ^
    119|   })
    120| })

 Test Files  1 failed | 7 passed (8)
      Tests  1 failed | 64 passed (65)
```

All five at once, the 50-connection problem in miniature.

### Workers and a shared queue

The fix: start a fixed number of *workers*, each one a loop that
downloads one layer at a time. Each worker takes the next layer nobody
has taken yet, until none are left. With three workers, at most three
downloads run at once, and a worker that finishes a small layer moves
straight on to the next one.

"The next layer nobody has taken" needs a queue the workers share.
`layers.entries()` already is one. It returns an *iterator*: a thing
that hands out items one at a time and remembers where it's up to,
like Python's `iter()`. A `for...of` loop over an iterator takes items
from it. Run three such loops over the *same* iterator, and every item
goes to exactly one of them.

Replace the `return Promise.all(...)` with:

```ts
  // new Array(n): a list with n empty slots, filled in as layers finish.
  const results: LayerResult[] = new Array(layers.length)
  // One shared queue of [position, layer] pairs. Every worker takes
  // from the same one, so each layer is taken exactly once.
  const queue = layers.entries()

  // A worker downloads one layer at a time, taking the next one from
  // the queue until the queue is empty.
  async function worker(): Promise<void> {
    for (const [i, layer] of queue) {
      const result = await downloadLayer(source, store, repository, layer)
      results[i] = result
      onLayer(i, layer, result)
    }
  }

  // Start `limit` workers (fewer if there are fewer layers), and wait
  // until all of them have run out of work.
  const workers: Promise<void>[] = []
  for (let n = 0; n < Math.min(limit, layers.length); n += 1) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
```

And take `limit` out of the options, with its default, at the top of
the function:

```ts
  // Take each setting out of options, with a default if it's missing.
  const { limit = 3, onLayer = () => {} } = options
```

`worker` is a function inside a function. Like the generator in
Chapter 7's store, it can use the variables around it: `queue`,
`results`, and the parameters. Each call to `worker()` starts one more
loop running, and gives back a promise that finishes when that loop
runs out of layers. `Promise.all(workers)` waits for every loop.

Three loops changing `results` and sharing `queue`, with no lock? In
Go you'd need a mutex here. JavaScript runs only one piece of your
code at a time. It switches between the workers only at an `await`,
never halfway through a line. So taking the next item from `queue`, or
filling a slot in `results`, can't be interrupted by another worker.

```
$ npm run check
```

```
 Test Files  8 passed (8)
      Tests  65 passed (65)
```

## Step 4: try again

A pull of a big image can take minutes. Wi-Fi drops, a server
restarts, a connection is reset halfway through a layer. One such
hiccup shouldn't throw away the whole pull. So when a download fails,
we wait a moment and try that layer again, a few times, before giving
up.

Two details matter:

- **Wait longer each time.** If the registry is struggling, a hundred
  clients retrying instantly make it worse. So we wait 1 second, then
  2, then 4: the wait doubles each time. This is called *backoff*.
- **Each try starts fresh.** Chapter 7's store already deletes the
  `.partial` file when a download fails, so the next try starts from
  an empty file. We get that for free.

And one thing once a layer has failed for good: the other workers
should stop taking new layers. There's no point in downloading the
rest of an image we can't finish.

Two more settings in `DownloadOptions`, between `limit` and `onLayer`:

```ts
  // How many tries each layer gets before we give up (3 if left out).
  attempts?: number
  // How long to wait before the first retry, in milliseconds (1000 if
  // left out). Each later wait is twice as long as the one before.
  delayMs?: number
```

Now the whole function, written inline. It's the biggest it will get:

```ts
export async function downloadLayers(
  source: BlobSource,
  store: ContentStore,
  repository: string,
  layers: readonly Descriptor[],
  options: DownloadOptions = {},
): Promise<LayerResult[]> {
  // Take each setting out of options, with a default if it's missing.
  const { limit = 3, attempts = 3, delayMs = 1000, onLayer = () => {} } = options
  // new Array(n): a list with n empty slots, filled in as layers finish.
  const results: LayerResult[] = new Array(layers.length)
  // One shared queue of [position, layer] pairs. Every worker takes
  // from the same one, so each layer is taken exactly once.
  const queue = layers.entries()
  // Set when a layer has failed for good, so the others stop.
  let failed = false

  // A worker downloads one layer at a time, taking the next one from
  // the queue until the queue is empty.
  async function worker(): Promise<void> {
    for (const [i, layer] of queue) {
      // Another worker gave up: start nothing new.
      if (failed) {
        return
      }
      let result: LayerResult | undefined
      // Keep trying until a try works. A failed try is cleaned up by the
      // store (no .partial left behind), so the next one starts fresh.
      for (let attempt = 1; result === undefined; attempt += 1) {
        try {
          result = await downloadLayer(source, store, repository, layer)
        } catch (err) {
          if (attempt === attempts) {
            failed = true
            throw err
          }
          // Wait delayMs, then 2 × delayMs, then 4 ×, ... (** is "to the power of").
          await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)))
        }
      }
      results[i] = result
      onLayer(i, layer, result)
    }
  }

  // Start `limit` workers (fewer if there are fewer layers), and wait
  // until all of them have run out of work.
  const workers: Promise<void>[] = []
  for (let n = 0; n < Math.min(limit, layers.length); n += 1) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}
```

The new part is the inner `for` loop. `result` starts as `undefined`
and the loop runs until it isn't. A failed try lands in the `catch`.
If that was the last try, it sets `failed` and throws the error on, so
`Promise.all` fails, and so does `downloadLayers`. Otherwise it waits
and goes round again. `2 ** (attempt - 1)` is 1, then 2, then 4
(`**` is "to the power of", like Python's).

When the loop ends, the compiler knows `result` is no longer
`undefined`: the loop only stops once `result === undefined` is false.
So `results[i] = result` needs no check.

Two tests, at the end of the `describe`. The first:

```ts
  it("tries a failing layer again", async () => {
    const { source, fetchBlob } = textSource("one")
    // The first two tries fail the way fetch does when the network drops.
    fetchBlob.mockRejectedValueOnce(new TypeError("fetch failed"))
    fetchBlob.mockRejectedValueOnce(new TypeError("fetch failed"))
    const store = new ContentStore(folder())

    // delayMs: 1 keeps the test fast; the real waits are a second or more.
    const results = await downloadLayers(source, store, "library/alpine", [layerOf("one")], { delayMs: 1 })

    expect(results).toEqual(["downloaded"])
    expect(fetchBlob).toHaveBeenCalledTimes(3)
  })
```

`mockRejectedValueOnce` is the failing twin of Chapter 5's
`mockResolvedValueOnce`: the next call returns a promise that fails
with this error. Two of them, queued up, make the first two calls fail.
The third call falls back to the normal fake and succeeds.
`TypeError("fetch failed")` is what Node's `fetch` really throws when
it can't reach a server.

> **Your turn.** The second test, "gives up after `attempts` tries": a
> `textSource()` with no texts whose `fetchBlob` always fails
> (`mockRejectedValue`, without `Once`). With `{ attempts: 2, delayMs: 1 }`,
> `downloadLayers` on `[layerOf("one")]` rejects with `"fetch failed"`,
> and `fetchBlob` was called twice.

Here it is:

```ts
  it("gives up after `attempts` tries", async () => {
    const { source, fetchBlob } = textSource()
    fetchBlob.mockRejectedValue(new TypeError("fetch failed"))
    const store = new ContentStore(folder())
    const download = downloadLayers(source, store, "library/alpine", [layerOf("one")], { attempts: 2, delayMs: 1 })

    await expect(download).rejects.toThrow("fetch failed")
    expect(fetchBlob).toHaveBeenCalledTimes(2)
  })
```

```
$ npm run check
```

```
 Test Files  8 passed (8)
      Tests  67 passed (67)
```

It works. Five tests cover `downloadLayers` from the outside. But read
the function again: it's long, and it does four jobs at once:

1. **What one layer needs:** download it into the store, report it.
2. **How many at once:** workers, the shared queue, collecting results.
3. **What to do after a failure:** try again, waiting longer each time.
4. **When to stop:** the `failed` flag.

There are also two things the tests can't check. The retry test uses
`delayMs: 1`, so it never checks that the waits are really 1 second,
then 2. And nothing tests that the workers stop after a failure. Both
are hard to test here, because every test of `downloadLayers` also
does real disk work in a temp folder. The next two steps fix that.

## Step 5: split out "how many at once"

Jobs 2 and 4, the workers and the `failed` flag, don't mention layers
at all. Swap "layer" for "item" and "download" for "work", and they'd
run any list of anything, a few at a time. They also change for
different reasons than job 1 does. If the registry changes how layers
are served, job 1 changes. If we want a smarter limit, jobs 2 and 4
change. That's the *single responsibility principle* (the S in SOLID)
again: one piece of code, one reason to change.

So jobs 2 and 4 move into a function of their own, in a new file
`src/tasks.ts`, that knows nothing about images. It takes a list, a
limit, and a function to run on each item, and gives back the list of
results.

What are the types, though? For `downloadLayers`, the items are
`Descriptor`s and the results are `LayerResult`s. Another caller could
pass a list of URLs and get back strings. We want one function that
works for any item type and any result type, and still checks them.
That's a *generic* function, and you've met the idea in Go:

```go
func MapWithLimit[T, R any](items []T, limit int, work func(T, int) R) []R
```

TypeScript writes the type parameters in angle brackets after the name,
`mapWithLimit<T, R>`, and like Go, it works out what `T` and `R` are
from the arguments at each call. Here's the file:

```ts
// Helpers for running async work. Nothing in here knows about images.

// Run `work` on every item, at most `limit` at the same time. The
// results come back in the same order as `items`, whatever order the
// work finishes in. If one fails, nothing new is started and the
// error is thrown.
// <T, R> are type parameters: T is the type of an item, R the type of
// a result. The caller's arguments decide what they are.
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  // new Array(n): a list with n empty slots, filled in as work finishes.
  const results: R[] = new Array(items.length)
  // One shared queue of [position, item] pairs. Every worker takes
  // from the same one, so each item is taken exactly once.
  const queue = items.entries()
  // Set when some work has failed, so the workers stop.
  let failed = false

  // A worker does one item at a time, taking the next one from the
  // queue until the queue is empty.
  async function worker(): Promise<void> {
    for (const [i, item] of queue) {
      // Another worker failed: start nothing new.
      if (failed) {
        return
      }
      try {
        results[i] = await work(item, i)
      } catch (err) {
        failed = true
        throw err
      }
    }
  }

  // Start `limit` workers (fewer if there are fewer items), and wait
  // until all of them have run out of work.
  const workers: Promise<void>[] = []
  for (let n = 0; n < Math.min(limit, items.length); n += 1) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}
```

It's the worker code from Step 4, with `layer` renamed `item` and the
download swapped for a call to `work`. One thing moved: `failed = true`
used to sit in the retry's `catch`. Now it's in a `catch` around
`work`, so it covers any failure, whatever the work is.

`downloadLayers` keeps job 1 and job 3, and hands the rest over. Add
`import { mapWithLimit } from "./tasks.ts"` to `src/pull.ts`, then
replace everything in `downloadLayers` below the `const { limit, ... }`
line with:

```ts
  // mapWithLimit runs the function below on every layer, `limit` at a
  // time. Here T is Descriptor and R is LayerResult.
  return mapWithLimit(layers, limit, async (layer, i) => {
    let result: LayerResult | undefined
    // Keep trying until a try works. A failed try is cleaned up by the
    // store (no .partial left behind), so the next one starts fresh.
    for (let attempt = 1; result === undefined; attempt += 1) {
      try {
        result = await downloadLayer(source, store, repository, layer)
      } catch (err) {
        if (attempt === attempts) {
          throw err
        }
        // Wait delayMs, then 2 × delayMs, then 4 ×, ... (** is "to the power of").
        await new Promise((resolve) => setTimeout(resolve, delayMs * 2 ** (attempt - 1)))
      }
    }
    onLayer(i, layer, result)
    return result
  })
```

The compiler worked out `T` from `layers` (a list of `Descriptor`) and
`R` from what the arrow function returns (`LayerResult`). So the call
gives back `Promise<LayerResult[]>`, exactly what `downloadLayers`
promises to return. Return a number from the arrow function by mistake
and the compiler would say so.

Now the moment that matters. We haven't touched a test:

```
$ npm run check
```

```
 Test Files  8 passed (8)
      Tests  67 passed (67)
```

All 67 still pass, including the limit test. The tests checked what
`downloadLayers` does, not how, so moving the "how" didn't disturb
them.

### Tests for the helper

`mapWithLimit` has no disk and no registry, so it's easy to test on its
own. The tests need Step 3's `pause` helper a second time, in a second
file. That's the moment to stop copying it: move it from
`src/pull.test.ts` into `src/tasks.ts`, exported, and call it `sleep`
(the next step will use it outside tests too). Put it at the top of
`src/tasks.ts`, below the first comment:

```ts
// Wait `ms` milliseconds. setTimeout calls resolve when the time is up,
// and that finishes the promise.
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

In `src/pull.test.ts`, delete `pause`, add
`import { sleep } from "./tasks.ts"`, and change `await pause(5)` to
`await sleep(5)`. That's the only change to that file, and it's a
rename, not a change in what any test checks. This is *don't repeat
yourself* (DRY), applied at the second use, not the first. One copy
didn't need sharing. Two copies are where they start to drift apart.

Now `src/tasks.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { mapWithLimit, sleep } from "./tasks.ts"

describe("mapWithLimit", () => {
  it("returns results in the items' order, not the finishing order", async () => {
    // The first item takes longest, so it finishes last.
    const results = await mapWithLimit([30, 20, 10], 3, async (ms) => {
      await sleep(ms)
      return `slept ${ms}`
    })

    expect(results).toEqual(["slept 30", "slept 20", "slept 10"])
  })

  it("starts nothing new after a failure", async () => {
    const started: string[] = []
    const work = async (item: string): Promise<string> => {
      started.push(item)
      if (item === "bad") {
        throw new Error(`${item} failed`)
      }
      await sleep(5)
      return item
    }

    // Two workers: one takes "slow", the other "bad", which fails at once.
    await expect(mapWithLimit(["slow", "bad", "c", "d"], 2, work)).rejects.toThrow("bad failed")
    // Give "slow" time to finish; its worker must not take "c".
    await sleep(10)
    expect(started).toEqual(["slow", "bad"])
  })
})
```

In the first test, `T` is `number` and `R` is `string`. It's the same
function `downloadLayers` uses with `Descriptor` and `LayerResult`, and
it's checked just as strictly.

The second test is the one we couldn't write before. Worker 1 takes
`"slow"` and sleeps for 5 ms. Worker 2 takes `"bad"`, which fails at
once. When worker 1 wakes up, the `failed` flag must stop it from
taking `"c"`.

```
$ npm run check
```

```
 Test Files  9 passed (9)
      Tests  69 passed (69)
```

See it earn its place. In `mapWithLimit`, delete the three lines of
`if (failed) { return }`. The compiler would now complain that
`failed` is never read, so run only the tests:

```
$ npx vitest run src/tasks.test.ts
```

```
 FAIL  src/tasks.test.ts > mapWithLimit > starts nothing new after a failure
AssertionError: expected [ 'slow', 'bad', 'c', 'd' ] to deeply equal [ 'slow', 'bad' ]

- Expected
+ Received

  [
    "slow",
    "bad",
+   "c",
+   "d",
  ]

 ❯ src/tasks.test.ts:30:21
     28|     // Give "slow" time to finish; its worker must not take "c".
     29|     await sleep(10)
     30|     expect(started).toEqual(["slow", "bad"])
       |                     ^
     31|   })
     32| })

 Test Files  1 failed (1)
      Tests  1 failed | 1 passed (2)
```

(Separator lines trimmed. You may see only `'c'` added, depending on
timing.) Without the flag, the surviving worker carries on through the
rest of the list after the whole call has already failed. In
`downloadLayers` that means layers still downloading for an image
that's already given up. Put the lines back.

## Step 6: split out "try again"

What's left of the retry loop is the other job that knows nothing
about layers: "call this until it works, at most N times, waiting
longer each time." It's also the part we couldn't test properly, so
it's the next thing to move out.

> **Your turn.** Add `retry` to `src/tasks.ts`, below `mapWithLimit`.
> It's generic in one type, `T`: it takes `attempt`, a function with no
> arguments that returns `Promise<T>`, plus `attempts` and `delayMs`,
> and returns `Promise<T>`. Use Step 5's loop, but `return` the result
> of the first try that works, and use `sleep` for the waiting.

Here it is:

```ts
// Call `attempt` until it works, at most `attempts` times. Between
// tries, wait delayMs, then twice that, then 4 times, and so on. If
// the last try fails too, its error is thrown.
export async function retry<T>(attempt: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
  for (let n = 1; ; n += 1) {
    try {
      // `return await`, not `return`: the await makes a failure land in
      // the catch below. A plain `return` hands the promise back unchecked.
      return await attempt()
    } catch (err) {
      if (n === attempts) {
        throw err
      }
      // ** is "to the power of": delayMs × 1, × 2, × 4, ...
      await sleep(delayMs * 2 ** (n - 1))
    }
  }
}
```

`for (let n = 1; ; n += 1)` has no condition, so it loops until a
`return` or a `throw` gets out. The compiler can see that, so it
doesn't complain that the function might end without returning.

**`return await`** looks like a word too many, and in most places it
is. Inside a `try`, it isn't. `attempt()` gives back a promise.
`await` waits for it here, so if it fails, the failure happens inside
the `try` and the `catch` sees it. A plain `return attempt()` hands the
unfinished promise straight to the caller. When it fails later, this
function has already returned, and the `catch` never runs. We'll prove
it in a moment.

Now `downloadLayers` shrinks to the one job that's really about
layers. Import `retry` next to `mapWithLimit`, and replace the body of
the arrow function:

```ts
  return mapWithLimit(layers, limit, async (layer, i) => {
    // retry tries again after a failure. A failed try is cleaned up by
    // the store (no .partial left behind), so each try starts fresh.
    const result = await retry(() => downloadLayer(source, store, repository, layer), attempts, delayMs)
    onLayer(i, layer, result)
    return result
  })
```

`() => downloadLayer(...)` wraps the download in a function with no
arguments, so `retry` can call it as many times as it needs. Passing
`downloadLayer(...)` itself would start one download, once, and hand
`retry` a promise it couldn't restart. Here `T` is `LayerResult`, from
what `downloadLayer` returns.

The whole function is now this:

```ts
export async function downloadLayers(
  source: BlobSource,
  store: ContentStore,
  repository: string,
  layers: readonly Descriptor[],
  options: DownloadOptions = {},
): Promise<LayerResult[]> {
  // Take each setting out of options, with a default if it's missing.
  const { limit = 3, attempts = 3, delayMs = 1000, onLayer = () => {} } = options
  // mapWithLimit runs the function below on every layer, `limit` at a
  // time. Here T is Descriptor and R is LayerResult.
  return mapWithLimit(layers, limit, async (layer, i) => {
    // retry tries again after a failure. A failed try is cleaned up by
    // the store (no .partial left behind), so each try starts fresh.
    const result = await retry(() => downloadLayer(source, store, repository, layer), attempts, delayMs)
    onLayer(i, layer, result)
    return result
  })
}
```

It reads like the sentence you'd use to describe it: for every layer,
`limit` at a time, retry the download, then report it.

```
$ npm run check
```

```
 Test Files  9 passed (9)
      Tests  69 passed (69)
```

Still 69, still no test changed.

### Faking the clock

Now the test Step 4 couldn't write: that `retry` really waits 1 second,
then 2. Waiting for real would make every test run take seconds. And a
test that passes because "enough time went by" is fragile.

Vitest can replace the clock. After `vi.useFakeTimers()`, `setTimeout`
no longer fires by itself. Time stands still until the test moves it
forward with `vi.advanceTimersByTimeAsync(ms)`. Any timer due in that
time fires then, and the code waiting on it runs. A test can then say
"at 999 ms nothing has happened yet; at 1000 ms the second try has
started", and it runs in a millisecond. That's the same idea as the
fake registry, applied to time: replace the thing you can't control
with one you can.

Add to `src/tasks.test.ts` (and add `afterEach`, `beforeEach`, `vi` and
`retry` to its imports):

```ts
describe("retry", () => {
  // A fake clock: setTimeout no longer waits by itself. Time moves only
  // when the test moves it, so "wait 2 seconds" takes no time at all.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("waits 1 second, then 2, between tries", async () => {
    const attempt = vi.fn<() => Promise<string>>()
    attempt.mockRejectedValueOnce(new Error("first"))
    attempt.mockRejectedValueOnce(new Error("second"))
    attempt.mockResolvedValueOnce("worked")

    const result = retry(attempt, 3, 1000)
    // The first try happens at once.
    expect(attempt).toHaveBeenCalledTimes(1)

    // Move the clock forward. The Async version also lets the code
    // that was waiting run, up to its next wait.
    await vi.advanceTimersByTimeAsync(999)
    expect(attempt).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(attempt).toHaveBeenCalledTimes(2)

    // The second wait is twice as long.
    await vi.advanceTimersByTimeAsync(1999)
    expect(attempt).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBe("worked")
  })
})
```

`afterEach` puts the real clock back, so other tests aren't affected.
`const result = retry(...)`, with no `await`, starts `retry` and keeps
its promise for later, as in Step 2. Between moves of the clock, the
test checks how many tries there have been.

Why `advanceTimersByTimeAsync` and not the plain
`advanceTimersByTime`? When the timer fires, `retry` still has to wake
up from its `await` and call `attempt` again. Those steps are queued to
run "as soon as the current code finishes". The `Async` version waits
for them too, so by the time the next line runs, the second try has
really happened.

> **Your turn.** A second test in `describe("retry")`: "throws the last
> error when every try fails". An `attempt` that fails twice, with
> `"first"` then `"second"`. `retry(attempt, 2, 1000)` rejects with
> `"second"`, and `attempt` was called twice. One catch: start the
> `expect(...).rejects` check *before* moving the clock, and `await` it
> afterwards.

Here it is:

```ts
  it("throws the last error when every try fails", async () => {
    const attempt = vi.fn<() => Promise<string>>()
    attempt.mockRejectedValueOnce(new Error("first"))
    attempt.mockRejectedValueOnce(new Error("second"))

    // Start checking for the error before moving the clock, so the
    // failure has somewhere to go the moment it happens.
    const check = expect(retry(attempt, 2, 1000)).rejects.toThrow("second")
    await vi.advanceTimersByTimeAsync(1000)
    await check
    expect(attempt).toHaveBeenCalledTimes(2)
  })
```

Why the check first? `retry` fails while the clock is moving. If
nothing is listening for that failure yet, Node reports it as an
*unhandled rejection*, a failure nobody caught, and Vitest flags it as
an error even though the test catches it a moment later.

```
$ npm run check
```

```
 Test Files  9 passed (9)
      Tests  71 passed (71)
```

Now the promised proof about `return await`. In `retry`, change
`return await attempt()` to `return attempt()`, then:

```
$ npx vitest run src/tasks.test.ts
```

```
 FAIL  src/tasks.test.ts > retry > waits 1 second, then 2, between tries
AssertionError: expected "vi.fn()" to be called 2 times, but got 1 times
 ❯ src/tasks.test.ts:59:21

 FAIL  src/tasks.test.ts > retry > throws the last error when every try fails
AssertionError: expected [Function] to throw error including 'second' but got 'first'

Expected: "second"
Received: "first"

 ❯ src/tasks.test.ts:75:50
```

(Trimmed; Vitest also lists two unhandled rejections of `Error: first`.)
Without the `await`, the first failure skipped the `catch` entirely.
There was no retry: the error from the first try went straight to the
caller. The code looks almost the same, but it never retries. Put the
`await` back.

## Step 7: the same idea, back in Chapter 6

Generic functions fix something we left behind on purpose. Chapter 6's
`parseManifest` has the same four lines twice, once per schema:

```ts
    const result = ImageIndexSchema.safeParse(json)
    if (!result.success) {
      throw invalid(mediaType, result.error)
    }
    return { kind: "index", index: result.data }
```

and again with `ImageManifestSchema`. We couldn't share them then: the
two results have different types (`ImageIndex` and `ImageManifest`), so
one function would have needed a type that covers both of them, and
we'd have lost the checking. A generic function handles both: "give me
a schema whose data has type `T`, and I'll give you back a `T`."

zod has a name for "a schema whose checked data has type `T`":
`z.ZodType<T>`.

> **Your turn.** In `src/manifest.ts`, above `parseManifest`, write
> `parseWith<T>(schema: z.ZodType<T>, mediaType: string, json: unknown): T`,
> holding the `safeParse` lines once. Then make each branch of
> `parseManifest` a single `return` that calls it.

Here it is:

```ts
// Check `json` against any schema and return the checked data.
// z.ZodType<T> means "a schema whose checked data has type T", so the
// result's type comes from whichever schema is passed in.
function parseWith<T>(schema: z.ZodType<T>, mediaType: string, json: unknown): T {
  // safeParse never throws. It returns { success: true, data } or
  // { success: false, error }; checking `success` tells the compiler which.
  const result = schema.safeParse(json)
  if (!result.success) {
    throw invalid(mediaType, result.error)
  }
  return result.data
}

export function parseManifest(mediaType: string, bytes: Uint8Array): Manifest {
  const json = parseJson(bytes)

  if (INDEX_TYPES.includes(mediaType)) {
    // Here T is ImageIndex.
    return { kind: "index", index: parseWith(ImageIndexSchema, mediaType, json) }
  }
  if (IMAGE_TYPES.includes(mediaType)) {
    // And here T is ImageManifest.
    return { kind: "image", manifest: parseWith(ImageManifestSchema, mediaType, json) }
  }
  throw new ManifestError(`unsupported media type "${mediaType}"`)
}
```

```
$ npm run check
```

```
 Test Files  9 passed (9)
      Tests  71 passed (71)
```

Chapter 6's tests pass unchanged. Is the checking really still there?
Swap the schemas on purpose: give the index branch
`ImageManifestSchema`.

```
$ npm run typecheck
```

```
src/manifest.ts(114,29): error TS2741: Property 'manifests' is missing in type '{ schemaVersion: 2; config: { mediaType: string; digest: string; size: number; }; layers: { mediaType: string; digest: string; size: number; }[]; }' but required in type '{ schemaVersion: 2; manifests: { mediaType: string; digest: string; size: number; platform?: { os: string; architecture: string; variant?: string | undefined; } | undefined; }[]; }'.
```

Long, but read it as: "you gave me something with `config` and
`layers` where an index (with `manifests`) belongs." `T` came from the
schema, so the wrong schema gives the wrong type, and the compiler
catches it. Put `ImageIndexSchema` back.

## Try it

```
$ rm -rf ~/.cache/oci-pull /tmp/oci-nginx
$ time npm start --silent -- nginx:1.27-alpine /tmp/oci-nginx/rootfs
```

```
registry   docker.io
repository library/nginx
tag        1.27-alpine
api        needs a token
challenge  Bearer realm="https://auth.docker.io/token",service="registry.docker.io"
platform   linux/amd64
manifest   sha256:62223d644fa234c3a1cc785ee14242ec47a77364226f1c811d2f669f96dc2ac8
config     sha256:6769dc3a703c719c1d2756bda113659be28ae16cf0da58dd5fd823d6b9a050ea
layer 3/8  sha256:b464cfdf2a6319875aeb27359ec549790ce14d8214fcb16ef915e4530e5ed235  0.0 MB  downloaded
layer 2/8  sha256:61ca4f733c802afd9e05a32f0de0361b6d713b8b53292dc15fb093229f648674  1.8 MB  downloaded
layer 4/8  sha256:d7e5070240863957ebb0b5a44a5729963c3462666baa2947d00628cb5f2d5773  0.0 MB  downloaded
layer 5/8  sha256:81bd8ed7ec6789b0cb7f1b47ee731c522f6dba83201ec73cd6bca1350f582948  0.0 MB  downloaded
layer 6/8  sha256:197eb75867ef4fcecd4724f17b0972ab0489436860a594a9445f8eaff8155053  0.0 MB  downloaded
layer 1/8  sha256:f18232174bc91741fdf3da96d85011092101a032a93a388b79e99e69c2d5c870  3.6 MB  downloaded
layer 7/8  sha256:34a64644b756511a2e217f0508e11d1a572085d66cd6dc9a555a082ad49a3102  0.0 MB  downloaded
layer 8/8  sha256:39c2ddfd6010082a4a646e7ca44e95aca9bf3eaebc00f17f7ccc2954004f2a7d  15.5 MB  downloaded
unpacked   /tmp/oci-nginx/rootfs

real	0m4.948s
user	0m0.948s
sys	0m0.250s
```

7.6 seconds in Chapter 7, 4.9 now, three at a time. Three at a time
was no slower than all eight at once (5.4 seconds in Step 2): most of
the waiting was the round trips before each download, and three
workers working through the queue overlap those well enough. Watch the
order: layers 1, 2 and 3 start first. Layer 3 is tiny, so its worker
moves on to 4, then 5, then 6, while layer 1 is still arriving.

Run it again, with the cache full:

```
$ rm -rf /tmp/oci-nginx
$ time npm start --silent -- nginx:1.27-alpine /tmp/oci-nginx/rootfs
```

```
layer 1/8  sha256:f18232174bc91741fdf3da96d85011092101a032a93a388b79e99e69c2d5c870  3.6 MB  cached
layer 3/8  sha256:b464cfdf2a6319875aeb27359ec549790ce14d8214fcb16ef915e4530e5ed235  0.0 MB  cached
layer 2/8  sha256:61ca4f733c802afd9e05a32f0de0361b6d713b8b53292dc15fb093229f648674  1.8 MB  cached
layer 4/8  sha256:d7e5070240863957ebb0b5a44a5729963c3462666baa2947d00628cb5f2d5773  0.0 MB  cached
layer 5/8  sha256:81bd8ed7ec6789b0cb7f1b47ee731c522f6dba83201ec73cd6bca1350f582948  0.0 MB  cached
layer 6/8  sha256:197eb75867ef4fcecd4724f17b0972ab0489436860a594a9445f8eaff8155053  0.0 MB  cached
layer 7/8  sha256:34a64644b756511a2e217f0508e11d1a572085d66cd6dc9a555a082ad49a3102  0.0 MB  cached
layer 8/8  sha256:39c2ddfd6010082a4a646e7ca44e95aca9bf3eaebc00f17f7ccc2954004f2a7d  15.5 MB  cached
unpacked   /tmp/oci-nginx/rootfs

real	0m2.470s
user	0m0.555s
sys	0m0.142s
```

(The lines above `layer` are the same as before.) Even "cached" comes
out in a slightly shuffled order now: checking the store is a disk
operation, and three of them run at once.

## What this chapter doesn't do

- **Stop downloads already running when one fails.** The `failed` flag
  stops new layers from starting, but the two other workers finish the
  layer they're on before the program exits. Stopping a download
  midway needs a way to tell `fetch` to give up
  (`AbortController`), passed down through `fetchBlob` and the HTTP
  client. Chapter 12 does that.
- **Tell a hopeless error from a passing one.** We retry every
  failure, including a `404` that will never succeed, so a missing
  layer costs three tries and three seconds before the error. Chapter
  12 sorts errors into "try again" and "give up now."
- **Resume a broken download.** A retry starts the layer from byte
  zero, as Chapter 7's did.
- **Show progress within a layer.** A 500 MB layer prints nothing until
  it's done.

## Commit

```
$ npm run check
$ git add -A
$ git commit -m "Download layers at the same time, with a limit and retries"
```

## What you should now be able to answer

Try to answer each one in your own words first. Then open the answer
to check.

**1. Why did nginx's 0.0 MB layers take time to download in Chapter 7?**

<details>
<summary>Answer</summary>

Each download costs a few round trips before the first byte: ask the
registry, get redirected to the download server, connect there. That
costs the same for a tiny layer as for a big one. Done one after
another, those waits add up; done together, they overlap.

</details>

**2. What happens when you call an `async` function without `await`?**

<details>
<summary>Answer</summary>

It starts running right away and gives back a promise. The work
carries on while your code continues, and `await` (or `Promise.all`)
waits for it later. That's how Step 2 started every download at once.
Python is different: an `async def` call does nothing until it's
awaited or scheduled.

</details>

**3. The layers finish in any order. How do the results and the progress lines stay straight?**

<details>
<summary>Answer</summary>

The results go into the slot for each layer's position (`results[i]`),
so the returned list is in the layers' order, as `Promise.all` keeps
its list in order. The progress lines print in finishing order, so
`onLayer` is given the layer's position and the layer itself, and
each line says which layer it's about.

</details>

**4. Why not download every layer at once, and why three?**

<details>
<summary>Answer</summary>

An image can have 50 layers. 50 connections at once can upset the
registry, and on a slow line each gets a fiftieth of the speed, so
they're all slow and some time out. Three is what Docker uses by
default. In our nginx run it was no slower than all eight at once.

</details>

**5. How do three workers share the layers without taking the same one twice, and why is no lock needed?**

<details>
<summary>Answer</summary>

They all loop over one shared iterator from `entries()`, which hands
out each item once and remembers where it's up to. JavaScript runs one
piece of your code at a time and only switches at an `await`, so
taking an item or filling a result slot can't be interrupted halfway.
In Go, the same sharing would need a mutex or a channel.

</details>

**6. Why does a retry wait longer each time, and why can it start the layer from scratch safely?**

<details>
<summary>Answer</summary>

If the registry is struggling, instant retries from many clients make
it worse; doubling the wait (1 s, 2 s, 4 s) gives it room. Starting
over is safe because Chapter 7's store deletes the `.partial` file
when a download fails, so the next try writes a fresh file.

</details>

**7. What is a generic function? What were `T` and `R` when `downloadLayers` called `mapWithLimit`?**

<details>
<summary>Answer</summary>

A function with type parameters, written in angle brackets
(`mapWithLimit<T, R>`), so it works for any types while still checking
them, like Go's `[T, R any]`. The compiler works them out from the
arguments: `T` was `Descriptor` (from `layers`) and `R` was
`LayerResult` (from what the arrow function returns).

</details>

**8. Why `return await attempt()` inside `retry`'s `try`, and not `return attempt()`?**

<details>
<summary>Answer</summary>

`await` makes the failure happen inside the `try`, so the `catch` sees
it and retries. A plain `return` hands back the unfinished promise; it
fails after the function has already returned, so the `catch` never
runs and there's no retry. The tests showed it: the error from the
first try went straight to the caller.

</details>

**9. What does a fake clock do, and why was `retry` easy to test with it while `downloadLayers` wasn't?**

<details>
<summary>Answer</summary>

After `vi.useFakeTimers()`, timers only fire when the test moves time
forward with `vi.advanceTimersByTimeAsync`. So "wait 2 seconds" takes
no time, and the test can check what happened at 999 ms and at
1000 ms. `retry` does nothing but call a function and wait. Every test
of `downloadLayers` also does real disk work, which the fake clock
doesn't control, so its retry tests could only use a tiny real delay.

</details>

**10. We wrote `downloadLayers` whole, then split it. How did we know each split didn't break anything?**

<details>
<summary>Answer</summary>

The tests from steps 1 to 4 only check what `downloadLayers` does from
the outside: what it returns, what it reports, what ends up in the
store. They never mention a helper, so they had to pass unchanged after
each split, and they did (67, then 69 with the new helper tests, then
71). Tests for the helpers came after each split.

</details>

**11. How does `parseWith` know what type to return, and what happened when it was given the wrong schema?**

<details>
<summary>Answer</summary>

Its parameter is `z.ZodType<T>`, "a schema whose checked data has type
`T`", so `T` comes from the schema passed in: `ImageIndex` or
`ImageManifest`. Given the manifest schema where an index belongs, the
compiler refused: the result had `config` and `layers` but no
`manifests`.

</details>

## Next chapter

The downloads are fast now, and they recover from a dropped
connection. The other shortcut is still there: the system's `tar`
command unpacks the layers. A layer can delete a file that an earlier
layer added. It does this by including an empty file named
`.wh.<name>`, a "whiteout", and `tar` knows nothing about that. It
unpacks the marker as an ordinary file, and the deleted file stays.
Chapter 9 replaces `tar` with our own unpacking code, built on the
`tar` package, that applies layers in order, honors whiteouts, and is
tested against a real temporary folder.
