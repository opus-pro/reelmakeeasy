import { parseModelRegistry, type VideoCaps } from './schema'
import { defaultRegistry, readRootJson } from './test-helpers'

const capsOf = (key: string): VideoCaps =>
  (defaultRegistry().models[key] as { capabilities: VideoCaps }).capabilities

describe('Gemini (google) entries in reelmakeeasy.models.json', () => {
  const registry = defaultRegistry()

  it.each([
    ['nano-banana-pro-google', 'image', 'gemini-image', 'gemini-3-pro-image'],
    ['nano-banana-2-google', 'image', 'gemini-image', 'gemini-3.1-flash-image'],
    ['nano-banana-2-lite-google', 'image', 'gemini-image', 'gemini-3.1-flash-lite-image'],
    ['veo-3.1-fast-google', 'video', 'veo-google', 'veo-3.1-fast-generate-preview'],
    ['veo-3.1-lite-google', 'video', 'veo-google', 'veo-3.1-lite-generate-preview'],
    ['veo-3.1-google', 'video', 'veo-google', 'veo-3.1-generate-preview'],
    ['omni-flash-google', 'video', 'omni-google', 'gemini-omni-1.1-flash'],
    ['lyria-3-clip-google', 'music', 'lyria-google', 'lyria-3-clip-preview'],
  ])('%s is a google %s entry on %s calling %s', (key, kind, adapter, modelId) => {
    const entry = registry.models[key]
    expect(entry).toMatchObject({ adapter, kind, provider: 'google' })
    expect(Object.values((entry as { endpoints: Record<string, string> }).endpoints)).toContain(
      modelId,
    )
  })

  it('names the Gemini TTS and transcription models', () => {
    expect(registry.models['gemini-tts']).toMatchObject({
      adapter: 'gemini-tts',
      kind: 'tts',
      model: 'gemini-3.8-flash-tts',
      provider: 'google',
    })
    expect(registry.models['gemini-transcribe']).toMatchObject({
      adapter: 'gemini-transcribe',
      kind: 'align',
      model: 'gemini-3.5-transcribe',
      provider: 'google',
    })
    expect(registry.roles['tts.gemini']).toBe('gemini-tts')
  })

  it('marks every Gemini clip model as making its own sound, so transitions strip it', () => {
    for (const key of [
      'veo-3.1-fast-google',
      'veo-3.1-lite-google',
      'veo-3.1-google',
      'omni-flash-google',
    ]) {
      expect(capsOf(key).emitsNativeAudio).toBe(true)
      expect(capsOf(key).aspectRatios).toEqual(['16:9', '9:16'])
    }
  })

  it('gives Veo 4, 6 and 8 second clips at 720p or 1080p, and Omni 3 to 10 seconds at 720p', () => {
    expect(capsOf('veo-3.1-fast-google').durationsSec).toEqual([4, 6, 8])
    expect(capsOf('veo-3.1-lite-google').resolutions).toEqual(['720p', '1080p'])
    expect(capsOf('omni-flash-google').durationsSec).toEqual([3, 4, 5, 6, 7, 8, 9, 10])
    expect(capsOf('omni-flash-google').resolutions).toEqual(['720p'])
  })

  it("maps the google roles, clips on Omni Flash and phase 2's ElevenLabs-on-fal roles included", () => {
    expect(registry.providerRoles?.google).toEqual({
      'image.agentPreview': 'nano-banana-2-lite-google',
      'image.edit': 'nano-banana-pro-google',
      'image.fast': 'nano-banana-2-google',
      'image.generate': 'nano-banana-pro-google',
      music: 'lyria-3-clip-google',
      'speech.align': 'gemini-transcribe',
      'speech.transcribe': 'gemini-transcribe',
      'tts.elevenlabs': null,
      'video.firstLast': 'omni-flash-google',
      'video.image': 'omni-flash-google',
      'video.lipsync': null,
      'video.reference': null,
      'video.text': 'omni-flash-google',
    })
  })

  it('falls back from Omni Flash to Veo 3.1 Fast on google, and to Veo 3.1 Fast on fal', () => {
    for (const role of ['video.firstLast', 'video.image'] as const) {
      expect(registry.fallbacks?.[role]).toEqual([
        'veo-3.1-fast',
        'omni-flash-google',
        'veo-3.1-fast-google',
      ])
    }
  })

  it('keeps the fal roles as they were', () => {
    expect(registry.roles['video.firstLast']).toBe('minimax-h3-max-turbo')
    expect(registry.roles['image.generate']).toBe('gpt-image-2.5-flare')
  })

  it('still parses the example file', () => {
    expect(() => parseModelRegistry(readRootJson('reelmakeeasy.models.example.json'))).not.toThrow()
  })
})
