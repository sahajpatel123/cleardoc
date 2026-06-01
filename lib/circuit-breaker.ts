/**
 * Simple in-memory circuit breaker for external services (AI, Stripe, Redis, DB).
 *
 * Per-instance only — useful for preventing a single unhealthy dependency from
 * burning serverless duration on every request. Cross-instance coordination
 * would require a distributed store (Redis) and is overkill for this scale.
 *
 * States:
 *   CLOSED   – normal operation, requests pass through.
 *   OPEN     – failure threshold reached, requests fail fast for `resetTimeoutMs`.
 *   HALF_OPEN – after reset timeout, next request is allowed as a probe.
 */
export type CircuitState = "closed" | "open" | "half_open"

type CircuitOptions = {
  failureThreshold: number
  resetTimeoutMs: number
  halfOpenMaxCalls: number
}

class Circuit {
  private state: CircuitState = "closed"
  private failures = 0
  private successes = 0
  private lastFailureTime = 0
  private halfOpenCalls = 0
  private readonly failureThreshold: number
  private readonly resetTimeoutMs: number
  private readonly halfOpenMaxCalls: number

  constructor(opts: CircuitOptions) {
    this.failureThreshold = opts.failureThreshold
    this.resetTimeoutMs = opts.resetTimeoutMs
    this.halfOpenMaxCalls = opts.halfOpenMaxCalls
  }

  getState(): CircuitState {
    if (this.state === "open") {
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = "half_open"
        this.halfOpenCalls = 0
      }
    }
    return this.state
  }

  canExecute(): boolean {
    const s = this.getState()
    if (s === "closed") return true
    if (s === "open") return false
    // half_open
    if (this.halfOpenCalls < this.halfOpenMaxCalls) {
      this.halfOpenCalls++
      return true
    }
    return false
  }

  recordSuccess(): void {
    this.failures = 0
    if (this.state === "half_open") {
      this.successes++
      if (this.successes >= this.halfOpenMaxCalls) {
        this.state = "closed"
        this.successes = 0
        this.halfOpenCalls = 0
      }
    }
  }

  recordFailure(): void {
    this.failures++
    this.lastFailureTime = Date.now()
    if (this.state === "half_open") {
      this.state = "open"
      return
    }
    if (this.failures >= this.failureThreshold) {
      this.state = "open"
    }
  }
}

const _circuits = new Map<string, Circuit>()

export function getCircuit(name: string, opts?: Partial<CircuitOptions>): Circuit {
  let c = _circuits.get(name)
  if (!c) {
    c = new Circuit({
      failureThreshold: opts?.failureThreshold ?? 5,
      resetTimeoutMs: opts?.resetTimeoutMs ?? 30_000,
      halfOpenMaxCalls: opts?.halfOpenMaxCalls ?? 1,
    })
    _circuits.set(name, c)
  }
  return c
}

/**
 * Execute `fn` under the named circuit breaker. If the circuit is OPEN,
 * throws immediately with `CircuitOpenError`. Otherwise executes `fn` and
 * records success/failure automatically.
 */
export class CircuitOpenError extends Error {
  constructor(public readonly service: string) {
    super(`Circuit breaker OPEN for ${service}`)
    this.name = "CircuitOpenError"
  }
}

export async function withCircuit<T>(
  name: string,
  fn: () => Promise<T>,
  opts?: Partial<CircuitOptions>,
): Promise<T> {
  const circuit = getCircuit(name, opts)
  if (!circuit.canExecute()) {
    throw new CircuitOpenError(name)
  }
  try {
    const result = await fn()
    circuit.recordSuccess()
    return result
  } catch (err) {
    circuit.recordFailure()
    throw err
  }
}
