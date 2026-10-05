import type { HttpClient } from "./http.ts"

export interface Challenge {
  readonly realm: string
  readonly service: string
}

export class AuthError extends Error {
  constructor(problem: string) {
    super(`auth: ${problem}`)
    this.name = "AuthError"
  }
}
// Matches one key="value" pair. (?<key>...) and (?<value>...) are named
// groups: the matched text is read back as match.groups.key and .value.
// The g at the end means "find every match, not just the first".
const PARAM = /(?<key>[a-z]+)="(?<value>[^"]*)"/g

export function parseChallenge(header: string): Challenge {
  if (!header.startsWith("Bearer ")) {
    throw new AuthError(`unsupported challenge: ${header}`)
  }
  const params = new Map<string, string>()
  for (const match of header.matchAll(PARAM)) {
    // groups can be undefined in the type, so `?? {}` gives destructuring
    // something to pull from. key and value are then string | undefined.
    const { key, value } = match.groups ?? {}
    if (key !== undefined && value !== undefined) {
      params.set(key, value)
    }
  }
  const realm = params.get("realm")
  const service = params.get("service")
  if (realm === undefined || service === undefined) {
    throw new AuthError(`challenge is missing realm or service: ${header}`)
  }
  return { realm, service }
}

export interface Authenticator {
  token(challenge: Challenge, scope: string): Promise<string>
}

export class AnonymousAuthenticator implements Authenticator {
  private readonly http: HttpClient

  constructor(http: HttpClient) {
    this.http = http
  }
  async token(challenge: Challenge, scope: string): Promise<string> {
    const url = new URL(challenge.realm)
    url.searchParams.set("service", challenge.service)
    url.searchParams.set("scope", scope)
    const response = await this.http.get(url.href)
    if (response.status !== 200) {
      throw new AuthError(`${url.href} answered ${response.status}`)
    }
    const body: unknown = await response.json()
    if (
      typeof body !== "object" ||
      body === null ||
      !("token" in body) ||
      typeof body.token !== "string"
    ) {
      throw new AuthError(`${url.href} sent no token`)
    }
    return body.token
  }
}
