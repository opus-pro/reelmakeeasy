import { generateBed } from './generate-bed'

const generateAudio = jest.fn(async () => ({ audioBase64: Buffer.from('mp3').toString('base64') }))
const capabilitiesFor = jest.fn(() => ({ maxDurationSec: 300 }))

jest.mock('@reelmakeeasy/llm', () => ({ LLM: { generateAudio: (o: unknown) => generateAudio(o) } }))
jest.mock('@reelmakeeasy/llm/registry', () => ({
  capabilitiesFor: (kind: string, key: string) => capabilitiesFor(kind, key),
  resolveRole: () => ({ key: 'eleven-music' }),
}))
jest.mock('./bgm-director', () => ({
  directBgm: async () => ({
    prompt: 'warm piano. Instrumental.',
    tags: 'solo piano, warm, calm, instrumental',
    trackName: 'Warm Keys',
  }),
  nameBgmTrack: async () => 'Named',
}))
jest.mock('./bgm-audio', () => ({
  matchDurationLoopTrimFade: (p: string, sec: number) => fitted(p, sec),
}))
jest.mock('../common', () => ({
  formatLogFields: () => '',
  getVideoDurationSeconds: async () => 24,
  logger: { info: jest.fn(), warn: jest.fn() },
}))
const copied = jest.fn(async (_from: string, _to: string) => undefined)
const fitted = jest.fn(async (_p: string, _sec: number) => undefined)
jest.mock('node:fs/promises', () => ({
  copyFile: (from: string, to: string) => copied(from, to),
  writeFile: async () => undefined,
}))

const fields = { durationSec: 24, hasVoiceover: true } as never

describe('generateBed', () => {
  it('asks the music model for the video length plus two seconds, capped by the model', async () => {
    await generateBed(fields, 23.4, '/tmp/work')
    expect(generateAudio).toHaveBeenCalledWith(expect.objectContaining({ durationSec: 26 }))
    capabilitiesFor.mockReturnValueOnce({ maxDurationSec: 30 })
    await generateBed(fields, 45, '/tmp/work')
    expect(generateAudio).toHaveBeenLastCalledWith(expect.objectContaining({ durationSec: 30 }))
  })

  it('keeps the whole composition beside the fitted bed, copied before the fit', async () => {
    copied.mockClear()
    fitted.mockClear()
    const bed = await generateBed(fields, 23.4, '/tmp/work')
    expect(bed.rawPath).toBe('/tmp/work/composed.mp3')
    expect(copied).toHaveBeenCalledWith('/tmp/work/bed.mp3', '/tmp/work/composed.mp3')
    expect(copied.mock.invocationCallOrder[0]).toBeLessThan(fitted.mock.invocationCallOrder[0])
  })

  it("hands the director's style tags to the music model beside the prompt", async () => {
    await generateBed(fields, 23.4, '/tmp/work')
    expect(generateAudio).toHaveBeenLastCalledWith(
      expect.objectContaining({
        prompt: 'warm piano. Instrumental.',
        tags: 'solo piano, warm, calm, instrumental',
      }),
    )
  })
})
