import type { ChatModelOption } from '@shared/types/api/agent'

import { claudeModels } from './chat-model.service'
import {
  chatModelState,
  modelVersion,
  newestOf,
  parseChoice,
  recommendedModel,
  usableChoice,
} from './chat-models'

const efforts = ['low', 'medium', 'high', 'xhigh', 'max']
const m = (id: string, more: Partial<ChatModelOption> = {}): ChatModelOption => ({
  efforts,
  id,
  label: id,
  ...more,
})

/** What Codex listed for a team account on 2026-10-15. */
const CODEX = [
  m('gpt-6.1-sol'),
  m('gpt-6-astra', { defaultEffort: 'low' }),
  m('gpt-6-sol'),
  m('gpt-6-luna'),
  m('gpt-5.6-sol'),
]
/** Claude Code's models on a Max plan, after folding its aliases. */
const CLAUDE = [
  m('claude-opus-5-5'),
  m('claude-fable-5-1'),
  m('claude-sonnet-5-5'),
  m('claude-opus-5'),
  m('claude-opus-4-8'),
]

describe('chat models', () => {
  it('reads versions from Codex and Claude ids, and finds the newest of a family', () => {
    expect(modelVersion('gpt-6.1-sol', 'sol')).toEqual([6, 1])
    expect(modelVersion('claude-opus-5-5', 'opus')).toEqual([5, 5])
    expect(modelVersion('claude-opus-5', 'opus')).toEqual([5])
    expect(modelVersion('gpt-6-astra', 'sol')).toBeNull()
    expect(newestOf(CODEX, 'sol')?.id).toBe('gpt-6.1-sol')
    expect(newestOf(CLAUDE, 'opus')?.id).toBe('claude-opus-5-5')
    expect(newestOf([m('claude-opus-4-8'), m('claude-opus-5')], 'opus')?.id).toBe('claude-opus-5')
  })

  it('recommends the newest Opus for Claude Code', () => {
    expect(recommendedModel('claude', { models: CLAUDE, plan: 'Claude Max' })).toEqual({
      model: 'claude-opus-5-5',
    })
    // No Opus at all: the first model it offers.
    expect(recommendedModel('claude', { models: [m('claude-sonnet-5-5')] })).toEqual({
      model: 'claude-sonnet-5-5',
    })
  })

  it('recommends Astra at medium for Codex, and the newest Sol on a free, Go or Plus plan', () => {
    expect(recommendedModel('codex', { models: CODEX, plan: 'team' })).toEqual({
      effort: 'medium',
      model: 'gpt-6-astra',
    })
    expect(recommendedModel('codex', { models: CODEX, plan: 'pro' })?.model).toBe('gpt-6-astra')
    for (const plan of ['plus', 'go', 'free'])
      expect(recommendedModel('codex', { models: CODEX, plan })).toEqual({
        effort: 'medium',
        model: 'gpt-6.1-sol',
      })
    // No Astra on offer: the newest Sol.
    expect(
      recommendedModel('codex', { models: CODEX.filter((x) => x.id !== 'gpt-6-astra') }),
    ).toEqual({ effort: 'medium', model: 'gpt-6.1-sol' })
    expect(recommendedModel('codex', { models: [] })).toBeNull()
  })

  it('uses the chat pick, else the saved default, else the recommended one', () => {
    const catalog = { models: CODEX, plan: 'plus' }
    expect(chatModelState({ catalog, harness: 'codex' })).toMatchObject({
      current: { effort: 'medium', model: 'gpt-6.1-sol' },
      plan: 'plus',
      source: 'recommended',
    })
    expect(
      chatModelState({ catalog, harness: 'codex', saved: { effort: 'high', model: 'gpt-6-sol' } }),
    ).toMatchObject({ current: { effort: 'high', model: 'gpt-6-sol' }, source: 'default' })
    expect(
      chatModelState({
        catalog,
        chat: { model: 'gpt-6-luna' },
        harness: 'codex',
        saved: { model: 'gpt-6-sol' },
      }),
    ).toMatchObject({ current: { model: 'gpt-6-luna' }, source: 'chat' })
    expect(chatModelState({ catalog: null, harness: 'claude' })).toMatchObject({
      current: null,
      source: 'unknown',
    })
  })

  it("drops a pick the account no longer has, and a thinking level the model doesn't take", () => {
    expect(usableChoice({ model: 'claude-fable-5-1' }, [m('claude-opus-5-5')])).toBeNull()
    expect(usableChoice({ effort: 'ultra', model: 'a' }, [m('a')])).toEqual({ model: 'a' })
    expect(usableChoice({ effort: 'high', model: 'a' }, [])).toEqual({ effort: 'high', model: 'a' })
    expect(
      chatModelState({
        catalog: { models: CLAUDE.filter((x) => x.id !== 'claude-fable-5-1') },
        harness: 'claude',
        saved: { model: 'claude-fable-5-1' },
      }),
    ).toMatchObject({ current: { model: 'claude-opus-5-5' }, source: 'recommended' })
  })

  it("folds Claude Code's aliases into the model they stand for", () => {
    expect(
      claudeModels([
        {
          displayName: 'Default (recommended)',
          resolvedModel: 'claude-opus-5-5',
          value: 'default',
        },
        {
          displayName: 'Opus 5.5',
          resolvedModel: 'claude-opus-5-5',
          supportedEffortLevels: efforts,
          value: 'opus',
        },
        { displayName: 'Opus 5.5', value: 'claude-opus-5-5' },
        { displayName: 'Haiku 4.5', value: 'claude-haiku-4-5-20251001' },
      ]),
    ).toEqual([
      { efforts, id: 'claude-opus-5-5', label: 'Opus 5.5' },
      { efforts: [], id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
    ])
  })

  it('reads a choice from a request body', () => {
    expect(parseChoice({ effort: ' high ', model: ' gpt-6-sol ' })).toEqual({
      effort: 'high',
      model: 'gpt-6-sol',
    })
    expect(parseChoice({ model: '' })).toBeNull()
    expect(parseChoice(null)).toBeNull()
  })
})
