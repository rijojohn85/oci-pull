
import { describe, expect, it } from "vitest"
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
  it("refuses a media type it doesn't know", () => {
    expect(() => parseManifest("text/html", bytesOf(ALPINE_AMD64))).toThrow('unsupported media type "text/html"')
  })

  it("refuses a body that isn't JSON", () => {
    // Plain text, not JSON: what a proxy's error page might look like.
    const html = new TextEncoder().encode("<html>")

    expect(() => parseManifest(OCI_IMAGE, html)).toThrow("body is not JSON")
  })
})

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
