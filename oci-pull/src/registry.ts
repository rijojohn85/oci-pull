import { parseChallenge, type Authenticator } from "./auth.ts"
import type { HttpClient, RequestHeaders } from "./http.ts"
import { IMAGE_TYPES, INDEX_TYPES } from "./manifest.ts"
import { DEFAULT_REGISTRY } from "./reference.ts"

const DOCKER_HUB_API_HOST = "registry-1.docker.io"

// The manifest formats we can read, sent in the Accept header.
// Chapter 6 explains the four; for now, "any of these, please".
const MANIFEST_TYPES = [
  ...IMAGE_TYPES, ...INDEX_TYPES,
]

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

// A manifest as it arrived: not read or checked yet. That's Chapter 6.
export interface RawManifest {
  readonly mediaType: string // what the server says the bytes are
  readonly digest: string | null // the server's fingerprint, if it sent one
  readonly bytes: Uint8Array // the body, as raw bytes (like []byte in Go)
}
export class RegistryClient {
  private readonly http: HttpClient
  private readonly baseURL: string
  private readonly auth: Authenticator
  private token: string | undefined

  constructor(http: HttpClient, registry: string, auth: Authenticator) {
    this.http = http
    this.baseURL = `https://${apiHost(registry)}/v2/`
    this.auth = auth
  }

  async checkAPI(): Promise<ApiCheck> {
    const response = await this.http.get(this.baseURL)

    if (response.status === 200) {
      return { kind: "open" }
    }
    if (response.status === 401) {
      const challenge = challengeOf(this.baseURL, response)
      return { kind: "needs-token", challenge }
    }
    throw new RegistryError(this.baseURL, response.status, "unexpected status")
  }
  async fetchManifest(repository: string, reference: string): Promise<RawManifest> {
    const url = `${this.baseURL}${repository}/manifests/${reference}`
    const response = await this.authorizedGet(url, `repository:${repository}:pull`, {
      accept: MANIFEST_TYPES.join(", ")
    })
    if (response.status !== 200) {
      throw new RegistryError(url, response.status, "unexpected status")
    }
    return {
      mediaType: response.headers.get("content-type") ?? "",
      digest: response.headers.get("docker-content-digest"),
      bytes: new Uint8Array(await response.arrayBuffer()),
    }
  }
  private withToken(headers: RequestHeaders): RequestHeaders {
    if (this.token === undefined) {
      return headers
    }
    return { ...headers, authorization: `Bearer ${this.token}` }
  }
  private async authorizedGet(url: string, scope: string, headers: RequestHeaders): Promise<Response> {
    const first = await this.http.get(url, this.withToken(headers))
    if (first.status !== 401) {
      return first
    }
    const challenge = parseChallenge(challengeOf(url, first))
    this.token = await this.auth.token(challenge, scope)
    const second = await this.http.get(url, this.withToken(headers))
    if (second.status === 401) {
      throw new RegistryError(url, 401, "token was refused")
    }
    return second

  }
}



function challengeOf(url: string, response: Response): string {
  const challenge = response.headers.get("www-authenticate")
  if (challenge === null) {
    throw new RegistryError(url, 401, "no www-authenticate header")
  }
  return challenge
}
