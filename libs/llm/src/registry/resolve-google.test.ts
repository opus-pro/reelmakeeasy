import { resetGenerationProviderForTesting, setGenerationProvider } from './generation-provider'
import { resetModelRegistryForTesting, resolveRole } from './index'
import { applyEnvOverrides } from './load'
import { createModelResolver } from './resolve'
import { parseModelRegistry } from './schema'
import { defaultRegistry, quietLogger, rawDefaults } from './test-helpers'

const registry = parseModelRegistry(rawDefaults())
const onGoogle = createModelResolver(registry, { generationProvider: () => 'google' })
const onFal = createModelResolver(registry)

describe('roles on the google provider', () => {
  it('come from providerRoles.google', () => {
    expect(onGoogle.resolveRole('video.firstLast')?.key).toBe('omni-flash-google')
    expect(onGoogle.resolveRole('image.edit')?.key).toBe('nano-banana-pro-google')
    expect(onGoogle.resolveRole('music')?.key).toBe('lyria-3-clip-google')
    expect(onGoogle.resolveRole('speech.align')?.key).toBe('gemini-transcribe')
  })

  it('turn off lipsync and reference clips, and keep the roles google does not list', () => {
    expect(onGoogle.resolveRole('video.lipsync')).toBeNull()
    expect(onGoogle.resolveRole('video.reference')).toBeNull()
    expect(onGoogle.resolveRole('chat.flash')?.key).toBe(onFal.resolveRole('chat.flash')?.key)
    expect(onGoogle.resolveRole('tts.kokoro')?.key).toBe('kokoro-en')
  })

  it('leave fal as it was', () => {
    expect(onFal.resolveRole('video.firstLast')?.key).toBe('minimax-h3-max-turbo')
    expect(onFal.resolveRole('image.edit')?.key).toBe('gpt-image-2.5-flare')
  })

  it("keep phase 2's ElevenLabs-on-fal roles off fal: captions on Gemini Transcribe, no Eleven v3", () => {
    expect(onGoogle.resolveRole('speech.transcribe')?.key).toBe('gemini-transcribe')
    expect(onGoogle.resolveRole('speech.align')?.key).toBe('gemini-transcribe')
    expect(onGoogle.resolveRole('tts.elevenlabs')).toBeNull()
    expect(onFal.resolveRole('speech.transcribe')?.key).toBe('elevenlabs-scribe-fal')
    expect(onFal.resolveRole('speech.align')?.key).toBe('elevenlabs-align-fal')
    expect(onFal.resolveRole('tts.elevenlabs')?.key).toBe('eleven-v3-fal')
  })
})

describe('clips on google', () => {
  it('default to Omni Flash, which takes first and last frames at any length from 3 to 10 s', () => {
    for (const role of ['video.firstLast', 'video.image', 'video.text'] as const) {
      expect(onGoogle.resolveRole(role)?.key).toBe('omni-flash-google')
    }
  })

  it('keep the Veo models selectable by name', () => {
    for (const key of ['veo-3.1-fast-google', 'veo-3.1-lite-google', 'veo-3.1-google']) {
      expect(onGoogle.resolveModel('video', key, { role: 'video.firstLast' }).key).toBe(key)
    }
  })
})

describe('model ids of the other provider', () => {
  it('resolve through the role on google', () => {
    expect(
      onGoogle.resolveModel('video', 'minimax-h3-max-turbo', { role: 'video.firstLast' }),
    ).toMatchObject({ key: 'omni-flash-google', source: 'unknown-fallback' })
    expect(onGoogle.resolveModel('image', 'fal-ai/flux/dev', { role: 'image.generate' }).key).toBe(
      'nano-banana-pro-google',
    )
  })

  it('resolve through the role on fal', () => {
    expect(
      onFal.resolveModel('video', 'veo-3.1-lite-google', { role: 'video.firstLast' }).key,
    ).toBe('minimax-h3-max-turbo')
  })

  it('of the same provider resolve as named', () => {
    expect(
      onGoogle.resolveModel('video', 'veo-3.1-fast-google', { role: 'video.firstLast' }).key,
    ).toBe('veo-3.1-fast-google')
  })

  it('never redirect voices', () => {
    expect(onGoogle.resolveModel('tts', 'kokoro-en').key).toBe('kokoro-en')
  })
})

describe('frames, fallbacks and the public registry on google', () => {
  it('animate first to last frame on Omni Flash', () => {
    expect(onGoogle.resolveVideoForFrames(undefined, { end: 'b', start: 'a' })).toMatchObject({
      endpoint: 'gemini-omni-1.1-flash',
      key: 'omni-flash-google',
      mode: 'firstLast',
    })
  })

  it('fall back only to models of the same provider: Omni Flash, then Veo 3.1 Fast on google', () => {
    expect(onGoogle.fallbacksFor('video.firstLast').map((m) => m.key)).toEqual([
      'omni-flash-google',
      'veo-3.1-fast-google',
    ])
    expect(onGoogle.fallbacksFor('omni-flash-google').map((m) => m.key)).toContain(
      'veo-3.1-fast-google',
    )
    expect(onFal.fallbacksFor('video.firstLast').map((m) => m.key)).toEqual(['veo-3.1-fast'])
    expect(onGoogle.fallbacksFor('nano-banana-pro-google').map((m) => m.key)).toEqual([
      'nano-banana-2-google',
    ])
  })

  it('list only the provider entries, its roles and its clip choices', () => {
    const pub = onGoogle.publicRegistry()
    expect(pub.generationProvider).toBe('google')
    // Array paths: a key with dots would read as a nested path.
    expect(pub.models).toHaveProperty(['veo-3.1-fast-google'])
    expect(pub.models).not.toHaveProperty(['minimax-h3-max-turbo'])
    expect(pub.roles['video.firstLast']?.key).toBe('omni-flash-google')
    // The default first, then the Veo models in registry order.
    expect(pub.videoChoices).toEqual([
      'omni-flash-google',
      'veo-3.1-fast-google',
      'veo-3.1-lite-google',
      'veo-3.1-google',
    ])
    expect(onFal.publicRegistry()).toMatchObject({ generationProvider: 'fal', videoChoices: [] })
    expect(onFal.publicRegistry().models).not.toHaveProperty(['veo-3.1-fast-google'])
  })

  it('list the clip model an env override makes the default first', () => {
    const overridden = applyEnvOverrides(
      defaultRegistry(),
      { VIDEO_FIRSTLAST_MODEL: 'veo-3.1-lite-google' },
      quietLogger(),
    )
    const pub = createModelResolver(overridden, {
      generationProvider: () => 'google',
    }).publicRegistry()
    expect(pub.videoChoices).toEqual([
      'veo-3.1-lite-google',
      'veo-3.1-fast-google',
      'veo-3.1-google',
      'omni-flash-google',
    ])
  })
})

describe('the process-wide resolver', () => {
  afterEach(() => {
    resetGenerationProviderForTesting()
    resetModelRegistryForTesting()
  })

  it('follows setGenerationProvider', () => {
    resetModelRegistryForTesting()
    setGenerationProvider('google')
    expect(resolveRole('video.firstLast')?.key).toBe('omni-flash-google')
    setGenerationProvider('fal')
    expect(resolveRole('video.firstLast')?.key).toBe('minimax-h3-max-turbo')
  })
})
