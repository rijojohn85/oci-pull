
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

  it("skips a layer that's already there", async () => {
    const { source, fetchBlob } = helloSource()
    const store = new ContentStore(folder())
    await downloadLayer(source, store, "library/alpine", HELLO)

    // The second time, the store already has it: no second download.
    expect(await downloadLayer(source, store, "library/alpine", HELLO)).toBe("cached")
    expect(fetchBlob).toHaveBeenCalledTimes(1)
  })
})
