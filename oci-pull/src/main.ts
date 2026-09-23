import { InvalidReferenceError, parseReference, target } from "./reference.ts"

export function useage(): string {
  return "useage: oci-pull <image> <output-dir>"
}

export function main(argv: string[]): number {
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
  } catch (err) {
    if (err instanceof InvalidReferenceError) {
      console.error(err.message)
      return 1
    }
    throw err
  }

  return 0
}
