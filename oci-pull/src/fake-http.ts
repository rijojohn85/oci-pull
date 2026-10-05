import { type Mock, vi } from "vitest"
import type { HttpClient } from "./http.ts"

export interface FakeHttp {
  http: HttpClient
  get: Mock<HttpClient["get"]>
}

export function replyingWith(response: Response): FakeHttp {
  const get = vi.fn<HttpClient["get"]>(async () => response)
  const http: HttpClient = { get }
  return { http, get }
}

// A pretend HttpClient that gives back `responses` one per call, in order.
// `...responses` gathers every argument into one array, like *args in
// Python or ...Response in Go.
export function replyingInTurn(...responses: Response[]): FakeHttp {
  // No implementation: once the queued replies run out, get() returns
  // undefined and the code under test fails loudly.
  const get = vi.fn<HttpClient["get"]>()
  for (const response of responses) {
    // Queue this reply for the next call that hasn't been answered yet.
    get.mockResolvedValueOnce(response)
  }
  const http: HttpClient = { get }
  return { http, get }
}

