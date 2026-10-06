
import { execFile } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { promisify } from "node:util"

// execFile runs a program with a list of arguments (no shell in between,
// so odd characters in a path can't do harm). promisify turns its
// callback style into a function that returns a Promise.
const run = promisify(execFile)

// SHORTCUT, replaced in Chapter 9: let the system's tar unpack a layer.
// It gets the files right, but not deletions between layers.
export async function unpackWithSystemTar(layerFile: string, folder: string): Promise<void> {
  await mkdir(folder, { recursive: true })
  // -x extract, -z it's gzipped, -f from this file, -C into this folder.
  await run("tar", ["-xzf", layerFile, "-C", folder])
}
