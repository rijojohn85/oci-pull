import type { Descriptor } from "./manifest.ts"
import type { ContentStore } from "./store.ts"


export interface BlobSource {
  fetchBlob(repository: string, digest: string): Promise<AsyncIterable<Uint8Array>>
}
export type LayerResult = "downloaded" | "cached"

export async function downloadLayer(
  source: BlobSource,
  store: ContentStore,
  repository: string,
  layer: Descriptor,
): Promise<LayerResult> {
  if (await store.has(layer.digest)) {
    return "cached"
  }
  await store.put(layer, await source.fetchBlob(repository, layer.digest))
  return "downloaded"
}
