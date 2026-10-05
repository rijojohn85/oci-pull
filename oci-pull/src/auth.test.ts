import { describe, expect, it } from "vitest";
import { AnonymousAuthenticator, AuthError, parseChallenge } from "./auth.ts";
import { replyingWith } from "./fake-http.ts";

describe("parseChallenge", () => {
  it.each([
    {
      header: 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"',
      realm: "https://auth.docker.io/token",
      service: "registry.docker.io",
    },
    {
      // GitHub adds a scope; the parser must not trip over the extra pair.
      header: 'Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:user/image:pull"',
      realm: "https://ghcr.io/token",
      service: "ghcr.io",
    },
    {
      header: 'Bearer realm="https://quay.io/v2/auth",service="quay.io"',
      realm: "https://quay.io/v2/auth",
      service: "quay.io",
    },
  ])("reads realm and service from $service", ({ header, realm, service }) => {
    expect(parseChallenge(header)).toEqual({ realm, service })
  })
  it("rejects a Basic challenge", () => {
    expect(() => parseChallenge('Basic realm="Registry Realm"')).toThrow(AuthError)
  })
  it("rejects a challenge with no service", () => {
    expect(() => parseChallenge('Bearer realm="https://auth.example.com/token"')).toThrow(
      "missing realm or service",
    )
  })
  it("rejects a challenge with no realm", () => {
    expect(() => parseChallenge('Bearer service="https://auth.example.com/token"')).toThrow(
      "missing realm or service",
    )
  })
})
const challenge = { realm: "https://auth.docker.io/token", service: "registry.docker.io" }
describe("AnnonymousAuthenticator", () => {
  it("asks the realm for a token with service and scope", async () => {
    const { http, get } = replyingWith(Response.json({ token: "abc" }))
    const auth = new AnonymousAuthenticator(http)
    const token = await auth.token(challenge, "repository:library/alpine:pull")
    expect(token).toBe("abc")
    // %3A is ":" and %2F is "/", escaped by searchParams.
    expect(get).toHaveBeenCalledWith(
      "https://auth.docker.io/token?service=registry.docker.io&scope=repository%3Alibrary%2Falpine%3Apull",
    )
  })
  it("throws error when the server's response is not 200", async () => {
    const { http } = replyingWith(new Response(null, { status: 403 }))
    const auth = new AnonymousAuthenticator(http)
    await expect(auth.token(challenge, "repository:library/alpine:pull")).rejects.toThrow(AuthError)
  })
  it("throws error when the server's response does not contain a token", async () => {
    const { http } = replyingWith(Response.json({ hello: "world" }))
    const auth = new AnonymousAuthenticator(http)
    await expect(auth.token(challenge, "repository:library/alpine:pull")).rejects.toThrow(AuthError)
  })
})
