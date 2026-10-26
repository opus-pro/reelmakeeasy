import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { ChatModelService } from './chat-model.service'

const models = [
  { efforts: ['low', 'medium'], id: 'gpt-6-astra', label: 'GPT-6-Astra' },
  { efforts: ['low', 'medium'], id: 'gpt-6.1-sol', label: 'GPT-6.1-Sol' },
]

describe('ChatModelService', () => {
  let root: string
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-models-'))
  })
  afterEach(() => fs.rmSync(root, { force: true, recursive: true }))

  it('asks a harness once and keeps the answer until it is stale or refreshed', async () => {
    const probe = jest.fn().mockResolvedValue({ models, plan: 'team' })
    const svc = new ChatModelService({ probe, root })
    await Promise.all([svc.catalog('codex'), svc.catalog('codex')])
    await svc.catalog('codex')
    expect(probe).toHaveBeenCalledTimes(1)
    await svc.catalog('codex', { refresh: true })
    expect(probe).toHaveBeenCalledTimes(2)
  })

  it("never makes a turn wait: before the list is in, it's the saved pick or the harness default", async () => {
    let answer: (v: unknown) => void = (_v) => undefined
    const probe = jest.fn(() => new Promise((resolve) => (answer = resolve)))
    const svc = new ChatModelService({ probe: probe as never, root })
    expect(svc.choiceFor('codex')).toBeNull()
    expect(svc.choiceFor('codex', { model: 'gpt-6-sol' })).toEqual({ model: 'gpt-6-sol' })
    answer({ models, plan: 'team' })
    await svc.catalog('codex')
    expect(svc.choiceFor('codex')).toEqual({ effort: 'medium', model: 'gpt-6-astra' })
    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('refuses Claude Animation on Codex, whatever its models', async () => {
    const probe = jest.fn().mockResolvedValue({ models, plan: 'pro' })
    const svc = new ChatModelService({ probe, root })
    await expect(svc.animationGate('codex')).resolves.toBe(
      'Claude Animation runs only on Claude Code.',
    )
  })

  it('gates Claude Animation on Claude Code like a Motion Reel: Opus or nothing', async () => {
    const sonnet = [{ efforts: ['low', 'medium'], id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' }]
    const opus = [{ efforts: ['low', 'medium', 'high'], id: 'claude-opus-5-5', label: 'Opus 5.5' }]
    const probe = jest.fn().mockResolvedValueOnce({ models: sonnet })
    const svc = new ChatModelService({ probe, root })
    await expect(svc.animationGate('claude')).resolves.toBe(
      "Claude Animation needs Claude Opus, and this Claude Code account doesn't offer it.",
    )
    probe.mockResolvedValueOnce({ models: [...sonnet, ...opus] })
    await svc.catalog('claude', { refresh: true })
    await expect(svc.animationGate('claude')).resolves.toBeNull()
  })

  it('saves and clears a default per harness, kept on disk', async () => {
    const probe = jest.fn().mockResolvedValue({ models, plan: 'plus' })
    const svc = new ChatModelService({ probe, root })
    svc.setDefault('codex', { effort: 'low', model: 'gpt-6-astra' })
    expect(new ChatModelService({ probe, root }).saved('codex')).toEqual({
      effort: 'low',
      model: 'gpt-6-astra',
    })
    expect(await svc.state('codex')).toMatchObject({
      current: { effort: 'low', model: 'gpt-6-astra' },
      recommended: { effort: 'medium', model: 'gpt-6.1-sol' },
      source: 'default',
    })
    svc.setDefault('codex', null)
    expect(svc.saved('codex')).toBeUndefined()
  })

  it('a harness that fails or is too slow has no list, and is asked again next time', async () => {
    const probe = jest.fn().mockRejectedValueOnce(new Error('not signed in'))
    probe.mockResolvedValueOnce({ models })
    const svc = new ChatModelService({ probe, root, ttlMs: 0 })
    expect(await svc.catalog('claude')).toBeNull()
    expect(await svc.catalog('claude')).toEqual({ models })
  })

  it('accepts only a model and thinking level the harness offers (anything while unknown)', async () => {
    const svc = new ChatModelService({ probe: jest.fn().mockResolvedValue({ models }), root })
    expect(await svc.offers('codex', { effort: 'medium', model: 'gpt-6-astra' })).toBe(true)
    expect(await svc.offers('codex', { effort: 'ultra', model: 'gpt-6-astra' })).toBe(false)
    expect(await svc.offers('codex', { model: 'gpt-4' })).toBe(false)
    const unknown = new ChatModelService({
      probe: jest.fn().mockRejectedValue(new Error('x')),
      root,
    })
    expect(await unknown.offers('codex', { model: 'anything' })).toBe(true)
  })
})
