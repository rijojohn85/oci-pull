import { describe, expect, it, type Mock, vi } from "vitest"
import type { HttpClient } from "./http.ts"
import { RegistryClient, RegistryError } from "./registry.ts"

interface FakeHttp {
  http: HttpClient
  get: Mock<HttpClient["get"]>
}

function replyingWith(response: Response): FakeHttp {
  const get = vi.fn<HttpClient["get"]>(async () => response)
  const http: HttpClient = { get }
  return { http, get }
}

describe("RegistryClient.checkApi", () => {
  // The test function is async, so it can await. Vitest waits for it.
  it("reports open when the registry answers 200", async () => {
    // A real Response object, built by hand: no body, status 200.
    const { http } = replyingWith(new Response(null, { status: 200 }))

    const result = await new RegistryClient(http, "mcr.microsoft.com").checkAPI()

    expect(result).toEqual({ kind: "open" })
  })
  it("reports needs-token with the challenge when it answers 401", async () => {
    const challenge = 'Bearer realm="https://auth.docker.io/token",service="registry.docker.io"'
    const { http } = replyingWith(new Response(null, { status: 401, headers: { "www-authenticate": challenge } }))
    const result = await new RegistryClient(http, "mcr.microsoft.com").checkAPI()
    expect(result).toEqual({ kind: "needs-token", challenge })
  })
  it.each([
    { registry: "docker.io", url: "https://registry-1.docker.io/v2/" },
    { registry: "ghcr.io", url: "https://ghcr.io/v2/" },
    { registry: "localhost:5000", url: "https://localhost:5000/v2/" },
  ])("calls $url for $registry", async ({ registry, url }) => {
    const { http, get } = replyingWith(new Response(null, { status: 200 }))
    await new RegistryClient(http, registry).checkAPI()
    expect(get).toHaveBeenCalledWith(url)
  })

  it("throws RegistryError when a 401 has no challenge", async () => {
    // A 401 with no www-authenticate header: a broken registry, on demand.
    const { http } = replyingWith(new Response(null, { status: 401 }))

    // .rejects waits for the promise to fail, then checks the error.
    // The promise must be awaited, or the test ends before it fails.
    await expect(new RegistryClient(http, "docker.io").checkAPI()).rejects.toThrow(
      "no www-authenticate header",
    )
  })
  // One test per status. %i in the title is replaced by the number.
  it.each([404, 500])("throws RegistryError on status %i", async (status) => {
    // { status } is short for { status: status }.
    const { http } = replyingWith(new Response(null, { status }))

    // toThrow(SomeClass) passes if the error is an instance of that class.
    await expect(new RegistryClient(http, "example.com").checkAPI()).rejects.toThrow(
      RegistryError,
    )
  })
})
