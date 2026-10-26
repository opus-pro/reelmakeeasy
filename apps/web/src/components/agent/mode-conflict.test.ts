import { modeConflictNotice } from './mode-conflict'

describe('modeConflictNotice', () => {
  it("passes on why a code-video tool can't run here", () => {
    for (const reason of [
      "Motion Reel needs GPT Astra, and this Codex account doesn't offer it.",
      "Claude Animation needs Claude Opus, and this Claude Code account doesn't offer it.",
      'Claude Animation runs only on Claude Code.',
    ])
      expect(modeConflictNotice(reason, 'claude')).toBe(reason)
  })

  it('says the agent is not ready, by name', () => {
    expect(modeConflictNotice('Claude Code is not ready (not-logged-in)', 'claude')).toBe(
      "Claude Code isn't ready. Check it is installed and signed in, then try again.",
    )
  })

  it('falls back to a mode already being chosen', () => {
    expect(modeConflictNotice('Agent session x already has a mode', undefined)).toBe(
      'A mode was already chosen.',
    )
  })
})
