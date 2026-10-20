import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { DEFAULT_RANKING_STYLE, DEFAULT_RANKING_TITLE, DEFAULT_RANKING_TRANSITION } from '@reelmakeeasy/common/ranking/ranking-project'

import { RankingPatchError } from './ranking-patch'
import { RankingTemplateNotFoundError, RankingTemplateService } from './ranking-template.service'

const input = (over: Record<string, unknown> = {}) => ({
  labels: { examples: ['Got bitten 😳'], tone: 'two words and an emoji' },
  name: ' Aura rank ',
  notes: 'Boom on every impact.',
  perRankSec: 3.6,
  rankCount: 6,
  reveal: 'shuffle',
  sounds: {
    music: null,
    musicVolume: 0.3,
    onAction: [
      { description: 'short low boom', soundId: 'boom' },
      { description: 'bruh voice', soundId: null },
    ],
    reveal: null,
    transition: null,
  },
  source: { title: 'Ranking craziest cat moments', url: 'https://www.youtube.com/shorts/abc' },
  stickers: { examples: [{ color: '#ffffff', rotation: 8, size: 0.08, text: '💀', x: 0.7, y: 0.5 }], habit: 'one 💀' },
  style: DEFAULT_RANKING_STYLE,
  title: DEFAULT_RANKING_TITLE,
  transition: DEFAULT_RANKING_TRANSITION,
  ...over,
})

describe('RankingTemplateService', () => {
  let root: string
  let library: Set<string>
  let svc: RankingTemplateService
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'styles-'))
    library = new Set(['boom'])
    svc = new RankingTemplateService({ has: (id) => library.has(id) }, root)
  })
  afterEach(() => fs.rmSync(root, { force: true, recursive: true }))

  it('saves a style, lists it and reads it back', () => {
    const saved = svc.create(input())
    expect(saved.name).toBe('Aura rank')
    expect(saved.transition).not.toHaveProperty('sound')
    expect(svc.list().map((s) => s.id)).toEqual([saved.id])
    expect(svc.get(saved.id).sounds.onAction[0]).toEqual({ description: 'short low boom', soundId: 'boom' })
  })

  it('refuses sounds that are not in the library, and a style without a sound plan or name', () => {
    expect(() => svc.create(input({ sounds: { onAction: [{ description: 'x', soundId: 'nope' }] } }))).toThrow(/not in the library/)
    expect(() => svc.create(input({ sounds: undefined }))).toThrow(RankingPatchError)
    expect(() => svc.create(input({ name: '  ' }))).toThrow(/name/)
    expect(() => svc.create(input({ rankCount: 40 }))).toThrow(/ranks/)
    expect(() => svc.create(input({ source: { url: 'javascript:alert(1)' } }))).toThrow(/https/)
  })

  it('reads a sound deleted from the library since as one to download', () => {
    const saved = svc.create(input())
    library.delete('boom')
    expect(svc.get(saved.id).sounds.onAction[0]?.soundId).toBeNull()
  })

  it('changes whole fields and keeps the rest', () => {
    const saved = svc.create(input())
    const next = svc.update(saved.id, { perRankSec: 4.2 })
    expect(next.perRankSec).toBe(4.2)
    expect(next.name).toBe('Aura rank')
    expect(next.createdAt).toBe(saved.createdAt)
    svc.delete(saved.id)
    expect(() => svc.get(saved.id)).toThrow(RankingTemplateNotFoundError)
    expect(() => svc.get('../etc')).toThrow(RankingTemplateNotFoundError)
  })
})
