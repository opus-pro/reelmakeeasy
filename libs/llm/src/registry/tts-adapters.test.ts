import { createModelResolver } from './resolve'
import { parseModelRegistry } from './schema'
import { rawDefaults, readRootJson } from './test-helpers'

describe('fal TTS adapters', () => {
  it('accepts the Kokoro and Qwen3-TTS entries in both model files', () => {
    for (const file of ['reelmakeeasy.models.json', 'reelmakeeasy.models.example.json']) {
      const registry = parseModelRegistry(readRootJson(file))
      expect(registry.roles['tts.kokoro']).toBe('kokoro-en')
      expect(registry.roles['tts.qwen3']).toBe('qwen3-tts-1.7b')
    }
  })

  it('resolves the Qwen3 design and clone endpoints', () => {
    const resolver = createModelResolver(parseModelRegistry(rawDefaults()))
    const qwen3 = resolver.resolveRole('tts.qwen3')
    expect(qwen3?.adapter).toBe('qwen3-tts')
    expect(qwen3?.endpoint).toBe('fal-ai/qwen-3-tts/text-to-speech/1.7b')
    expect(qwen3?.endpoints['design']).toBe('fal-ai/qwen-3-tts/voice-design/1.7b')
    expect(qwen3?.endpoints['clone']).toBe('fal-ai/qwen-3-tts/clone-voice/1.7b')
  })

  it('rejects clone/design endpoints on other fal TTS adapters', () => {
    const raw = rawDefaults()
    raw['models']['kokoro-en']['endpoints']['clone'] = 'fal-ai/qwen-3-tts/clone-voice/1.7b'
    expect(() => parseModelRegistry(raw)).toThrow(/only qwen3-tts entries take endpoints.clone/)
  })

  it('rejects a TTS role pointed at a non-TTS model', () => {
    const raw = rawDefaults()
    raw['roles']['tts.kokoro'] = 'lyria2'
    expect(() => parseModelRegistry(raw)).toThrow()
  })
})
