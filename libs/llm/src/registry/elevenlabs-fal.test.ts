import { createModelResolver } from './resolve'
import { parseModelRegistry } from './schema'
import { rawDefaults, readRootJson } from './test-helpers'

describe('ElevenLabs hosted on fal', () => {
  it('maps the new roles in both model files', () => {
    for (const file of ['reelmakeeasy.models.json', 'reelmakeeasy.models.example.json']) {
      const registry = parseModelRegistry(readRootJson(file))
      expect(registry.roles['tts.elevenlabs']).toBe('eleven-v3-fal')
      expect(registry.roles['speech.transcribe']).toBe('elevenlabs-scribe-fal')
      expect(registry.roles['speech.align']).toBe('elevenlabs-align-fal')
    }
  })

  it('resolves the fal endpoints and keeps the direct ElevenLabs model', () => {
    const resolver = createModelResolver(parseModelRegistry(rawDefaults()))
    expect(resolver.resolveRole('tts.elevenlabs')).toMatchObject({
      adapter: 'elevenlabs-tts',
      endpoint: 'fal-ai/elevenlabs/tts/eleven-v3',
      key: 'eleven-v3-fal',
      provider: 'fal',
    })
    expect(resolver.resolveRole('speech.transcribe')).toMatchObject({
      adapter: 'elevenlabs-scribe',
      endpoint: 'fal-ai/elevenlabs/speech-to-text/scribe-v2',
      kind: 'align',
      provider: 'fal',
    })
    expect(resolver.resolveRole('speech.align')).toMatchObject({
      adapter: 'elevenlabs-align',
      endpoint: 'fal-ai/elevenlabs/forced-alignment',
      provider: 'fal',
    })
    expect(resolver.resolveRole('tts')).toMatchObject({
      model: 'eleven_v3',
      provider: 'elevenlabs',
    })
  })

  it('still loads a models file written before these roles existed', () => {
    const raw = rawDefaults()
    delete raw['roles']['tts.elevenlabs']
    delete raw['roles']['speech.transcribe']
    const registry = parseModelRegistry(raw)
    expect(registry.roles['tts.elevenlabs']).toBeNull()
    expect(registry.roles['speech.transcribe']).toBeNull()
  })

  it('needs an endpoint on a fal align entry', () => {
    const raw = rawDefaults()
    delete raw['models']['elevenlabs-scribe-fal']['endpoints']
    expect(() => parseModelRegistry(raw)).toThrow(/fal align entries need endpoints.generate/)
  })

  it('rejects endpoints on a direct ElevenLabs align entry', () => {
    const raw = rawDefaults()
    raw['models']['elevenlabs-align']['endpoints'] = {
      generate: 'fal-ai/elevenlabs/forced-alignment',
    }
    expect(() => parseModelRegistry(raw)).toThrow(/take no endpoints/)
  })

  it('rejects an ElevenLabs model id on the fal voice entry', () => {
    const raw = rawDefaults()
    raw['models']['eleven-v3-fal']['model'] = 'eleven_v3'
    expect(() => parseModelRegistry(raw)).toThrow(/fal TTS entries take endpoints, not model/)
  })

  it('needs an endpoint on the fal voice entry', () => {
    const raw = rawDefaults()
    delete raw['models']['eleven-v3-fal']['endpoints']
    expect(() => parseModelRegistry(raw)).toThrow(/fal TTS entries need endpoints.generate/)
  })
})
