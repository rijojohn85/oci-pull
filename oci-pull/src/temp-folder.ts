
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach } from "vitest"

// Call inside a describe(): every test gets a fresh, empty folder, and it's
// deleted afterwards. The folder changes per test, so this returns a
// function to ask for the current one, not the path itself.
export function useTempFolder(): () => string {
  let folder = ""
  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "oci-pull-test-"))
  })
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true })
  })
  return () => folder
}
