import type { DebugSettings } from '@shared/types/project/debug-settings'

/**
 * Agent mode marks a run whose LLM calls go to the user's Codex with
 * `debugSettings.llm.chatProvider = 'codex'` (a record of intent: the API routes the calls).
 * `LLMModelSettings` is typed as a model-switch map, so the field is read loosely.
 */
export function isCodexRun(debugSettings: DebugSettings | undefined): boolean {
  const llm = debugSettings?.llm as undefined | { chatProvider?: unknown }
  return llm?.chatProvider === 'codex'
}

/** A run whose LLM calls go to an agent harness: the user's Codex or Claude Code
 *  (`chatProvider` 'codex' or 'claude'). */
export function isAgentHarnessRun(debugSettings: DebugSettings | undefined): boolean {
  const llm = debugSettings?.llm as undefined | { chatProvider?: unknown }
  return llm?.chatProvider === 'codex' || llm?.chatProvider === 'claude'
}
