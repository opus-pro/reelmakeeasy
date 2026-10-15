import { DEFAULT_VOICE_ID, falElevenLabsVoice, PRESET_VOICES } from './preset-voices'

/**
 * What fal's Eleven v3 took for each visible ElevenLabs preset in the live probe
 * recorded in the PR that added `falVoiceName`: the id, the name fal speaks the
 * voice by, or null when fal can't speak it.
 */
const FAL_PROBE: Record<string, null | string> = {
  Alice: 'Xb7hH8MSUJpSbSDYk0k2',
  Bella: 'hpp4J3VqNfWAUOO0d1Us',
  Bill: 'pqHfZKP75CvOlQylNhV4',
  Eric: 'cjVigY5qzO86Huf0OWal',
  George: 'JBFqnCBsd6RMkjVDRZzb',
  Jessica: 'cgSgspJ2msm6clMCkdW9',
  Liam: 'TX3LPaxmHKxFdv7VOQHJ',
  Matilda: 'XrExE9yKIg1WjnnlVkGX',
  Sarah: 'EXAVITQu4vr4xnSDxMaL',
}

const visibleElevenLabs = PRESET_VOICES.filter(
  (voice) => (voice.provider ?? 'elevenlabs') === 'elevenlabs' && voice.visible !== false,
)

describe('falElevenLabsVoice', () => {
  it('sends fal what the probe recorded for every visible ElevenLabs preset', () => {
    expect(visibleElevenLabs.map((voice) => voice.name).sort()).toEqual(
      Object.keys(FAL_PROBE).sort(),
    )
    for (const voice of visibleElevenLabs) {
      expect([voice.name, falElevenLabsVoice(voice.id)]).toEqual([
        voice.name,
        FAL_PROBE[voice.name],
      ])
    }
  })

  it('can speak the default voice, which stands in for the rest', () => {
    expect(falElevenLabsVoice(DEFAULT_VOICE_ID)).not.toBeNull()
  })

  it('has nothing for other voices', () => {
    expect(falElevenLabsVoice('kokoro-af_heart')).toBeNull()
    expect(falElevenLabsVoice('myElevenClone')).toBeNull()
  })
})
