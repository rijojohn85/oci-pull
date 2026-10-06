
import { sha256Digest } from "./digest.ts"
import { type ImageManifest, ManifestError, parseManifest, pickPlatform, type Platform } from "./manifest.ts"
import { DIGEST_PATTERN } from "./reference.ts"
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
  // Asked by digest? Then we know exactly which bytes to expect.
  if (DIGEST_PATTERN.test(reference)) {
    checkDigest(raw, reference)
  }
  const first = parseManifest(raw.mediaType, raw.bytes)
  if (first.kind === "image") {
    // A single-platform image: nothing to pick.
    return { digest: raw.digest, manifest: first.manifest }
  }

  // An index: pick our platform, then fetch that entry by its digest.
  const entry = pickPlatform(first.index, want)
  const rawImage = await source.fetchManifest(repository, entry.digest)
  checkDigest(rawImage, entry.digest)
  const second = parseManifest(rawImage.mediaType, rawImage.bytes)
  if (second.kind === "index") {
    throw new ManifestError(`${entry.digest} is another index, not an image`)
  }
  return { digest: entry.digest, manifest: second.manifest }
}
// Are these the bytes we asked for? A digest names exact bytes, so a
// server can't swap in a different manifest under the same name.
function checkDigest(raw: RawManifest, digest: string): void {
  const actual = sha256Digest(raw.bytes)
  if (actual !== digest) {
    throw new ManifestError(`asked for ${digest}, got bytes for ${actual}`)
  }
}

