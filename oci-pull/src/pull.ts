import type { Descriptor } from "./manifest.ts"
import type { ContentStore } from "./store.ts"
import { mapWithLimit, retry } from "./tasks.ts"


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


export type OnLayer = (index: number, layer: Descriptor, result: LayerResult) => void

export interface DownloadOptions {
  onLayer?: OnLayer
  limit?: number
  // How many tries each layer gets before we give up (3 if left out).
  attempts?: number
  // How long to wait before the first retry, in milliseconds (1000 if
  // left out). Each later wait is twice as long as the one before.
  delayMs?: number
}

export async function downloadLayers(
  source: BlobSource,
  store: ContentStore,
  repository: string,
  layers: readonly Descriptor[],
  options: DownloadOptions = {},
): Promise<LayerResult[]> {
  // Take each setting out of options, with a default if it's missing.
  const { limit = 3, attempts = 3, delayMs = 1000, onLayer = () => { } } = options
  // mapWithLimit runs the function below on every layer, `limit` at a
  // time. Here T is Descriptor and R is LayerResult.
  return mapWithLimit(layers, limit, async (layer, i) => {
    // retry tries again after a failure. A failed try is cleaned up by
    // the store (no .partial left behind), so each try starts fresh.
    const result = await retry(() => downloadLayer(source, store, repository, layer), attempts, delayMs)
    onLayer(i, layer, result)
    return result
  })
}
