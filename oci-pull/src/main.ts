import { FetchHttpClient } from "./http.ts"
import { InvalidReferenceError, parseReference, target } from "./reference.ts"
import { RegistryClient, RegistryError, type ApiCheck } from "./registry.ts"

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

    const registry = new RegistryClient(new FetchHttpClient(), ref.registry)
    console.log(describeApiCheck(await registry.checkAPI()))
    return 0
  } catch (err) {
    if (err instanceof InvalidReferenceError || err instanceof RegistryError) {
      console.error(err.message)
      return 1
    }
    throw err
  }
}
