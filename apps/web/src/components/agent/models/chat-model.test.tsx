import type { ChatModelState } from '@shared/types/api/agent'

import { choiceLabel, effortLabel, sameChoice, switchTo } from './chat-model'
import { modelMenuItems } from './ChatModelBar'

const models = [
  { efforts: ['low', 'medium', 'high', 'xhigh'], id: 'gpt-6-astra', label: 'GPT-6-Astra' },
  { defaultEffort: 'low', efforts: ['low', 'high'], id: 'gpt-6-luna', label: 'GPT-6-Luna' },
  { efforts: [], id: 'claude-haiku-4-5', label: 'Haiku 4.5' },
]

const state = (patch: Partial<ChatModelState> = {}): ChatModelState => ({
  current: { effort: 'medium', model: 'gpt-6-astra' },
  default: null,
  harness: 'codex',
  models,
  recommended: { effort: 'medium', model: 'gpt-6-astra' },
  source: 'recommended',
  ...patch,
})

describe('chat model helpers', () => {
  it('names a choice as people say it', () => {
    expect(effortLabel('xhigh')).toBe('Extra high')
    expect(effortLabel('turbo')).toBe('Turbo')
    expect(choiceLabel({ effort: 'medium', model: 'gpt-6-astra' }, models)).toBe(
      'GPT-6-Astra · Medium',
    )
    expect(choiceLabel({ model: 'claude-x' }, models)).toBe('claude-x')
    expect(choiceLabel(null, models)).toBe('Default model')
  })

  it("keeps the thinking level when the new model takes it, else medium, else the model's own", () => {
    const high = { effort: 'high', model: 'gpt-6-astra' }
    expect(switchTo(models[1] as never, high)).toEqual({ effort: 'high', model: 'gpt-6-luna' })
    expect(switchTo(models[0] as never, { effort: 'ultra', model: 'x' })).toEqual({
      effort: 'medium',
      model: 'gpt-6-astra',
    })
    expect(switchTo(models[1] as never, null)).toEqual({ effort: 'low', model: 'gpt-6-luna' })
    expect(switchTo(models[2] as never, high)).toEqual({ model: 'claude-haiku-4-5' })
    expect(sameChoice({ model: 'a' }, { effort: undefined, model: 'a' })).toBe(true)
  })

  it('lists each model with its thinking levels, then the default actions', async () => {
    const pick = jest.fn()
    const setDefault = jest.fn()
    const model = { pick, refresh: jest.fn(), setDefault, state: state() } as never
    const rows = modelMenuItems(model, 'Codex')
    expect(rows.map((r) => r.key)).toEqual([
      'gpt-6-astra',
      'gpt-6-luna',
      'claude-haiku-4-5',
      'sep',
      'set-default',
      'refresh',
    ])
    expect(rows[4]?.label).toBe('Set as default for Codex')
    expect(rows[0]?.checked).toBe(true)
    const levels = rows[0]?.children ?? []
    expect(levels.map((r) => [r.label, r.checked])).toEqual([
      ['Low', false],
      ['Medium', true],
      ['High', false],
      ['Extra high', false],
    ])
    levels[2]?.onClick?.({} as never)
    expect(pick).toHaveBeenCalledWith({ effort: 'high', model: 'gpt-6-astra' })
    rows[2]?.onClick?.({} as never)
    expect(pick).toHaveBeenLastCalledWith({ model: 'claude-haiku-4-5' })
    rows[4]?.onClick?.({} as never)
    expect(setDefault).toHaveBeenCalledWith({ effort: 'medium', model: 'gpt-6-astra' })
  })

  it('offers to clear a saved default, and says when the current one is it', () => {
    const saved = { effort: 'high', model: 'gpt-6-luna' }
    const model = {
      pick: jest.fn(),
      refresh: jest.fn(),
      setDefault: jest.fn(),
      state: state({ current: saved, default: saved, source: 'default' }),
    } as never
    const rows = modelMenuItems(model, 'Codex')
    const labels = rows.map((r) => r.label)
    expect(labels).toContain('Default for Codex')
    expect(rows.find((r) => r.label === 'Default for Codex')?.disabled).toBe(true)
    const clear = rows.find((r) => r.key === 'clear-default')
    expect(clear?.label).toBe('Clear default (use GPT-6-Astra · Medium)')
    clear?.onClick?.({} as never)
    expect((model as { setDefault: jest.Mock }).setDefault).toHaveBeenCalledWith(null)
  })
})
