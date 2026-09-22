import { describe, expect, it } from "vitest"
import { useage } from "./main.ts"

describe("useage", () => {
  it("names the program and both arguments", () => {
    expect(useage()).toContain("oci-pull");
    expect(useage()).toContain("<image>")
    expect(useage()).toContain("<output-dir>")
  })
})
