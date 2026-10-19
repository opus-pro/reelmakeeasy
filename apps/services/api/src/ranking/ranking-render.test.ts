import { segmentArgs } from './ranking-render'
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
