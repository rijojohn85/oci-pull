import { describe, expect, it, vi } from "vitest"
import { RegistryClient, RegistryError } from "./registry.ts"
import { replyingInTurn, replyingWith } from "./fake-http.ts"
import { AnonymousAuthenticator, type Authenticator } from "./auth.ts"

const neverAuth: Authenticator = {
  token: async (): Promise<string> => {
    throw new Error("this test did not expect a token request")
  }
}


// The real Docker Hub challenge and manifest address, from the curl runs.
const challenge = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"'
const manifestURL = "https://registry-1.docker.io/v2/library/alpine/manifests/latest"

// A fresh 401 each call: a Response's body can only be read once,
// so replies are never shared between calls.
function unauthorized(): Response {
  return new Response(null, { status: 401, headers: { "www-authenticate": challenge } })
}

function manifest(): Response {
  return new Response("{}", {
    status: 200,
    headers: {
      "content-type": "application/vnd.oci.image.index.v1+json",
      "docker-content-digest": "sha256:abc",
    },
  })
}

// A pretend Authenticator that always hands out `token`.
function tokenGiving(token: string): Authenticator {
  return { token: vi.fn<Authenticator["token"]>(async () => token) }
}

describe("RegistryClient.checkApi", () => {
  // The test function is async, so it can await. Vitest waits for it.
  it("reports open when the registry answers 200", async () => {
    // A real Response object, built by hand: no body, status 200.
    const { http } = replyingWith(new Response(null, { status: 200 }))

    const result = await new RegistryClient(http, "mcr.microsoft.com", neverAuth).checkAPI()

    expect(result).toEqual({ kind: "open" })
  })
  it("reports needs-token with the challenge when it answers 401", async () => {
    const challenge = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"'
    const { http } = replyingWith(new Response(null, { status: 401, headers: { "www-authenticate": challenge } }))
    const result = await new RegistryClient(http, "mcr.microsoft.com", neverAuth).checkAPI()
    expect(result).toEqual({ kind: "needs-token", challenge })
  })
  it.each([
    { registry: "docker.io", url: "https://registry-1.docker.io/v2/" },
    { registry: "ghcr.io", url: "https://ghcr.io/v2/" },
    { registry: "localhost:5000", url: "https://localhost:5000/v2/" },
  ])("calls $url for $registry", async ({ registry, url }) => {
    const { http, get } = replyingWith(new Response(null, { status: 200 }))
    await new RegistryClient(http, registry, neverAuth).checkAPI()
    expect(get).toHaveBeenCalledWith(url)
  })

  it("throws RegistryError when a 401 has no challenge", async () => {
    // A 401 with no www-authenticate header: a broken registry, on demand.
    const { http } = replyingWith(new Response(null, { status: 401 }))

    // .rejects waits for the promise to fail, then checks the error.
    // The promise must be awaited, or the test ends before it fails.
    await expect(new RegistryClient(http, "docker.io", neverAuth).checkAPI()).rejects.toThrow(
      "no www-authenticate header",
    )
  })
  // One test per status. %i in the title is replaced by the number.
  it.each([404, 500])("throws RegistryError on status %i", async (status) => {
    // { status } is short for { status: status }.
    const { http } = replyingWith(new Response(null, { status }))

    // toThrow(SomeClass) passes if the error is an instance of that class.
    await expect(new RegistryClient(http, "example.com", neverAuth).checkAPI()).rejects.toThrow(
      RegistryError,
    )
  })
})

describe("RegistryClient.fetchManifest", () => {
  it("gets a token after a 401 and tries again with it", async () => {
    // First call: 401. Second call: the manifest.
    const { http, get } = replyingInTurn(unauthorized(), manifest())
    const auth = tokenGiving("abc")

    const result = await new RegistryClient(http, "docker.io", auth).fetchManifest("library/alpine", "latest")

    expect(result.digest).toBe("sha256:abc")
    // The challenge was read and the right scope asked for.
    expect(auth.token).toHaveBeenCalledWith(
      { realm: "https://auth.docker.io/token", service: "registry.docker.io" },
      "repository:library/alpine:pull",
    )
    expect(get).toHaveBeenCalledTimes(2)
    // The 2nd call carried the token. objectContaining ignores other
    // headers (accept), so the test checks only what it's about.
    expect(get).toHaveBeenNthCalledWith(2, manifestURL, expect.objectContaining({ authorization: "Bearer abc" }))
  })
  it("open registry, no auth", async () => {
    const { http, get } = replyingWith(manifest())

    const result = await new RegistryClient(http, "docker.io", neverAuth).fetchManifest("library/alpine", "latest")
    expect(result.digest).toBe("sha256:abc")
    expect(result.bytes.length).toEqual(2)
    expect(get).toHaveBeenCalledTimes(1)
  })
  it("reuses token on the next request", async () => {
    const { http, get } = replyingInTurn(unauthorized(), manifest(), manifest())
    const auth = tokenGiving("abc")
    const client = new RegistryClient(http, "docker.io", auth)
    await client.fetchManifest("library/alpine", "latest")
    await client.fetchManifest("library/alpine", "latest")

    expect(auth.token).toHaveBeenCalledTimes(1)
    expect(get).toHaveBeenLastCalledWith(manifestURL, expect.objectContaining({ authorization: "Bearer abc" }))
  })
  it("throws when the registry refuses the token", async () => {
    const { http } = replyingInTurn(unauthorized(), unauthorized())

    await expect(
      new RegistryClient(http, "docker.io", tokenGiving("abc")).fetchManifest("library/alpine", "latest"),
    ).rejects.toThrow("token was refused")
  })
  it("works end to end with the real authenticator", async () => {
    // One fake answers all three calls: the 401, the token server, the manifest.
    const { http, get } = replyingInTurn(unauthorized(), Response.json({ token: "abc" }), manifest())
    const client = new RegistryClient(http, "docker.io", new AnonymousAuthenticator(http))

    await client.fetchManifest("library/alpine", "latest")

    expect(get).toHaveBeenCalledTimes(3)
    expect(get).toHaveBeenNthCalledWith(3, manifestURL, expect.objectContaining({ authorization: "Bearer abc" }))
  })
})

