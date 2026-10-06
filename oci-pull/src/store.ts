import { access, mkdir, rename, rm } from "node:fs/promises"
import { join } from "path"
import type { Descriptor } from "./manifest.ts"
import { createHash } from "node:crypto"
import { pipeline } from "node:stream/promises"
import { createWriteStream } from "node:fs"



export class StoreError extends Error {
  constructor(problem: string) {
    super(`store: ${problem}`)
    this.name = "StoreError"
  }
}

export class ContentStore {
  private readonly root: string

  constructor(root: string) {
    this.root = root
  }

  pathFor(digest: string): string {
    if (!digest.startsWith("sha256:")) {
      throw new StoreError(`unsupported digest ${digest}`)
    }
    return join(this.root, "sha256", digest.slice("sha256:".length))
  }
  async has(digest: string): Promise<boolean> {
    try {
      await access(this.pathFor(digest))
      return true
    } catch {
      return false
    }
  }
  async put(expected: Descriptor, chunks: AsyncIterable<Uint8Array>): Promise<string> {
    const path = this.pathFor(expected.digest)
    const partial = `${path}.partial`

    await mkdir(join(this.root, "sha256"), { recursive: true })
    const hash = createHash("sha256")
    let size = 0
    try {
      await pipeline(chunks,
        async function* (source: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
          for await (const chunk of source) {
            size += chunk.length
            if (size > expected.size) {
              throw new StoreError(`${expected.digest} is bigger than ${expected.size} bytes`)
            }
            hash.update(chunk)
            yield chunk
          }
        },
        createWriteStream(partial)
      )
      const actual = `sha256:${hash.digest("hex")}`
      if (size !== expected.size || actual !== expected.digest) {
        throw new StoreError(`expected ${expected.digest} (${expected.size} bytes), got ${actual} (${size} bytes)`)
      }
    } catch (err) {
      await rm(partial, { force: true })
      throw err
    }
    await rename(partial, path)
    return path
  }
}
