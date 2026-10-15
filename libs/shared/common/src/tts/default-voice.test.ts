import type { LocalTtsHealth } from './local-tts'

/** What the local voice server reports (null: not running, or not installed). */
let health: LocalTtsHealth | null = null
jest.mock('./local-tts', () => ({ localTtsHealth: async () => health }))
/** Who makes the videos, as Setup picked (the registry is mocked: common doesn't import it). */
let provider: 'fal' | 'google' = 'fal'
jest.mock('@reelmakeeasy/llm/registry', () => ({ currentGenerationProvider: () => provider }))
const setGenerationProvider = (next: 'fal' | 'google') => {
  provider = next
}

import {
  defaultLoopVoiceId,
  defaultVoiceId,
  KOKORO_LOOP_VOICE_ID,
  QWEN3_LOOP_VOICE_ID,
} from './default-voice'
import { GEMINI_DEFAULT_VOICE_ID } from './gemini-voices'
import { DEFAULT_VOICE_ID, PRESET_VOICES } from './preset-voices'

const local = (engines: LocalTtsHealth['engines']): LocalTtsHealth => ({ backend: 'mlx', engines })

afterEach(() => {
  health = null
  provider = 'fal'
})

describe('defaultLoopVoiceId', () => {
  it('is Kokoro Heart when Kokoro runs on this computer, on either provider', async () => {
    health = local({ kokoro: true, qwen3: true })
    setGenerationProvider('fal')
    await expect(defaultLoopVoiceId()).resolves.toBe(KOKORO_LOOP_VOICE_ID)
    setGenerationProvider('google')
    await expect(defaultLoopVoiceId()).resolves.toBe(KOKORO_LOOP_VOICE_ID)
    expect(KOKORO_LOOP_VOICE_ID).toBe('kokoro-af_heart')
  })

  it("is Qwen3's Ryan when only Qwen3 runs here", async () => {
    health = local({ kokoro: false, qwen3: true })
    await expect(defaultLoopVoiceId()).resolves.toBe(QWEN3_LOOP_VOICE_ID)
  })

  it("is the provider's default voice (paid) only when no free voice is installed", async () => {
    setGenerationProvider('fal')
    await expect(defaultLoopVoiceId()).resolves.toBe(DEFAULT_VOICE_ID)
    health = local({ kokoro: false, qwen3: false })
    setGenerationProvider('google')
    await expect(defaultLoopVoiceId()).resolves.toBe(GEMINI_DEFAULT_VOICE_ID)
    expect(defaultVoiceId()).toBe(GEMINI_DEFAULT_VOICE_ID)
  })

  it('picks voices the picker shows in English', () => {
    for (const id of [KOKORO_LOOP_VOICE_ID, QWEN3_LOOP_VOICE_ID]) {
      const preset = PRESET_VOICES.find((voice) => voice.id === id)
      expect(preset?.visible).not.toBe(false)
      expect(preset?.labels[0]).toMatch(/^English/)
    }
  })
})
