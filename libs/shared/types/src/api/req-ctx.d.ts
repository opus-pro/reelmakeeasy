export type TraceInfo = {
  carrier: Record<string, number | string>
  fullTraceId: string
  samplingPriority: number
  spanId: string
  traceId: string
  traceParent: string
  traceTags: string
}

type BaseReqContext = {
  caller?: string[]
  debug: Record<string, string | undefined>
  login_id: string
  org_id: string
  pii?: { email?: string; ip: string; name?: string }
  raw_req_ctx?: string
  req: {
    device_id: string
    ip_country: string
    lang: string
    locale: string
    origin: string
    platform: 'android' | 'ios' | 'web'
    ts: string
    tz: string
    ua: string
  }
  steer_hint?: string
  tracer?: TraceInfo
  user?: { created_at: string }
  user_id: string
}

/**
 * Local Request Context
 *
 * TECH DEBT WARNING:
 *
 * 1. Dual Context System:
 *    - This extends BaseReqContext (the request identity the API middleware sets)
 *    - Both use separate AsyncLocalStorage instances, requiring manual sync in Middleware
 *    - TODO: Unify into a single context system to avoid sync overhead
 *
 * 2. Execution Stack vs Request Context:
 *    - `agent` and `tool` are execution-level fields (change during request lifecycle)
 *    - They don't belong in ReqContext semantically (should be ExecutionContext)
 *    - Kept here for convenience with runWithContext()
 *
 * 3. Overlap with JobContext:
 *    - JobContext (libs/shared/common/src/job-context) also contains userId
 *    - Both contexts serve similar purposes in Worker activities
 *    - TODO: Clarify boundary - ReqContext for Identity/Routing, JobContext for Business
 *
 * Use BaseReqContext fields directly (user_id, pii, tracer, etc.)
 * Do NOT add redundant camelCase aliases (e.g. userId)
 */
export type ReqContext = Partial<BaseReqContext> &
  Required<Pick<BaseReqContext, 'login_id' | 'org_id' | 'user_id'>> & {
    // Local execution stack context
    agent?: string
    tool?: string
  }
