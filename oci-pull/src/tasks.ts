
// Helpers for running async work. Nothing in here knows about images.

// Wait `ms` milliseconds. setTimeout calls resolve when the time is up,
// and that finishes the promise.
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
// Run `work` on every item, at most `limit` at the same time. The
// results come back in the same order as `items`, whatever order the
// work finishes in. If one fails, nothing new is started and the
// error is thrown.
// <T, R> are type parameters: T is the type of an item, R the type of
// a result. The caller's arguments decide what they are.
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  // new Array(n): a list with n empty slots, filled in as work finishes.
  const results: R[] = new Array(items.length)
  // One shared queue of [position, item] pairs. Every worker takes
  // from the same one, so each item is taken exactly once.
  const queue = items.entries()
  // Set when some work has failed, so the workers stop.
  let failed = false

  // A worker does one item at a time, taking the next one from the
  // queue until the queue is empty.
  async function worker(): Promise<void> {
    for (const [i, item] of queue) {
      // Another worker failed: start nothing new.
      if (failed) {
        return
      }
      try {
        results[i] = await work(item, i)
      } catch (err) {
        failed = true
        throw err
      }
    }
  }

  // Start `limit` workers (fewer if there are fewer items), and wait
  // until all of them have run out of work.
  const workers: Promise<void>[] = []
  for (let n = 0; n < Math.min(limit, items.length); n += 1) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}
// Call `attempt` until it works, at most `attempts` times. Between
// tries, wait delayMs, then twice that, then 4 times, and so on. If
// the last try fails too, its error is thrown.
export async function retry<T>(attempt: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
  for (let n = 1; ; n += 1) {
    try {
      // `return await`, not `return`: the await makes a failure land in
      // the catch below. A plain `return` hands the promise back unchecked.
      return await attempt()
    } catch (err) {
      if (n === attempts) {
        throw err
      }
      // ** is "to the power of": delayMs × 1, × 2, × 4, ...
      await sleep(delayMs * 2 ** (n - 1))
    }
  }
}

