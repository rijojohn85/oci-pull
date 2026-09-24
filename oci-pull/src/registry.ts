import type { HttpClient } from "./http.ts"
import { DEFAULT_REGISTRY } from "./reference.ts"

const DOCKER_HUB_API_HOST = "registry-1.docker.io"


export type ApiCheck = { kind: "open" } | { kind: "needs-token", challenge: string }


export function apiHost(registry: string): string {
  return registry === DEFAULT_REGISTRY ? DOCKER_HUB_API_HOST : registry
}

export class RegistryError extends Error {
  readonly url: string
  readonly status: number

  constructor(url: string, status: number, problem: string) {
    super(`${url} answered ${status}: ${problem}`)
    this.name = "RegistryError"
    this.url = url
    this.status = status
  }
}

export class RegistryClient {
  private readonly http: HttpClient
  private readonly baseURL: string

  constructor(http: HttpClient, registry: string) {
    this.http = http
    this.baseURL = `https://${apiHost(registry)}/v2/`
  }

  async checkAPI(): Promise<ApiCheck> {
    const response = await this.http.get(this.baseURL)

    if (response.status === 200) {
      return { kind: "open" }
    }
    if (response.status === 401) {
      const challenge = response.headers.get("www-authenticate")
      if (challenge === null) {
        throw new RegistryError(this.baseURL, 401, "no www-authenticate header")
      }
      return { kind: "needs-token", challenge }
    }
    throw new RegistryError(this.baseURL, response.status, "unexpected status")
  }
}
