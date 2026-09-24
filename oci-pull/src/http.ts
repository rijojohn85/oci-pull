
export interface HttpClient {
  get(url: string): Promise<Response>
}

export class FetchHttpClient implements HttpClient {
  async get(url: string): Promise<Response> {
    return fetch(url)
  }
}
