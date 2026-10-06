
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

// A value as the bytes a server would send: JSON text, UTF-8 encoded.
// Docker Hub indents with two spaces; the `null, 2` does the same, so
// ALPINE_AMD64 comes out byte for byte as Docker Hub sent it.
export function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value, null, 2))
}
