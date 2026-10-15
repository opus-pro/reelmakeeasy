/** The AI that writes and plans, as the API names it (`LlmProvider` in @shared/types/api/setup). */
export type LlmProviderName = 'claude' | 'codex' | 'endpoint' | 'gemini'

/** What an LLM call fails with when no AI is set up for writing and planning. */
export const LLM_NOT_SET_UP_MESSAGE = 'No AI is set up for writing and planning: open Setup'

/**
 * No AI can take an LLM call: none is set up, or the one chosen in Setup isn't ready. A plain
 * (non-retryable) error, so `completionWithMeta` fails on the first attempt with its message.
 * The long-take generation-record wrapper turns it into a non-retryable activity failure (Task 1.10).
 */
export class LlmNotSetUpError extends Error {
  override readonly name = 'LlmNotSetUpError'

  constructor(message = LLM_NOT_SET_UP_MESSAGE) {
    super(message)
  }
}

/** Where `currentLlmProvider()` reads from: nothing until the API registers its Setup choice. */
let providerSource: () => LlmProviderName | null = () => null

/**
 * Registers where the app-wide AI is read from: the API passes a function (read on every call,
 * so a change in Setup applies at once), a fixed value, or `null` to clear it.
 */
export function setCurrentLlmProvider(
  source: (() => LlmProviderName | null) | LlmProviderName | null,
): void {
  providerSource = typeof source === 'function' ? source : () => source
}

/** The AI chosen in Setup and ready, or null (none is ready, or no API registered one). */
export function currentLlmProvider(): LlmProviderName | null {
  return providerSource()
}

/** Whether the app-wide AI can take audio: Codex and Claude Code can't. */
export function llmCanHearAudio(): boolean {
  const provider = currentLlmProvider()
  return provider !== 'claude' && provider !== 'codex'
}

/**
 * Where an LLM call that sends audio goes. `default` (the usual route) when the app-wide AI can
 * hear audio: Gemini, or your own endpoint, which is kept even when GEMINI_API_KEY is set.
 * On Codex or Claude Code: `gemini` when GEMINI_API_KEY is set (pin the call with
 * `JobContext.run({ llmProvider: 'gemini' }, fn)`), else `skip`.
 */
export function audioLlmRoute(env: NodeJS.ProcessEnv = process.env): 'default' | 'gemini' | 'skip' {
  if (llmCanHearAudio()) return 'default'
  return env['GEMINI_API_KEY']?.trim() ? 'gemini' : 'skip'
}
