import { join } from "path"
import { AnonymousAuthenticator, AuthError } from "./auth.ts"
import { FetchHttpClient } from "./http.ts"
import { formatPlatform, hostPlatform, ManifestError, type Platform } from "./manifest.ts"
import { InvalidReferenceError, parseReference, target } from "./reference.ts"
import { RegistryClient, RegistryError, type ApiCheck } from "./registry.ts"
import { resolveImage, type ResolvedImage } from "./resolve.ts"
import { ContentStore, StoreError } from "./store.ts"
import { homedir } from "os"
import { downloadLayers } from "./pull.ts"
import { unpackWithSystemTar } from "./unpack.ts"

export function useage(): string {
  return "useage: oci-pull <image> <output-dir>"
}

// One line of output for each kind of answer. The switch has no
// default: add a third kind to ApiCheck and this stops compiling.
function describeApiCheck(check: ApiCheck): string {
  switch (check.kind) {
    case "open":
      return "api        open, no token needed"
    case "needs-token":
      // Inside this case, the compiler knows check has `challenge`.
      return `api        needs a token\nchallenge  ${check.challenge}`
  }
}
// Three lines about the manifest. join("\n") glues the array into one
// string with a line break between items, like strings.Join in Go.
// function describeManifest(manifest: RawManifest): string {
//   return [
//     `manifest   ${manifest.mediaType}`,
//     `digest     ${manifest.digest ?? "(not sent)"}`,
//     `size       ${manifest.bytes.length} bytes`,
//   ].join("\n")
// }
// What we're about to pull: the platform, the manifest's digest, the
// config, and one line per layer.
// What we're about to pull: the platform, the manifest's digest, and
// the config. Each layer gets its own line as it downloads.
function describeImage(platform: Platform, resolved: ResolvedImage): string {
  return [
    `platform   ${formatPlatform(platform)}`,
    `manifest   ${resolved.digest ?? "(not sent)"}`,
    `config     ${resolved.manifest.config.digest}`,
  ].join("\n")
}

// 3630321 -> "3.6 MB". The _ in 1_000_000 is only for reading; it's ignored.
function megabytes(bytes: number): string {
  // toFixed(1): one digit after the point, as a string.
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

export async function main(argv: string[]): Promise<number> {
  if (argv.length !== 2) {
    console.error(useage())
    return 2
  }
  const [image, outputDir] = argv

  if (image === undefined || outputDir === undefined) {
    console.error(useage())
    return 2
  }
  try {
    const ref = parseReference(image)
    console.log(`registry ${ref.registry}`)
    console.log(`repository ${ref.repository}`)
    // Pick the label from `kind`, then let target() pick the value.
    console.log(`${ref.kind === "tag" ? "tag       " : "digest    "} ${target(ref)}`)
    console.log(`would pull into ${outputDir}`)

    // One real HTTP client, shared: the registry and the token server
    // are both just addresses to GET.
    const http = new FetchHttpClient()
    const registry = new RegistryClient(http, ref.registry, new AnonymousAuthenticator(http))
    console.log(describeApiCheck(await registry.checkAPI()))
    // This machine's platform; the registry client is the manifest source.
    const platform = hostPlatform()
    const resolved = await resolveImage(registry, ref.repository, target(ref), platform)
    console.log(describeImage(platform, resolved))

    // Downloads go into a cache that outlives this run, so a layer that's
    // already there is never downloaded twice.
    const store = new ContentStore(join(homedir(), ".cache", "oci-pull"))
    const { layers } = resolved.manifest
    // ROUGH: one layer at a time. Chapter 8 downloads them all at once.
    // entries() gives [position, item] pairs, like enumerate() in Python.
    await downloadLayers(registry, store, ref.repository, layers, {
      onLayer: (i, layer, result) => {
        console.log(`layer ${i + 1}/${layers.length}  ${layer.digest}  ${megabytes(layer.size)}  ${result}`)
      }
    })

    // Unpack in order: each layer goes on top of the ones before it.
    for (const layer of layers) {
      await unpackWithSystemTar(store.pathFor(layer.digest), outputDir)
    }
    console.log(`unpacked   ${outputDir}`)

    return 0
  } catch (err) {
    if (err instanceof InvalidReferenceError || err instanceof RegistryError || err instanceof AuthError || err instanceof ManifestError || err instanceof StoreError) {
      console.error(err.message)
      return 1
    }
    throw err
  }
}
