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
      sfx: '/boom.mp3',
      startSec: 0,
    })
    expect(args.slice(args.indexOf('/ov.png') + 1)).toEqual(expect.arrayContaining(['-i', '/boom.mp3']))
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('[clip][fx]amix=inputs=2:duration=first:normalize=0[a]')
  })

  it('holds a transition slide with its sound over silence', () => {
    const args = transitionArgs({ durSec: 1, out: '/t.mp4', png: '/t.png', sfx: '/whoosh.mp3' })
    expect(args).toEqual(expect.arrayContaining(['-loop', '1', '-t', '1', '-i', '/t.png', '-i', '/whoosh.mp3']))
    expect(args[args.indexOf('-filter_complex') + 1]).toContain('[bed][fx]amix')
  })

  it('loops the music bed under the short at its level, then evens the loudness', () => {
    const args = finishArgs({ joined: '/j.mp4', music: { file: '/bed.mp3', volume: 0.35 }, out: '/f.mp4' })
    expect(args).toEqual(expect.arrayContaining(['-stream_loop', '-1', '-i', '/bed.mp3']))
    const filter = args[args.indexOf('-filter_complex') + 1]
    expect(filter).toContain('volume=0.35')
    expect(filter).toContain('loudnorm=I=-14')
    expect(finishArgs({ joined: '/j.mp4', out: '/f.mp4' })).not.toContain('-stream_loop')
  })
})
