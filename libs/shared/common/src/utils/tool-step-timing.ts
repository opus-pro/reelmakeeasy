/**
 * Full lifecycle of a UIP-v2 substep as projected into the subTools display.
 * `not_started` is a fold-only state (predeclared inventory); it never travels
 * on the wire -- the reporter/signal only ever carry the reported subset below.
 */
export type SubstepStatus = 'completed' | 'not_started' | 'running'

/** The subset a running tool actually reports (never `not_started`). */
export type ReportedSubstepStatus = Exclude<SubstepStatus, 'not_started'>

/**
 * Receives substep progress ('running' on entry, 'completed' on success) for the
 * UIP-v2 subTools display. Implementations must be fire-and-forget and never
 * throw (progress must never break tool execution).
 */
export type SubstepReporter = (substep: string, status: ReportedSubstepStatus) => void

/**
 * Invoke a reporter without letting it break the step it narrates. The
 * SubstepReporter contract says implementations never throw; enforcing it
 * here makes the contract load-bearing -- a misbehaving reporter must not
 * abort the substep before `fn` runs, nor turn a successful result into a
 * rejection afterwards.
 */
function safeReport(
  reporter: SubstepReporter | undefined,
  step: string,
  status: ReportedSubstepStatus,
): void {
  try {
    reporter?.(step, status)
  } catch {
    // Progress reporting is best-effort by design.
  }
}

/**
 * Runs one step of a UIP-v2 tool with substep progress reporting: reports
 * `running` before the step and `completed` after it succeeds. On throw nothing
 * further is reported -- the substep stays `running` and the tool-level failure
 * freezes the card. The substep map deliberately has no failed state.
 */
export async function runSubstep<T>(
  reporter: SubstepReporter | undefined,
  step: string,
  fn: () => Promise<T>,
): Promise<T> {
  safeReport(reporter, step, 'running')
  const result = await fn()
  safeReport(reporter, step, 'completed')
  return result
}
