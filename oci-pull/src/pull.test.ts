
import { type Mock, describe, expect, it, vi } from "vitest"
import { type BlobSource, downloadLayer, downloadLayers } from "./pull.ts"
import { ContentStore } from "./store.ts"
import { useTempFolder } from "./temp-folder.ts"
import { chunksOf, HELLO } from "./test-blobs.ts"
import type { Descriptor } from "./manifest.ts"
import { sha256Digest } from "./digest.ts"
import { sleep } from "./tasks.ts"

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

  it("skips a layer that's already there", async () => {
    const { source, fetchBlob } = helloSource()
    const store = new ContentStore(folder())
    await downloadLayer(source, store, "library/alpine", HELLO)

    // The second time, the store already has it: no second download.
    expect(await downloadLayer(source, store, "library/alpine", HELLO)).toBe("cached")
    expect(fetchBlob).toHaveBeenCalledTimes(1)
  })
})


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
  it("returns what happened to each layer, in the layers' order", async () => {
    const { source } = textSource("one", "two", "three")
    const store = new ContentStore(folder())
    const layers = [layerOf("one"), layerOf("two"), layerOf("three")]
    // Put the middle one in the store first.
    await downloadLayer(source, store, "library/alpine", layerOf("two"))

    expect(await downloadLayers(source, store, "library/alpine", layers)).toEqual(["downloaded", "cached", "downloaded"])
  })
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
          await sleep(5)
          // yield* passes along every chunk of another stream.
          yield* chunks
          running -= 1
        })()
      },
    }

    await downloadLayers(counting, store, "library/alpine", texts.map(layerOf), { limit: 2 })

    expect(most).toBe(2)
  })
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
  it("gives up after `attempts` tries", async () => {
    const { source, fetchBlob } = textSource()
    fetchBlob.mockRejectedValue(new TypeError("fetch failed"))
    const store = new ContentStore(folder())
    const download = downloadLayers(source, store, "library/alpine", [layerOf("one")], { attempts: 2, delayMs: 1 })

    await expect(download).rejects.toThrow("fetch failed")
    expect(fetchBlob).toHaveBeenCalledTimes(2)
  })
})

