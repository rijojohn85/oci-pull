
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
  it("stops as soon as there are more bytes than promised", async () => {
    const store = new ContentStore(root())

    await expect(store.put(HELLO, chunksOf("hello", " and much more"))).rejects.toThrow("is bigger than 5 bytes")
  })

  it("refuses a digest that isn't sha256", () => {
    const store = new ContentStore(root())

    expect(() => store.pathFor("sha512:abcd")).toThrow("unsupported digest sha512:abcd")
  })
})
