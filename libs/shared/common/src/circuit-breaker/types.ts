export type CircuitBreakerCheckResult =
  | { allowed: false; identifier: string; reason: 'force_open' | 'half_open' | 'open' }
  | { allowed: true }

export type CircuitBreakerConfig = {
  /** How long the breaker stays open before transitioning to half_open (ms) */
  cooldownMs: number
  /**
   * Failure rate threshold (0-1). When set, breaker trips only when both
   * failureThreshold AND this rate are exceeded. Requires minimumRequests
   * total calls before rate is evaluated.
   * Example: 0.5 means 50% failure rate.
   */
  failureRateThreshold?: number
  /**
   * Absolute failure count threshold. Breaker trips when failures >= this value
   * AND failureRate >= failureRateThreshold (if set). Defaults to the only trip
   * condition when failureRateThreshold is not provided.
   */
  failureThreshold: number
  /** Override: force breaker closed (bypass all checks, allow all requests) */
  forceClose?: boolean
  /** Override: force breaker open (reject all requests regardless of state) */
  forceOpen?: boolean
  /** How many probe requests are allowed in half_open state */
  halfOpenMaxProbes: number
  /**
   * Minimum total requests (successes + failures) in the sliding window before
   * failure rate is evaluated. Prevents tripping on small sample sizes.
   * Only used when failureRateThreshold is set. Defaults to 0 (no minimum).
   */
  minimumRequests?: number
  /**
   * How long a probe lease lasts before it expires (ms).
   * If a probe is acquired but never resolved (worker crash, timeout, etc.),
   * the half_open state and probe counter auto-expire after this duration,
   * allowing the next check() to acquire a fresh probe.
   * Defaults to 300_000 (5 minutes).
   */
  probeTimeoutMs?: number
  /**
   * Number of request-level rejections carrying the SAME provider code within
   * the sliding window before the breaker opens. Rejections never move the
   * failure rate (the provider is up), but that many of them inside one window
   * means requests are being refused wholesale, which is just as unservable as
   * an outage. When omitted, rejections never trip the breaker.
   */
  rejectionStreakThreshold?: number
  /** Sliding window size for counting failures (ms) */
  windowMs: number
}

export type CircuitBreakerInstance = {
  /** Check breaker state. Returns result object (never throws for breaker rejections). */
  check: (
    identifier: string,
    metadata?: Record<string, string>,
  ) => Promise<CircuitBreakerCheckResult>
  getSnapshot: (identifier: string) => Promise<CircuitBreakerSnapshot>
  /**
   * Advance open -> half_open if cooldown expired, without consuming a probe slot.
   * Used by background schedulers (e.g. admission controller) to drive recovery
   * independently of business traffic. Returns the resulting state.
   */
  promoteIfReady: (identifier: string) => Promise<CircuitBreakerState>
  recordFailure: (
    identifier: string,
    metadata?: Record<string, string>,
    correlationId?: string,
  ) => Promise<void>
  /**
   * Record a deterministic request-level rejection (content policy, invalid
   * input). In half_open this resolves the probe exactly like a success: the
   * provider answered. In closed it feeds only the per-code rejection streak.
   */
  recordRejection: (
    identifier: string,
    code: string,
    metadata?: Record<string, string>,
  ) => Promise<void>
  recordSuccess: (identifier: string, metadata?: Record<string, string>) => Promise<void>
}

export type CircuitBreakerOptions = {
  /** Resolve config for a given identifier (task queue, service name, etc.) */
  configResolver: (identifier: string) => CircuitBreakerConfig
  /** Store key prefix, e.g. 'story_mode:cb' or 'my_service:cb' */
  keyPrefix: string
  /** Logger namespace, defaults to 'circuit-breaker' */
  loggerNamespace?: string
}

export type CircuitBreakerSnapshot = {
  failureCount: number
  state: CircuitBreakerState
  successCount: number
  trippedAtMs: null | number
}

export type CircuitBreakerState = 'closed' | 'half_open' | 'open'
