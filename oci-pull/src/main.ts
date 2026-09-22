export function useage(): string {
  return "useage: oci-pull <image> <output-dir>"
}

export function main(argv: string[]): number {
  if (argv.length !== 2) {
    console.error(useage());
    return 2;
  }
  const [image, outputDir] = argv;
  console.log(`would pull ${image} int ${outputDir}`);
  return 0;
}
