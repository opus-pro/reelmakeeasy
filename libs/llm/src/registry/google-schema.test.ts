import { parseModelRegistry } from './schema'
import { rawDefaults } from './test-helpers'

const veoGoogle = {
  adapter: 'veo-google',
  capabilities: {
    aspectRatios: ['16:9', '9:16'],
    audio: true,
    durationsSec: [4, 6, 8],
    emitsNativeAudio: true,
    maxResolution: '1080p',
  },
  endpoints: {
    firstLast: 'veo-3.1-fast-generate-preview',
    image: 'veo-3.1-fast-generate-preview',
    text: 'veo-3.1-fast-generate-preview',
  },
  kind: 'video',
  label: 'Veo 3.1 Fast (test)',
  provider: 'google',
}

function withGoogleEntries() {
  const raw = rawDefaults()
  raw['models']['veo-test-google'] = structuredClone(veoGoogle)
  raw['models']['tts-test-google'] = {
    adapter: 'gemini-tts',
    kind: 'tts',
    label: 'Gemini TTS (test)',
    model: 'gemini-3.8-flash-tts',
    provider: 'google',
  }
  raw['models']['align-test-google'] = {
    adapter: 'gemini-transcribe',
    kind: 'align',
    label: 'Gemini Transcribe (test)',
    model: 'gemini-3.5-transcribe',
    provider: 'google',
  }
  return raw
}

describe('google entries', () => {
  it('accepts Gemini video, TTS and transcription entries', () => {
    const registry = parseModelRegistry(withGoogleEntries())
    expect(registry.models['veo-test-google']?.provider).toBe('google')
    expect(registry.models['tts-test-google']?.kind).toBe('tts')
    expect(registry.models['align-test-google']?.kind).toBe('align')
  })

  it('rejects a fal adapter on a google entry, and a Gemini adapter on fal', () => {
    const raw = withGoogleEntries()
    raw['models']['veo-test-google']['adapter'] = 'veo'
    expect(() => parseModelRegistry(raw)).toThrow(/google entries use a Gemini adapter/)
    const fal = rawDefaults()
    fal['models']['veo-3.1-fast']['adapter'] = 'veo-google'
    expect(() => parseModelRegistry(fal)).toThrow(/adapter "veo-google" is for google entries/)
  })

  it('needs a model id on Gemini TTS and transcription entries', () => {
    const raw = withGoogleEntries()
    delete raw['models']['tts-test-google']['model']
    delete raw['models']['align-test-google']['model']
    expect(() => parseModelRegistry(raw)).toThrow(/Gemini TTS entries need a model id/)
    expect(() => parseModelRegistry(raw)).toThrow(/Gemini transcription entries need a model id/)
  })
})

describe('providerRoles', () => {
  it('maps roles for google and leaves the others to roles', () => {
    const raw = withGoogleEntries()
    raw['providerRoles'] = {
      google: { 'video.firstLast': 'veo-test-google', 'video.lipsync': null },
    }
    const registry = parseModelRegistry(raw)
    expect(registry.providerRoles?.google?.['video.firstLast']).toBe('veo-test-google')
    expect(registry.providerRoles?.google?.['video.lipsync']).toBeNull()
    expect(registry.providerRoles?.google).not.toHaveProperty('music')
  })

  it('checks providerRoles like roles', () => {
    const raw = withGoogleEntries()
    raw['providerRoles'] = { google: { 'video.firstLast': 'tts-test-google' } }
    expect(() => parseModelRegistry(raw)).toThrow(
      /providerRoles\.google\.video\.firstLast -> "tts-test-google" is a tts model/,
    )
    raw['providerRoles'] = { google: { music: 'missing-key' } }
    expect(() => parseModelRegistry(raw)).toThrow(
      /providerRoles\.google\.music -> "missing-key" is not a model key/,
    )
  })

  it('rejects providers other than google', () => {
    const raw = rawDefaults()
    raw['providerRoles'] = { fal: { music: 'ace-step' } }
    expect(() => parseModelRegistry(raw)).toThrow(/Unrecognized key/)
  })
})

describe('tts.gemini role', () => {
  it('is optional: a file without it loads with the role off', () => {
    const raw = rawDefaults()
    delete raw['roles']['tts.gemini']
    expect(parseModelRegistry(raw).roles['tts.gemini']).toBeNull()
  })
})
