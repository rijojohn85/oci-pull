
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
})
