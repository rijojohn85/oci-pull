
import { createHash } from "node:crypto"

// "sha256:<hex>" for these bytes: the same fingerprint a registry uses.
export function sha256Digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}
