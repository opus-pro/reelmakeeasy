import { newRankingProject } from '@reelmakeeasy/common/ranking/ranking-project'
import type { RankingProject } from '@shared/types/api/ranking'

import { applyRankingPatch, RankingPatchError } from './ranking-patch'

const NOW = '2026-10-20T00:00:00.000Z'

function withClip(): RankingProject {
  const p = newRankingProject('11111111-1111-1111-1111-111111111111', 'then')
  p.items[0] = {
    ...p.items[0]!,
    clip: { durationSec: 8, name: 'cat.mp4', trimEndSec: 6, trimStartSec: 0, url: 'store://ranking/p/clips/a.mp4' },
  }
  return p
}

describe('applyRankingPatch', () => {
  it('takes a title with coloured words and a new name', () => {
    const p = applyRankingPatch(withClip(), {
      name: '  Cat fails  ',
      title: { band: '#000000', lines: [[{ color: '#FF2A2A', text: 'Funniest' }]] },
    }, NOW)
    expect(p.name).toBe('Cat fails')
    expect(p.title.lines[0]).toEqual([{ color: '#ff2a2a', text: 'Funniest' }])
    expect(p.updatedAt).toBe(NOW)
  })

  it('refuses bad colours, too many lines and long labels', () => {
    const p = withClip()
    expect(() => applyRankingPatch(p, { title: { band: 'red', lines: [[]] } }, NOW)).toThrow(RankingPatchError)
    expect(() =>
      applyRankingPatch(p, { title: { band: '#000000', lines: [[], [], [], []] } }, NOW),
    ).toThrow(/1 to 3 lines/)
    const items = p.items.map((i) => ({ ...i, label: 'x'.repeat(61) }))
    expect(() => applyRankingPatch(p, { items }, NOW)).toThrow(/under 60/)
  })

  it('renumbers ranks by position and keeps uploaded clips, re-trimmed', () => {
    const p = withClip()
    const items = [...p.items].reverse().map((i) =>
      i.clip ? { ...i, clip: { ...i.clip, trimEndSec: 3, trimStartSec: 1 } } : i,
    )
    const next = applyRankingPatch(p, { items }, NOW)
    expect(next.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5])
    expect(next.items[4]?.clip).toMatchObject({ trimEndSec: 3, trimStartSec: 1, url: 'store://ranking/p/clips/a.mp4' })
  })

  it('accepts a clip back by its served URL, but never a file the project did not upload', () => {
    const p = withClip()
    const served = { ...p.items[0]!.clip!, url: 'http://localhost:5017/api/files/ranking/p/clips/a.mp4' }
    const items = p.items.map((i, n) => (n === 0 ? { ...i, clip: served } : i))
    expect(applyRankingPatch(p, { items }, NOW).items[0]?.clip?.url).toBe('store://ranking/p/clips/a.mp4')
    const foreign = p.items.map((i, n) =>
      n === 1 ? { ...i, clip: { ...served, url: 'store://projects/x/secret.mp4' } } : i,
    )
    expect(() => applyRankingPatch(p, { items: foreign }, NOW)).toThrow(/Upload a clip/)
  })

  it('refuses a trim outside the clip or over 20 s', () => {
    const p = withClip()
    const bad = (trimStartSec: number, trimEndSec: number) =>
      p.items.map((i, n) => (n === 0 ? { ...i, clip: { ...i.clip!, trimEndSec, trimStartSec } } : i))
    expect(() => applyRankingPatch(p, { items: bad(2, 9) }, NOW)).toThrow(/inside its/)
    expect(() => applyRankingPatch(p, { items: bad(3, 2) }, NOW)).toThrow(/inside its/)
  })

  it('keeps a shuffled or custom order that covers every rank, and remakes one that does not', () => {
    const p = withClip()
    expect(applyRankingPatch(p, { reveal: { mode: 'custom', order: [2, 5, 4, 3, 1] } }, NOW).reveal.order).toEqual([2, 5, 4, 3, 1])
    expect(applyRankingPatch(p, { reveal: { mode: 'custom', order: [1, 1, 1, 1, 1] } }, NOW).reveal.order).toEqual([5, 4, 3, 2, 1])
    // Fewer ranks: the order follows.
    const four = applyRankingPatch(p, { items: p.items.slice(0, 4) }, NOW)
    expect(four.reveal.order).toEqual([4, 3, 2, 1])
  })

  it('takes sounds and a transition, refusing sounds not in the library', () => {
    const has = (id: string) => id === 'boom'
    const p = applyRankingPatch(
      withClip(),
      {
        sounds: { music: null, musicVolume: 0.4, reveal: 'boom' },
        transition: { background: '#000000', durationSec: 1.2, enabled: true, sound: 'boom', text: 'Number {rank}', textColor: '#FFD400' },
      },
      NOW,
      has,
    )
    expect(p.sounds).toEqual({ music: null, musicVolume: 0.4, reveal: 'boom' })
    expect(p.transition).toMatchObject({ durationSec: 1.2, enabled: true, sound: 'boom', textColor: '#ffd400' })
    expect(() =>
      applyRankingPatch(withClip(), { sounds: { music: 'gone', musicVolume: 0.4, reveal: null } }, NOW, has),
    ).toThrow(/no longer in your library/)
    expect(() =>
      applyRankingPatch(
        withClip(),
        { transition: { background: '#000000', durationSec: 9, enabled: true, sound: null, text: '', textColor: '#ffffff' } },
        NOW,
        has,
      ),
    ).toThrow(/0.5 to 3 s/)
  })

  it("takes single slides' own texts, by the rank each leads into", () => {
    const base = { background: '#000000', durationSec: 1, enabled: true, sound: null, text: 'Number {rank}', textColor: '#ffffff' }
    const p = applyRankingPatch(withClip(), { transition: { ...base, texts: { '1': ' And  the winner… ', '3': '' } } }, NOW, () => true)
    expect(p.transition?.texts).toEqual({ '1': ' And the winner… ', '3': '' })
    expect(applyRankingPatch(withClip(), { transition: { ...base, texts: {} } }, NOW, () => true).transition).not.toHaveProperty('texts')
    // Fewer ranks (an item removed in the studio): the slide into the dropped rank loses its text.
    const two = applyRankingPatch(
      { ...withClip(), transition: { ...base, texts: { '1': 'One', '5': 'Five' } } },
      { items: withClip().items.slice(0, 2) },
      NOW,
      () => true,
    )
    expect(two.transition?.texts).toEqual({ '1': 'One' })
    for (const texts of [{ '0': 'x' }, { '11': 'x' }, { '01': 'x' }, { two: 'x' }, { '2': 7 }, { '2': 'x'.repeat(41) }, ['x']])
      expect(() => applyRankingPatch(withClip(), { transition: { ...base, texts } }, NOW, () => true)).toThrow()
  })

  it('takes cues inside the clip, from the library only', () => {
    const p = withClip()
    const has = (id: string) => id === 'bruh'
    const items = p.items.map((i, n) => (n === 0 ? { ...i, cues: [{ atSec: 2.3, id: 'c1', soundId: 'bruh' }] } : i))
    expect(applyRankingPatch(p, { items }, NOW, has).items[0]?.cues).toEqual([{ atSec: 2.3, id: 'c1', soundId: 'bruh' }])
    const late = p.items.map((i, n) => (n === 0 ? { ...i, cues: [{ atSec: 9, id: 'c1', soundId: 'bruh' }] } : i))
    expect(() => applyRankingPatch(p, { items: late }, NOW, has)).toThrow(/inside its clip/)
    const unknown = p.items.map((i, n) => (n === 0 ? { ...i, cues: [{ atSec: 1, id: 'c1', soundId: 'nope' }] } : i))
    expect(() => applyRankingPatch(p, { items: unknown }, NOW, has)).toThrow(/no longer in your library/)
  })

  it("takes text stickers and this project's pictures, for the whole short or a rank", () => {
    const p = withClip()
    const sticker = { color: '#ffffff', id: 's1', kind: 'text', rank: 3, rotation: 10, size: 0.06, text: ' 💀 ', x: 0.7, y: 0.5 }
    expect(applyRankingPatch(p, { stickers: [sticker] }, NOW).stickers?.[0]).toMatchObject({ rank: 3, text: '💀' })
    const own = `store://ranking/${p.id}/stickers/a.png`
    const pic = { ...sticker, imageUrl: own, kind: 'image', rank: null, text: undefined }
    expect(applyRankingPatch(p, { stickers: [pic] }, NOW).stickers?.[0]?.imageUrl).toBe(own)
    expect(() =>
      applyRankingPatch(p, { stickers: [{ ...pic, imageUrl: 'store://projects/x/secret.png' }] }, NOW),
    ).toThrow(/Upload the picture/)
    expect(() => applyRankingPatch(p, { stickers: [{ ...sticker, rank: 9 }] }, NOW)).toThrow(/rank that is gone/)
    expect(() => applyRankingPatch(p, { stickers: [{ ...sticker, x: 2 }] }, NOW)).toThrow(/out of range/)
  })

  it('takes fonts, rank marks, and a sticker’s timing, font, slant and animation', () => {
    const p = withClip()
    const style = applyRankingPatch(p, { style: { ...p.style, numberFont: 'dela', numberFormat: 'custom', numberMarks: [' 👑 ', '🔥'] } }, NOW).style
    expect(style).toMatchObject({ numberFont: 'dela', numberFormat: 'custom', numberMarks: ['👑', '🔥'] })
    expect(() => applyRankingPatch(p, { style: { ...p.style, titleFont: 'comic-sans' } }, NOW)).toThrow(/Fonts are one of/)
    expect(() => applyRankingPatch(p, { style: { ...p.style, numberFormat: 'roman' } }, NOW)).toThrow(/rank marks/)
    const base = { color: '#ffffff', id: 's1', kind: 'text', rank: 1, rotation: 0, size: 0.06, text: 'MAMA!', x: 0.6, y: 0.4 }
    const moving = { ...base, animation: { in: 'pop', loop: 'shake', out: 'fade' }, endSec: 3, font: 'dela', italic: true, startSec: 1.2 }
    expect(applyRankingPatch(p, { stickers: [moving] }, NOW).stickers?.[0]).toMatchObject({
      animation: { in: 'pop', loop: 'shake', out: 'fade' },
      endSec: 3,
      font: 'dela',
      italic: true,
      startSec: 1.2,
    })
    // "Always, still" is stored as nothing.
    const still = applyRankingPatch(p, { stickers: [{ ...base, animation: { in: 'none', loop: 'none', out: 'none' }, startSec: 0 }] }, NOW).stickers?.[0]
    expect(still).not.toHaveProperty('animation')
    expect(still).not.toHaveProperty('startSec')
    expect(() => applyRankingPatch(p, { stickers: [{ ...base, animation: { in: 'spin' } }] }, NOW)).toThrow(/entrance/)
    expect(() => applyRankingPatch(p, { stickers: [{ ...base, endSec: 1, startSec: 2 }] }, NOW)).toThrow(/end after/)
  })
})

