import * as z from "zod"
import { DIGEST_PATTERN } from "./reference.ts"

const DescriptorSchema = z.object({
  mediaType: z.string(),
  digest: z.string().regex(DIGEST_PATTERN, "not a digest"),
  size: z.number().int().nonnegative(),
})

const PlatformSchema = z.object({
  os: z.string(),
  architecture: z.string(),
  variant: z.string().optional()
})



const IndexEntrySchema = DescriptorSchema.extend({ platform: PlatformSchema.optional() })

const ImageIndexSchema = z.object({
  schemaVersion: z.literal(2),
  manifests: z.array(IndexEntrySchema),
})

const ImageManifestSchema = z.object({
  schemaVersion: z.literal(2),
  config: DescriptorSchema,
  layers: z.array(DescriptorSchema)
})

// z.infer reads a schema and gives back the matching TypeScript type.
// The shape is written once, so the check and the type can't drift apart.
export type Descriptor = z.infer<typeof DescriptorSchema>
export type Platform = z.infer<typeof PlatformSchema>
export type IndexEntry = z.infer<typeof IndexEntrySchema>
export type ImageIndex = z.infer<typeof ImageIndexSchema>
export type ImageManifest = z.infer<typeof ImageManifestSchema>

// The server's content-type says which shape to expect. Each shape has
// two names, the OCI standard's and Docker's older one, with the same
// fields. `readonly string[]` lets includes() take any string.
export const INDEX_TYPES: readonly string[] = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
]
export const IMAGE_TYPES: readonly string[] = [
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
]

// What parseManifest found: an index or an image manifest.
export type Manifest = { kind: "index", index: ImageIndex } | { kind: "image", manifest: ImageManifest }

export class ManifestError extends Error {
  constructor(problem: string) {
    super(`manifest: ${problem}`)
    this.name = "ManifestError"
  }
}

function parseJson(bytes: Uint8Array): unknown {
  const text = new TextDecoder().decode(bytes)
  try {
    return JSON.parse(text)
  } catch {
    throw new ManifestError("body is not JSON")
  }
}

// prettifyError lists every problem zod found, one per line, each with
// the path to the bad field.
function invalid(mediaType: string, error: z.ZodError): ManifestError {
  return new ManifestError(`not a valid ${mediaType}\n${z.prettifyError(error)}`)
}

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

// Node names some CPUs differently from registries (which use Go's
// names). Only the ones that differ are listed here.
const NODE_TO_REGISTRY_ARCH: Record<string, string> = {
  x64: "amd64",
  ia32: "386",
}

// The platform to pull for this machine. The OS is always linux: an
// image is a Linux folder, even on a Mac (Docker runs it in a Linux VM).
// `arch` defaults to this machine's CPU; a test can pass another one.
export function hostPlatform(arch: string = process.arch): Platform {
  return { os: "linux", architecture: NODE_TO_REGISTRY_ARCH[arch] ?? arch }
}

// "linux/arm/v7", or "linux/amd64" when there's no variant.
export function formatPlatform(platform: Platform): string {
  // filter() drops a missing variant, so there's no trailing "/".
  return [platform.os, platform.architecture, platform.variant].filter((part) => part !== undefined).join("/")
}

// Same OS and CPU. The variant only counts if we asked for one.
function matches(have: Platform | undefined, want: Platform): boolean {
  return (
    have !== undefined &&
    have.os === want.os &&
    have.architecture === want.architecture &&
    (want.variant === undefined || have.variant === want.variant)
  )
}

// The index entry for `want`, or an error that lists what's on offer.
export function pickPlatform(index: ImageIndex, want: Platform): IndexEntry {
  // find() returns the first entry the arrow function says yes to, or undefined.
  const found = index.manifests.find((entry) => matches(entry.platform, want))
  if (found !== undefined) {
    return found
  }
  const offered = index.manifests
    .map((entry) => entry.platform)
    // After this filter, the compiler knows no undefined is left.
    .filter((platform) => platform !== undefined)
    .map(formatPlatform)
  // A Set keeps one of each; [...set] turns it back into an array.
  const unique = [...new Set(offered)]
  throw new ManifestError(`no image for ${formatPlatform(want)}; this one has ${unique.join(", ")}`)
}


