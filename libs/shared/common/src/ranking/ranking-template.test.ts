import type { RankingTemplate } from '@shared/types/api/ranking'

import {
  DEFAULT_RANKING_STYLE,
  DEFAULT_RANKING_TRANSITION,
  newRankingProject,
} from './ranking-project'
import { applyRankingTemplate, missingTemplateSounds, templateSoundIds } from './ranking-template'

const TEMPLATE: RankingTemplate = {
  createdAt: 'now',
  id: 't1',
  labels: { examples: ['Got bitten 😳'], tone: 'deadpan, 2-3 words and an emoji' },
  name: 'Aura rank',
  notes: '',
  perRankSec: 3.5,
  rankCount: 6,
  reveal: 'shuffle',
  sounds: {
    music: null,
    musicVolume: 0.2,
    onAction: [
      { description: 'short low boom', soundId: 'boom' },
      { description: 'bruh voice', soundId: null },
    ],
    reveal: { description: 'bright ding', soundId: 'ding' },
    transition: null,
  },
  source: { url: 'https://www.youtube.com/shorts/abc' },
  stickers: { examples: [], habit: 'one 💀 on the biggest fail' },
  style: { ...DEFAULT_RANKING_STYLE, labelColor: '#ffd400' },
  title: {
    band: '#111111',
    lines: [
      [
        { color: '#ffffff', text: 'Ranking' },
        { color: '#ff2a2a', text: 'Craziest' },
      ],
      [{ color: '#22e5ff', text: 'Cat Moments' }],
    ],
  },
  transition: { ...DEFAULT_RANKING_TRANSITION, enabled: false },
  updatedAt: 'now',
}

describe('ranking templates', () => {
  it('lists the sounds it plans and the ones still to download', () => {
    expect(templateSoundIds(TEMPLATE)).toEqual(['ding', 'boom'])
    expect(missingTemplateSounds(TEMPLATE).map((s) => s.description)).toEqual(['bruh voice'])
  })

  it('gives a fresh ranking its title, rank count, look and sounds', () => {
    const project = newRankingProject('p', 'now')
    const patch = applyRankingTemplate(project, TEMPLATE)
    expect(patch.title).toEqual(TEMPLATE.title)
    expect(patch.items).toHaveLength(6)
    expect(patch.reveal?.order.at(-1)).toBe(1)
    expect(patch.sounds).toEqual({ music: null, musicVolume: 0.2, reveal: 'ding' })
    expect(patch.style?.labelColor).toBe('#ffd400')
    expect(patch.transition?.sound).toBeNull()
  })

  it("keeps a ranking's own slide texts: they are its words, not the style's look", () => {
    const project = {
      ...newRankingProject('p', 'now'),
      transition: { ...DEFAULT_RANKING_TRANSITION, texts: { '1': 'And the winner…' } },
    }
    expect(applyRankingTemplate(project, TEMPLATE).transition?.texts).toEqual({
      '1': 'And the winner…',
    })
    // A style that gives a ranking without clips fewer ranks drops the texts of the ranks it drops.
    const ten = {
      ...newRankingProject('t', 'now'),
      items: Array.from({ length: 10 }, (_, i) => ({
        clip: null,
        id: `r${i}`,
        label: '',
        rank: i + 1,
      })),
      transition: { ...DEFAULT_RANKING_TRANSITION, texts: { '3': 'x', '8': 'y' } },
    }
    expect(applyRankingTemplate(ten, TEMPLATE).transition?.texts).toEqual({ '3': 'x' })
    expect(
      applyRankingTemplate(newRankingProject('q', 'now'), TEMPLATE).transition,
    ).not.toHaveProperty('texts')
  })

  it("keeps a ranking's own title words and clips, taking only the colours", () => {
    const project = newRankingProject('p', 'now')
    project.title = {
      band: '#000000',
      lines: [
        [
          { color: '#ffffff', text: 'Ranking' },
          { color: '#ffffff', text: 'Funniest' },
          { color: '#ffffff', text: 'Dog' },
        ],
      ],
    }
    project.items[0] = {
      ...project.items[0]!,
      clip: { durationSec: 5, name: 'a.mp4', trimEndSec: 4, trimStartSec: 0, url: 'store://x' },
    }
    const patch = applyRankingTemplate(project, TEMPLATE)
    expect(patch.items).toBeUndefined()
    expect(patch.title).toEqual({
      band: '#111111',
      lines: [
        [
          { color: '#ffffff', text: 'Ranking' },
          { color: '#ff2a2a', text: 'Funniest' },
          { color: '#ff2a2a', text: 'Dog' },
        ],
      ],
    })
  })
})
