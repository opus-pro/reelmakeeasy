import { finishArgs, segmentArgs, transitionArgs } from './ranking-render'
import { parseRenderBody, RankingInputError } from './ranking.service'

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]).toString('base64')

describe('parseRenderBody', () => {
  it('takes one PNG per segment, as data URLs or bare base64, and the band height', () => {
    const { bandHeight, overlays } = parseRenderBody(
      { bandHeight: 240, overlays: [`data:image/png;base64,${PNG}`, PNG] },
      2,
    )
    expect(bandHeight).toBe(240)
    expect(overlays).toHaveLength(2)
  })

  it('refuses a stale overlay count, a non-PNG and a missing band height', () => {
    expect(() => parseRenderBody({ bandHeight: 240, overlays: [PNG] }, 2)).toThrow(/out of date/)
    expect(() => parseRenderBody({ bandHeight: 240, overlays: ['aGVsbG8='] }, 1)).toThrow(RankingInputError)
    expect(() => parseRenderBody({ overlays: [PNG] }, 1)).toThrow(/band height/)
  })
})

describe('segmentArgs', () => {
  it('fills the area under the band, overlays the PNG and adds silence to a mute clip', () => {
    const args = segmentArgs({
      bandHeight: 240,
      clipFile: '/c.mp4',
      durSec: 3,
      hasAudio: false,
      out: '/o.mp4',
      overlay: '/ov.png',
      startSec: 1.5,
    })
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('scale=1080:1680:force_original_aspect_ratio=increase,crop=1080:1680')
    expect(filter).toContain('pad=1080:1920:0:240')
    expect(filter).toContain('[2:a]')
    expect(args).toEqual(expect.arrayContaining(['-ss', '1.5', 'anullsrc=r=48000:cl=stereo']))
  })
})

describe('sounds in the render', () => {
  it('mixes a reveal sound over the clip, from the clip start', () => {
    const args = segmentArgs({
      bandHeight: 240,
      clipFile: '/c.mp4',
      durSec: 3,
      hasAudio: true,
      out: '/o.mp4',
      overlay: '/ov.png',
      sfx: { endSec: 1.5, file: '/boom.mp3', startSec: 0.5, volume: 0.8 },
      startSec: 0,
    })
    // Only the trimmed part of the sound, at its level.
    expect(args.slice(args.indexOf('/ov.png') + 1)).toEqual(expect.arrayContaining(['-ss', '0.5', '-t', '1', '-i', '/boom.mp3']))
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('volume=0.80')
    expect(filter).toContain('[clip][fx]amix=inputs=2:duration=first:normalize=0[a]')
  })

  it('holds a transition slide with its sound over silence', () => {
    const args = transitionArgs({
      durSec: 1,
      out: '/t.mp4',
      png: '/t.png',
      sfx: { endSec: 0.7, file: '/whoosh.mp3', startSec: 0, volume: 1 },
    })
    expect(args).toEqual(expect.arrayContaining(['-loop', '1', '-t', '1', '-i', '/t.png', '-i', '/whoosh.mp3']))
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('[bed][fx]amix')
  })

  it("loops the bed's trimmed part under the short at its level, then evens the loudness", () => {
    const args = finishArgs({
      joined: '/j.mp4',
      music: { level: 0.5, sound: { endSec: 8, file: '/bed.mp3', startSec: 2, volume: 0.7 } },
      out: '/f.mp4',
    })
    expect(args).toEqual(expect.arrayContaining(['-i', '/bed.mp3']))
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('atrim=start=2:end=8')
    expect(filter).toContain('aloop=loop=-1')
    expect(filter).toContain('volume=0.35')
    expect(filter).toContain('loudnorm=I=-14')
    expect(finishArgs({ joined: '/j.mp4', out: '/f.mp4' }).filter((a) => a === '-i')).toHaveLength(1)
  })
})
