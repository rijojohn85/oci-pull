import { describe, expect, it } from "vitest"
import { InvalidReferenceError, parseReference, target } from "./reference.ts"

describe("parseReference", () => {
  it("fills in Docker Hub's defaults for a bare name", () => {
    // toEqual: the WHOLE object must match, every field.
    expect(parseReference("alpine")).toEqual({
      kind: "tag",
      registry: "docker.io",
      repository: "library/alpine",
      tag: "latest",
    })
  })

  it("keeps an explicit tag", () => {
    // toMatchObject: only the fields listed must match; others are ignored.
    expect(parseReference("alpine:3.20")).toMatchObject({
      repository: "library/alpine",
      tag: "3.20",
    })
  })

  it("does not add library/ to a user's own repository", () => {
    expect(parseReference("rijojohn85/oci-pull:v1")).toMatchObject({
      registry: "docker.io",
      repository: "rijojohn85/oci-pull",
    })
  })

  // it.each runs the same test once per row. Each row's values become
  // the function's parameters. %s in the name is replaced by the first value.
  it.each([
    ["ghcr.io/astral-sh/uv:latest", "ghcr.io", "astral-sh/uv"],
    ["localhost:5000/dev/app:v2", "localhost:5000", "dev/app"], // colon = port
    ["registry.example.com:5000/team/app", "registry.example.com:5000", "team/app"],
  ])("splits the registry out of %s", (input, registry, repository) => {
    // { registry, repository } = { registry: registry, repository: repository }
    expect(parseReference(input)).toMatchObject({ registry, repository })
  })

  it("reads a digest reference", () => {
    const ref = parseReference(
      "alpine@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc",
    )
    expect(ref).toEqual({
      kind: "digest",
      registry: "docker.io",
      repository: "library/alpine",
      digest: "sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc",
    })
  })

  it("prefers the digest when both a tag and a digest are given", () => {
    const ref = parseReference(
      "alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc",
    )
    expect(ref.kind).toBe("digest") // toBe: plain === comparison
  })

  // %j prints the value JSON-quoted, so the empty string shows as "".
  it.each([
    ["", "the name is empty"],
    ["alpine:", "is not a valid tag"],
    ["alpine@sha256:xyz", "is not a valid digest"],
    ["Alpine", "is not a valid repository name"], // uppercase not allowed
  ])("rejects %j", (input, problem) => {
    // expect() gets a FUNCTION here, `() => ...`, so it can call it and
    // catch the throw. Passing parseReference(input) directly would throw
    // before expect() ever ran.
    expect(() => parseReference(input)).toThrow(InvalidReferenceError) // right kind
    expect(() => parseReference(input)).toThrow(problem) // message contains this
  })
})

describe("target", () => {
  it("is the tag for a tagged reference", () => {
    expect(target(parseReference("alpine:3.20"))).toBe("3.20")
  })

  it("is the digest for a digested reference", () => {
    // "a".repeat(64) builds a 64-character string of a's: a fake but valid digest.
    expect(target(parseReference("alpine@sha256:" + "a".repeat(64)))).toBe(
      "sha256:" + "a".repeat(64),
    )
  })
})
