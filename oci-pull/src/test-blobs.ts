
// A tiny blob for tests: the five bytes "hello", and their real sha256
// (from `echo -n hello | sha256sum`).
export const HELLO = {
  mediaType: "text/plain",
  digest: "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
  size: 5,
}

// Text, sent as separate chunks the way a download arrives.
// `async function*` makes something you can loop over with `for await`.
export async function* chunksOf(...parts: string[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) {
    yield new TextEncoder().encode(part)
  }
}
