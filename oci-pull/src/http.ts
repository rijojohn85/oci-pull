
export type RequestHeaders = Record<string, string>
export interface HttpClient {
  get(url: string, headers?: RequestHeaders): Promise<Response>
}

export class FetchHttpClient implements HttpClient {
  async get(url: string, headers: RequestHeaders={}): Promise<Response> {
    return fetch(url, {headers})
  }
}
