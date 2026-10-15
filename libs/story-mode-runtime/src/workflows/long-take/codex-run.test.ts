import type { DebugSettings } from '@shared/types/project/debug-settings'

import { isAgentHarnessRun, isCodexRun } from './codex-run'

/** How agent mode marks its runs (`CODEX_DEBUG_SETTINGS` in the API's autonomous flow). */
const codexSettings = { llm: { chatProvider: 'codex' } } as unknown as DebugSettings

describe('isCodexRun', () => {
  it('is true only for a run whose LLM chat provider is codex', () => {
    expect(isCodexRun(codexSettings)).toBe(true)
    expect(isCodexRun(undefined)).toBe(false)
    expect(isCodexRun({} as DebugSettings)).toBe(false)
    expect(isCodexRun({ llm: {} } as DebugSettings)).toBe(false)
    expect(isCodexRun({ llm: { chatProvider: 'gemini' } } as unknown as DebugSettings)).toBe(false)
  })
})

describe('isAgentHarnessRun', () => {
  it('treats Codex and Claude runs alike', () => {
    for (const chatProvider of ['codex', 'claude']) {
      const settings = { llm: { chatProvider } } as unknown as DebugSettings
      expect(isAgentHarnessRun(settings)).toBe(true)
    }
    expect(isAgentHarnessRun(undefined)).toBe(false)
    expect(isAgentHarnessRun({ llm: { chatProvider: 'gemini' } } as unknown as DebugSettings)).toBe(
      false,
    )
  })
})
