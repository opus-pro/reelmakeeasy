import type { ChatModelOption } from '@shared/types/api/agent'

import { isMotionModel, motionModelChoice, motionModelGate } from './chat-models'

const model = (id: string, efforts = ['low', 'medium', 'high', 'xhigh', 'max']): ChatModelOption =>
  ({ efforts, id, label: id }) as unknown as ChatModelOption

describe('Motion Reel models', () => {
  const claude = [model('claude-sonnet-5'), model('claude-opus-5-1'), model('claude-opus-5-5')]
  const codex = [model('gpt-6-sol'), model('gpt-6-astra'), model('gpt-5.5-astra')]

  it("runs on the family's newest model at medium thinking or more", () => {
    // Unpicked, it starts at Extra high on Claude Code and medium on Codex.
    expect(motionModelChoice('claude', claude)).toEqual({
      effort: 'xhigh',
      model: 'claude-opus-5-5',
    })
    expect(motionModelChoice('codex', codex)).toEqual({ effort: 'medium', model: 'gpt-6-astra' })
    // A model without Extra high starts at medium.
    expect(
      motionModelChoice('claude', [model('claude-opus-5-5', ['low', 'medium', 'high'])]),
    ).toEqual({ effort: 'medium', model: 'claude-opus-5-5' })
    expect(
      motionModelChoice('claude', claude, { effort: 'high', model: 'claude-opus-5-5' }),
    ).toEqual({
      effort: 'high',
      model: 'claude-opus-5-5',
    })
    // A lower level, or another model, is lifted to the rule.
    expect(
      motionModelChoice('claude', claude, { effort: 'low', model: 'claude-opus-5-5' })?.effort,
    ).toBe('medium')
    expect(motionModelChoice('claude', claude, { model: 'claude-sonnet-5' })?.model).toBe(
      'claude-opus-5-5',
    )
  })

  it('says why an account without the family is refused', () => {
    expect(motionModelGate('claude', claude)).toBeNull()
    expect(motionModelGate('codex', [model('gpt-6-sol')])).toMatch(/GPT Astra/)
    expect(motionModelGate('claude', [model('claude-sonnet-5')])).toMatch(/Claude Opus/)
  })

  it('only allows the newest model of the family', () => {
    expect(isMotionModel('claude', claude, 'claude-opus-5-5')).toBe(true)
    expect(isMotionModel('claude', claude, 'claude-opus-5-1')).toBe(false)
  })
})
