/** libs/llm's `LlmNotSetUpError`: its `name`, and the `ApplicationFailure` type workflows see. */
export const LLM_NOT_SET_UP_TYPE = 'LlmNotSetUpError'

/**
 * The "no AI can write and plan" error in `error` or one of its causes, or null. Its message
 * is the reason to show (phase 1's words: "No AI is set up ..." or "<AI> can't write and plan
 * right now (...): open Setup"). Callers can't import libs/llm's class (workflows may not
 * import libs/llm), and wrappers hide it: `normalizeLlmError` keeps it in `cause`,
 * `ApplicationFailure.fromError` keeps its name as `type`, and the long-take record wrapper
 * throws `ApplicationFailure.nonRetryable(message, 'LlmNotSetUpError')` with no cause. So it
 * matches the name or that type along the `cause` chain. The words are not matched: phase 3's
 * generation message also starts with "No AI is set up".
 */
export function findLlmNotSetUp(error: unknown): Error | null {
  let current: unknown = error
  for (let depth = 0; depth < 8 && current instanceof Error; depth++) {
    const type = (current as { type?: unknown }).type
    if (current.name === LLM_NOT_SET_UP_TYPE || type === LLM_NOT_SET_UP_TYPE) return current
    current = current.cause
  }
  return null
}

/** Whether a failure is an LLM step with no AI set up to run it. */
export function isLlmNotSetUpError(error: unknown): boolean {
  return findLlmNotSetUp(error) !== null
}
