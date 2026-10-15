import { v4 as uuidV4 } from 'uuid'

import { getKvStore, type KvStore } from '../kv'
import { Logger } from '../logger'
import { isPolicyRejectionCode } from '../utils/provider-error'

import type {
  CircuitBreakerCheckResult,
  CircuitBreakerConfig,
  CircuitBreakerInstance,
  CircuitBreakerOptions,
  CircuitBreakerSnapshot,
  CircuitBreakerState,
} from './types'

const ALLOWED: CircuitBreakerCheckResult = { allowed: true }
const DEFAULT_PROBE_TIMEOUT_MS = 300_000 // 5 minutes

type BreakerKeys = { probes: string; state: string; trippedAt: string }

/**
 * Resolve the breaker state and acquire a probe slot when applicable, in one
 * synchronous (therefore atomic) step:
 *   - CLOSED (no state key) -> allow
 *   - OPEN + cooldown not expired -> reject
 *   - OPEN + cooldown expired -> transition to half_open, acquire probe
 *   - HALF_OPEN -> try to acquire probe slot
 *
 * Returns:
 *   0  = closed, allow
 *   1  = probe acquired (half_open), allow
 *  -1  = open, reject
 *  -2  = half_open but no probe slot, reject
 */
function checkAndAcquireProbe(
  kv: KvStore,
  keys: BreakerKeys,
  params: { cooldownMs: number; halfOpenMaxProbes: number; now: number; probeTtlSeconds: number },
): -2 | -1 | 0 | 1 {
  let state = kv.get(keys.state)

  // If state key is missing but tripped_at still exists, a half_open lease
  // expired without being resolved. Treat as 'open' to re-enter cooldown check.
  if (!state || state === 'closed') {
    if (kv.get(keys.trippedAt) === null) {
      return 0
    }
    state = 'open'
  }

  if (state === 'open') {
    const trippedAt = Number(kv.get(keys.trippedAt) ?? '0')
    if (params.now - trippedAt < params.cooldownMs) {
      return -1
    }
    // Cooldown expired: transition to half_open + acquire first probe.
    // TTL acts as a lease: if probe is never resolved (crash, timeout),
    // state expires and next check will see 'open' again (tripped_at
    // still exists), re-evaluate cooldown, and issue a fresh probe.
    kv.set(keys.state, 'half_open', params.probeTtlSeconds)
    kv.set(keys.probes, '1', params.probeTtlSeconds)
    return 1
  }

  if (state === 'half_open') {
    return kv.incr(keys.probes) <= params.halfOpenMaxProbes ? 1 : -2
  }

  return 0
}

/**
 * Advance open -> half_open if cooldown expired, WITHOUT consuming a probe slot.
 * Used by background schedulers to drive recovery.
 *
 * Returns:
 *   0 = closed (or no state)
 *   1 = transitioned to half_open
 *   2 = already half_open
 *  -1 = still open (cooldown not expired)
 */
function promoteToHalfOpen(
  kv: KvStore,
  keys: BreakerKeys,
  params: { cooldownMs: number; now: number; probeTtlSeconds: number },
): -1 | 0 | 1 | 2 {
  let state = kv.get(keys.state)
  if (!state || state === 'closed') {
    if (kv.get(keys.trippedAt) === null) {
      return 0
    }
    state = 'open'
  }
  if (state === 'half_open') {
    return 2
  }
  if (state === 'open') {
    const trippedAt = Number(kv.get(keys.trippedAt) ?? '0')
    if (params.now - trippedAt < params.cooldownMs) {
      return -1
    }
    kv.set(keys.state, 'half_open', params.probeTtlSeconds)
    kv.del(keys.probes)
    return 1
  }
  return 0
}

/**
 * Create a circuit breaker instance.
 *
 * The breaker object itself holds no state; it lives in the process-wide KV
 * store so every caller in the process shares it. Each call resolves config via the provided
 * `configResolver`, making it easy to wire per-identifier config.
 *
 * The `check` method returns a result object instead of throwing, keeping
 * the generic breaker free of framework-specific error types (e.g. the engine's
 * ApplicationFailure). Callers translate the result into domain errors.
 *
 * All public methods accept an optional `metadata` (Record<string, string>) parameter that
 * flows through to structured logs. Callers use this
 * to attach domain context (provider, model, taskQueue, etc.).
 */
