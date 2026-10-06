
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mapWithLimit, retry, sleep } from "./tasks.ts"

describe("mapWithLimit", () => {
  it("returns results in the items' order, not the finishing order", async () => {
    // The first item takes longest, so it finishes last.
    const results = await mapWithLimit([30, 20, 10], 3, async (ms) => {
      await sleep(ms)
      return `slept ${ms}`
    })

    expect(results).toEqual(["slept 30", "slept 20", "slept 10"])
  })

  it("starts nothing new after a failure", async () => {
    const started: string[] = []
    const work = async (item: string): Promise<string> => {
      started.push(item)
      if (item === "bad") {
        throw new Error(`${item} failed`)
      }
      await sleep(5)
      return item
    }

    // Two workers: one takes "slow", the other "bad", which fails at once.
    await expect(mapWithLimit(["slow", "bad", "c", "d"], 2, work)).rejects.toThrow("bad failed")
    // Give "slow" time to finish; its worker must not take "c".
    await sleep(10)
    expect(started).toEqual(["slow", "bad"])
  })
})
describe("retry", () => {
  // A fake clock: setTimeout no longer waits by itself. Time moves only
  // when the test moves it, so "wait 2 seconds" takes no time at all.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it("waits 1 second, then 2, between tries", async () => {
    const attempt = vi.fn<() => Promise<string>>()
    attempt.mockRejectedValueOnce(new Error("first"))
    attempt.mockRejectedValueOnce(new Error("second"))
    attempt.mockResolvedValueOnce("worked")

    const result = retry(attempt, 3, 1000)
    // The first try happens at once.
    expect(attempt).toHaveBeenCalledTimes(1)

    // Move the clock forward. The Async version also lets the code
    // that was waiting run, up to its next wait.
    await vi.advanceTimersByTimeAsync(999)
    expect(attempt).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(attempt).toHaveBeenCalledTimes(2)

    // The second wait is twice as long.
    await vi.advanceTimersByTimeAsync(1999)
    expect(attempt).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(await result).toBe("worked")
  })
  it("throws the last error when every try fails", async () => {
    const attempt = vi.fn<() => Promise<string>>()
    attempt.mockRejectedValueOnce(new Error("first"))
    attempt.mockRejectedValueOnce(new Error("second"))

    // Start checking for the error before moving the clock, so the
    // failure has somewhere to go the moment it happens.
    const check = expect(retry(attempt, 2, 1000)).rejects.toThrow("second")
    await vi.advanceTimersByTimeAsync(1000)
    await check
    expect(attempt).toHaveBeenCalledTimes(2)
  })
})
