import { menuSections } from './music-menu'

const library = [
  {
    description: 'Soft felt piano.',
    id: 'quiet-piano',
    mood: 'piano',
    title: 'Quiet Piano',
    variants: [
      { durationSec: 30, url: 'http://x/quiet-piano-30s.mp3' },
      { durationSec: 60, url: 'http://x/quiet-piano-60s.mp3' },
    ],
  },
  {
    description: 'Bright pop.',
    id: 'bright-steps',
    mood: 'lo-fi',
    title: 'Bright Steps',
    variants: [{ durationSec: 30, url: 'http://x/bright-steps-30s.mp3' }],
  },
]
const mine = [
  {
    aiGenerated: false,
    createdAt: '2026-10-09T00:00:00.000Z',
    durationSec: 65,
    id: 't1',
    name: 'Brand theme',
    url: 'http://x/t1.mp3',
  },
]

const labels = (sections: ReturnType<typeof menuSections>) =>
  sections.map((s) => [s.id, s.items.map((i) => ('label' in i ? i.label : i.kind))])

describe('menuSections', () => {
  it('lists make, the library in mood order, my music with upload, and no music', () => {
    expect(labels(menuSections({ current: { choice: 'auto' }, library, mine }))).toEqual([
      ['make', ['Pick for me', 'Upbeat', 'Calm', 'describe']],
      ['library', ['Bright Steps', 'Quiet Piano']],
      ['mine', ['Brand theme', 'upload']],
      ['off', ['No music']],
    ])
  })

  it('describes tracks: mood and blurb for the library, length for mine, the shortest file to preview', () => {
    const sections = menuSections({ current: { choice: 'auto' }, library, mine })
    const piano = sections[1].items[1]
    expect(piano).toMatchObject({
      description: 'piano · Soft felt piano.',
      previewUrl: 'http://x/quiet-piano-30s.mp3',
      request: { choice: 'auto', track: { id: 'quiet-piano', source: 'library' } },
    })
    expect(sections[2].items[0]).toMatchObject({
      deletable: true,
      description: '1:05',
      previewUrl: 'http://x/t1.mp3',
    })
  })

  it('marks the current pick: a track, a mood, a wish, or off', () => {
    const selected = (current: Parameters<typeof menuSections>[0]['current']) =>
      menuSections({ current, library, mine })
        .flatMap((s) => s.items)
        .filter((i) => 'selected' in i && i.selected)
        .map((i) => ('label' in i ? i.label : i.kind))
    expect(selected({ choice: 'auto' })).toEqual(['Pick for me'])
    expect(selected({ choice: 'calm' })).toEqual(['Calm'])
    expect(selected({ choice: 'auto', note: 'lo-fi' })).toEqual(['describe'])
    expect(selected({ choice: 'auto', track: { id: 't1', source: 'upload' } })).toEqual([
      'Brand theme',
    ])
    expect(selected({ choice: 'off' })).toEqual(['No music'])
  })

  it('keeps My music with only the upload entry for a user without tracks, and hides an empty library', () => {
    expect(labels(menuSections({ current: { choice: 'auto' }, library: [], mine: [] }))).toEqual([
      ['make', ['Pick for me', 'Upbeat', 'Calm', 'describe']],
      ['mine', ['upload']],
      ['off', ['No music']],
    ])
  })

  it('marks AI-generated tracks in My music and gives every track its length', () => {
    const withAi = [
      ...mine,
      {
        aiGenerated: true,
        createdAt: '2026-10-09T01:00:00.000Z',
        durationSec: 24.4,
        id: 't2',
        name: 'Warm Keys',
        url: 'http://x/t2.mp3',
      },
    ]
    const items = menuSections({ current: { choice: 'auto' }, library, mine: withAi })[2].items
    expect(items[0]).toMatchObject({ description: '1:05', label: 'Brand theme' })
    expect(items[1]).toMatchObject({ description: 'AI generated · 0:24', label: 'Warm Keys' })
  })
})
