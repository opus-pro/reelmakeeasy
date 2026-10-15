import { bgmBedActivityParams, bgmBedStep, runBgmBedStep } from './bgm-bed-params'

describe('bgmBedActivityParams', () => {
  const base = {
    durationSec: 31.2,
    projectId: 'p1',
    styleName: 'Ink',
    styleText: 'ink wash',
    userId: 'u',
  }

  it('off skips the bed', () => {
    expect(bgmBedActivityParams({ ...base, bgmEnabled: false })).toBeNull()
    expect(bgmBedActivityParams({ ...base, bgmEnabled: null })).toBeNull()
  })

  it('no duration skips the bed', () => {
    expect(bgmBedActivityParams({ ...base, bgmEnabled: true, durationSec: 0 })).toBeNull()
  })

  it('passes the wish as the user request', () => {
    expect(bgmBedActivityParams({ ...base, bgmEnabled: true, bgmNote: 'calm piano' })).toEqual({
      durationSec: 31.2,
      hasVoiceover: true,
      projectId: 'p1',
      styleName: 'Ink',
      styleText: 'ink wash',
      userId: 'u',
      userRequest: 'calm piano',
    })
    expect(bgmBedActivityParams({ ...base, bgmEnabled: true, bgmNote: null })).not.toHaveProperty(
      'userRequest',
    )
  })
})

describe('bgmBedStep', () => {
  const base = { durationSec: 24, projectId: 'p1', userId: 'u' }
  const track = { id: 'bright-steps', source: 'library' as const, title: 'Bright Steps' }

  it('is null when music is off or there is no duration, whatever the track', () => {
    expect(bgmBedStep({ ...base, bgmEnabled: false, bgmTrack: track })).toBeNull()
    expect(bgmBedStep({ ...base, bgmEnabled: true, bgmTrack: track, durationSec: 0 })).toBeNull()
  })

  it('fits the chosen track instead of generating', () => {
    expect(bgmBedStep({ ...base, bgmEnabled: true, bgmNote: 'ignored', bgmTrack: track })).toEqual({
      kind: 'track',
      params: { durationSec: 24, projectId: 'p1', track, userId: 'u' },
    })
  })

  it('generates when no track is chosen', () => {
    expect(bgmBedStep({ ...base, bgmEnabled: true, bgmNote: 'calm piano' })).toEqual({
      kind: 'generate',
      params: expect.objectContaining({ durationSec: 24, userRequest: 'calm piano' }),
    })
  })
})

describe('runBgmBedStep', () => {
  const step = {
    kind: 'track' as const,
    params: {
      durationSec: 24,
      projectId: 'p1',
      track: { id: 'gone', source: 'library' as const, title: 'Gone' },
      userId: 'u',
    },
  }

  it('a missing library track yields no bed, not a failure', async () => {
    const logError = jest.fn()
    const bed = await runBgmBedStep(step, {
      fitTrack: async () => {
        throw new Error('Library track not found: gone')
      },
      generateBed: async () => null,
      logError,
    })
    expect(bed).toBeNull()
    expect(logError).toHaveBeenCalledWith(
      expect.stringContaining('BGM'),
      expect.objectContaining({ error: { message: 'Library track not found: gone' } }),
    )
  })

  it('returns the fitted bed and never calls the generator for a track step', async () => {
    const generateBed = jest.fn(async () => null)
    const fitted = {
      cdnUrl: 'https://c/bed',
      durationMs: 24000,
      fileUri: 'store://bed',
      model: '',
      prompt: '',
      trackName: 'Gone',
    }
    const bed = await runBgmBedStep(step, {
      fitTrack: async () => fitted,
      generateBed,
      logError: jest.fn(),
    })
    expect(bed).toBe(fitted)
    expect(generateBed).not.toHaveBeenCalled()
  })

  it('a null step is no bed', async () => {
    expect(
      await runBgmBedStep(null, {
        fitTrack: jest.fn(),
        generateBed: jest.fn(),
        logError: jest.fn(),
      }),
    ).toBeNull()
  })
})
