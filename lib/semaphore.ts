/** Lightweight async semaphore to cap concurrent connections.
 *  Prevents stampede when many serverless instances are warm — each instance
 *  caps its own concurrency; cross-instance coordination is via rate limits.
 */
export class Semaphore {
  private permits: number
  private queue: Array<{ resolve: () => void }> = []

  constructor(permits: number) {
    this.permits = permits
  }

  async acquire(signal?: AbortSignal, timeoutMs = 10_000): Promise<void> {
    if (this.permits > 0) {
      this.permits--
      return
    }
    return new Promise((resolve, reject) => {
      const entry = { resolve: () => {} };

      const onAbort = () => {
        clearTimeout(timer)
        const idx = this.queue.indexOf(entry)
        if (idx !== -1) {
          this.queue.splice(idx, 1)
        }
        reject(new Error("Request aborted while waiting for AI slot"))
      }

      if (signal?.aborted) {
        reject(new Error("Request aborted while waiting for AI slot"))
        return
      }
      signal?.addEventListener("abort", onAbort, { once: true })

      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort)
        const idx = this.queue.indexOf(entry)
        if (idx !== -1) {
          this.queue.splice(idx, 1)
        }
        reject(new Error(`AI semaphore acquisition timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      entry.resolve = () => {
        clearTimeout(timer)
        signal?.removeEventListener("abort", onAbort)
        resolve()
      }

      this.queue.push(entry)
    })
  }

  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift()
      next?.resolve()
    } else {
      this.permits++
    }
  }
}
