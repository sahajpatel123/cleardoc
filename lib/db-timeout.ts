/**
 * Per-query timeout wrapper for Prisma calls. Prisma itself has no built-in
 * query-level timeout, so we race the query against a Promise timeout.
 *
 * Use this for high-latency, user-facing queries (e.g., `getAnalysisChainForContext`,
 * `saveFreeAnalysisWithQuota`) to prevent a single slow query from holding a
 * serverless slot until `maxDuration`.
 */
export class DbTimeoutError extends Error {
  constructor(public readonly label: string, public readonly ms: number) {
    super(`${label} timed out after ${ms}ms`)
    this.name = "DbTimeoutError"
  }
}

export async function withDbTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new DbTimeoutError(label, ms)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    // Clear the timer if the query succeeded before timeout — prevents
    // dangling 15s timer per DB query on high-RPS routes.
    if (timeoutId !== undefined) clearTimeout(timeoutId)
  }
}