export function createCircuitBreaker(options: CircuitBreakerOptions): CircuitBreakerInstance {
  const { configResolver, keyPrefix } = options
  const log = new Logger(options.loggerNamespace ?? 'circuit-breaker')

  // -- Key helpers ---------------------------------------------------------

  const fKey = (id: string) => `${keyPrefix}:${id}:failures`
  const xKey = (id: string) => `${keyPrefix}:${id}:successes`
  const sKey = (id: string) => `${keyPrefix}:${id}:state`
  const tKey = (id: string) => `${keyPrefix}:${id}:tripped_at`
  const hKey = (id: string) => `${keyPrefix}:${id}:half_open_probes`
  const jKey = (id: string, code: string) => `${keyPrefix}:${id}:rejections:${code}`
  const cKey = (id: string) => `${keyPrefix}:${id}:rejection_codes`
  const breakerKeys = (id: string): BreakerKeys => ({
    probes: hKey(id),
    state: sKey(id),
    trippedAt: tKey(id),
  })

  function logFields(
    identifier: string,
    metadata?: Record<string, string>,
  ): Record<string, unknown> {
    return { identifier, ...metadata }
  }

  // -- Internal state helpers ----------------------------------------------

  async function tripBreaker(id: string, config: CircuitBreakerConfig): Promise<void> {
    const kv = getKvStore()
    const probeTimeoutMs = config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS
    // state key TTL: enough for cooldown + probe attempt
    const stateTtlSeconds = Math.ceil((config.cooldownMs + probeTimeoutMs) / 1000)
    // tripped_at must outlive state + probe lease so expired-lease detection works.
    // If tripped_at disappears before the probe lease expires, checkAndAcquireProbe sees
    // neither key and incorrectly returns closed.
    const trippedAtTtlSeconds = stateTtlSeconds * 2
    const now = Date.now()
    await kv.set(sKey(id), 'open', stateTtlSeconds)
    await kv.set(tKey(id), String(now), trippedAtTtlSeconds)
    await kv.del(hKey(id))
  }

  async function resetBreaker(id: string): Promise<void> {
    const kv = getKvStore()
    // Clear all state AND sliding windows so recovered breaker starts fresh.
    // Old failure counts from the previous incident should not carry over.
    const codes = await kv.sMembers(cKey(id))
    await kv.del([
      sKey(id),
      tKey(id),
      hKey(id),
      fKey(id),
      xKey(id),
      cKey(id),
      ...codes.map((code) => jKey(id, code)),
    ])
  }

  /**
   * Read the current state and, when a half-open probe is outstanding, resolve
   * it back to closed. Returns the state that was observed.
   */
  async function resolveHalfOpenProbe(
    id: string,
    logMessage: string,
    metadata?: Record<string, string>,
  ): Promise<null | string> {
    const kv = getKvStore()
    const currentState = await kv.get(sKey(id))
    if (currentState === 'half_open') {
      await resetBreaker(id)
      log.info(logFields(id, metadata), logMessage)
    }
    return currentState
  }

  /**
   * Read effective state without mutations (for snapshot / shouldTrip).
   * Unlike checkAndAcquireProbe (used by check()), this does NOT write any state.
   * It does apply cooldown math so callers see the logical state:
   * open + cooldown expired => reports as 'half_open'.
   */
  async function readEffectiveState(
    id: string,
    config: CircuitBreakerConfig,
  ): Promise<CircuitBreakerState> {
    const kv = getKvStore()
    let raw = await kv.get(sKey(id))
    if (!raw || raw === 'closed') {
      // Check if tripped_at exists (expired half_open lease)
      const trippedAt = await kv.get(tKey(id))
      if (!trippedAt) {
        return 'closed'
      }
      raw = 'open' // treat as open to re-evaluate cooldown
    }
    if (raw === 'open') {
      const rawTrippedAt = await kv.get(tKey(id))
      const trippedAt = rawTrippedAt ? Number(rawTrippedAt) : 0
      if (Date.now() - trippedAt >= config.cooldownMs) {
        return 'half_open' // cooldown expired, logically half_open
      }
      return 'open'
    }
    if (raw === 'half_open') {
      return 'half_open'
    }
    return 'closed'
  }

  async function shouldTrip(
    id: string,
    config: CircuitBreakerConfig,
    failureCount: number,
  ): Promise<{
    failureRate?: number
    shouldTrip: boolean
    successCount?: number
    totalRequests?: number
  }> {
    if (failureCount < config.failureThreshold) {
      return { shouldTrip: false }
    }

    if (config.failureRateThreshold === undefined) {
      return { shouldTrip: true }
    }

    const kv = getKvStore()

    const successCount = await kv.zCard(xKey(id))
    const totalRequests = failureCount + successCount

    if (totalRequests < (config.minimumRequests ?? 0)) {
      return {
        failureRate: failureCount / Math.max(totalRequests, 1),
        shouldTrip: false,
        successCount,
        totalRequests,
      }
    }

    const failureRate = failureCount / totalRequests
    return {
      failureRate,
      shouldTrip: failureRate >= config.failureRateThreshold,
      successCount,
      totalRequests,
    }
  }

  // -- Public API ----------------------------------------------------------

  async function check(
    identifier: string,
    metadata?: Record<string, string>,
  ): Promise<CircuitBreakerCheckResult> {
    const config = configResolver(identifier)

    if (config.forceClose) {
      return ALLOWED
    }

    if (config.forceOpen) {
      log.warn(logFields(identifier, metadata), '[circuit-breaker] Rejected: force_open')
      return { allowed: false, identifier, reason: 'force_open' }
    }

    const kv = getKvStore()

    try {
      const probeTimeoutSec = Math.ceil((config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS) / 1000)
      const result = checkAndAcquireProbe(kv, breakerKeys(identifier), {
        cooldownMs: config.cooldownMs,
        halfOpenMaxProbes: config.halfOpenMaxProbes,
        now: Date.now(),
        probeTtlSeconds: probeTimeoutSec,
      })

      if (result === 0) {
        // closed
        return ALLOWED
      }

      if (result === 1) {
        // probe acquired (may be fresh half_open transition or existing half_open)
        log.info(
          logFields(identifier, metadata),
          '[circuit-breaker] Allowing half-open probe request',
        )
        return ALLOWED
      }

      if (result === -1) {
        // open, cooldown not expired
        log.warn(logFields(identifier, metadata), '[circuit-breaker] Rejected: provider open')
        return { allowed: false, identifier, reason: 'open' }
      }

      // result === -2: half_open, no probe slot
      log.warn(
        logFields(identifier, metadata),
        '[circuit-breaker] Rejected: half_open, no probe slot',
      )
      return { allowed: false, identifier, reason: 'half_open' }
    } catch (error) {
      log.warn(
        { ...logFields(identifier, metadata), error },
        '[circuit-breaker] State error during check, allowing request (fail-open)',
      )
      return ALLOWED
    }
  }

  async function recordSuccess(
    identifier: string,
    metadata?: Record<string, string>,
  ): Promise<void> {
    const config = configResolver(identifier)
    if (config.forceClose || config.forceOpen) {
      return
    }

    const kv = getKvStore()

    try {
      if (config.failureRateThreshold !== undefined) {
        const windowSeconds = Math.ceil(config.windowMs / 1000)
        const member = `${Date.now()}:${uuidV4()}`
        await kv.addSlidingWindowValue(xKey(identifier), member, windowSeconds)
      }

      await resolveHalfOpenProbe(
        identifier,
        '[circuit-breaker] Half-open probe succeeded, half_open -> closed',
        metadata,
      )
    } catch (error) {
      log.warn(
        { ...logFields(identifier, metadata), error },
        '[circuit-breaker] State error recording success',
      )
    }
  }

  async function recordRejection(
    identifier: string,
    code: string,
    metadata?: Record<string, string>,
  ): Promise<void> {
    const config = configResolver(identifier)
    if (config.forceClose || config.forceOpen) {
      return
    }

    const kv = getKvStore()

    try {
      // Shares recordSuccess's probe-resolution semantics, atomicity included.
      const currentState = await resolveHalfOpenProbe(
        identifier,
        '[circuit-breaker] Half-open probe was rejected by the provider, half_open -> closed',
        metadata,
      )
      if (
        currentState === 'half_open' ||
        currentState === 'open' ||
        config.rejectionStreakThreshold === undefined
      ) {
        return
      }

      // After probe resolution so a policy answer still closes an outstanding half-open probe.
      if (isPolicyRejectionCode(code)) {
        return
      }

      const windowSeconds = Math.ceil(config.windowMs / 1000)
      const member = `${Date.now()}:${uuidV4()}`
      await kv.addSlidingWindowValue(jKey(identifier, code), member, windowSeconds)
      await kv.sAdd(cKey(identifier), code)
      await kv.expire(cKey(identifier), windowSeconds)
      const rejectionCount = await kv.zCard(jKey(identifier, code))
      if (rejectionCount < config.rejectionStreakThreshold) {
        return
      }

      await tripBreaker(identifier, config)
      await kv.del(jKey(identifier, code))
      log.warn(
        { ...logFields(identifier, metadata), code, rejectionCount },
        '[circuit-breaker] Rejection streak threshold reached, closed -> open',
      )
    } catch (error) {
      log.warn(
        { ...logFields(identifier, metadata), error },
        '[circuit-breaker] State error recording rejection',
      )
    }
  }

  async function recordFailure(
    identifier: string,
    metadata?: Record<string, string>,
    correlationId?: string,
  ): Promise<void> {
    const config = configResolver(identifier)
    if (config.forceClose || config.forceOpen) {
      return
    }

    const kv = getKvStore()

    try {
      const windowSeconds = Math.ceil(config.windowMs / 1000)
      const member = `${Date.now()}:${correlationId || uuidV4()}`
      await kv.addSlidingWindowValue(fKey(identifier), member, windowSeconds)

      const rawState = await kv.get(sKey(identifier))
      const currentState: CircuitBreakerState =
        rawState === 'open' || rawState === 'half_open' ? rawState : 'closed'

      // half_open: ANY failure means provider is still down. Re-trip immediately
      // without checking threshold. This prevents silent recovery via TTL expiry.
      if (currentState === 'half_open') {
        await tripBreaker(identifier, config)
        const failureCount = await kv.zCard(fKey(identifier))
        log.warn(
          { ...logFields(identifier, metadata), failureCount },
          '[circuit-breaker] Half-open probe failed, half_open -> open (cooldown reset)',
        )
        return
      }

      // closed: evaluate dual-threshold trip condition
      if (currentState !== 'open') {
        const failureCount = await kv.zCard(fKey(identifier))
        const tripResult = await shouldTrip(identifier, config, failureCount)
        if (tripResult.shouldTrip) {
          await tripBreaker(identifier, config)
          log.warn(
            {
              ...logFields(identifier, metadata),
              failureCount,
              failureRate: tripResult.failureRate,
              successCount: tripResult.successCount,
              threshold: config.failureThreshold,
              totalRequests: tripResult.totalRequests,
            },
            '[circuit-breaker] Failure threshold reached, closed -> open',
          )
        }
      }
    } catch (error) {
      log.warn(
        { ...logFields(identifier, metadata), error },
        '[circuit-breaker] State error recording failure',
      )
    }
  }

  async function getSnapshot(identifier: string): Promise<CircuitBreakerSnapshot> {
    const config = configResolver(identifier)
    if (config.forceClose) {
      return { state: 'closed', failureCount: 0, successCount: 0, trippedAtMs: null }
    }
    if (config.forceOpen) {
      return { state: 'open', failureCount: 0, successCount: 0, trippedAtMs: null }
    }

    const kv = getKvStore()

    try {
      const state = await readEffectiveState(identifier, config)
      const failureCount = await kv.zCard(fKey(identifier))
      const successCount = await kv.zCard(xKey(identifier))
      const rawTrippedAt = await kv.get(tKey(identifier))
      const trippedAtMs = rawTrippedAt ? Number(rawTrippedAt) : null
      return { state, failureCount, successCount, trippedAtMs }
    } catch {
      return { state: 'closed', failureCount: 0, successCount: 0, trippedAtMs: null }
    }
  }

  async function promoteIfReady(identifier: string): Promise<CircuitBreakerState> {
    const config = configResolver(identifier)
    if (config.forceClose) {
      return 'closed'
    }
    if (config.forceOpen) {
      return 'open'
    }

    const kv = getKvStore()

    try {
      const probeTimeoutSec = Math.ceil((config.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS) / 1000)
      const result = promoteToHalfOpen(kv, breakerKeys(identifier), {
        cooldownMs: config.cooldownMs,
        now: Date.now(),
        probeTtlSeconds: probeTimeoutSec,
      })

      if (result === 1) {
        log.info({ identifier }, '[circuit-breaker] Promoted open -> half_open (scheduler)')
        return 'half_open'
      }
      if (result === 2) {
        return 'half_open'
      }
      if (result === -1) {
        return 'open'
      }
      return 'closed'
    } catch {
      return 'closed'
    }
  }

  return { check, getSnapshot, promoteIfReady, recordFailure, recordRejection, recordSuccess }
}
