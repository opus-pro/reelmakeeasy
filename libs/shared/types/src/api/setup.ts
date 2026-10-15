import type { AgentStatusResponse } from './agent'

/** Who makes the pictures, clips, voice and music: fal, or Google's Gemini API. */
export type GenerationProvider = 'fal' | 'google'

/** Which AI writes and plans: Claude Code, Codex, a custom OpenAI-compatible endpoint
 *  (`LLM_BASE_URL`) or Gemini. */
export type LlmProvider = 'claude' | 'codex' | 'endpoint' | 'gemini'

/** Which keys `.env` sets: presence only, never the values. `endpoint` is `LLM_BASE_URL`. */
export interface SetupKeys {
  elevenlabs: boolean
  endpoint: boolean
  fal: boolean
  gemini: boolean
}

/** One choice in Setup, with why it can't be picked when it isn't available. */
export interface SetupOption<T extends string> {
  available: boolean
  id: T
  label: string
  reason?: string
}

/**
 * `GET /api/setup/status`. `provider` is the stored (or `.env` default) choice; `effective` the
 * one in use: null when nothing is ready, or when the stored choice isn't (it is never swapped).
 */
export interface SetupStatus {
  generation: {
    effective: GenerationProvider | null
    options: SetupOption<GenerationProvider>[]
    provider: GenerationProvider | null
  }
  harnesses: AgentStatusResponse
  keys: SetupKeys
  llm: {
    effective: LlmProvider | null
    options: SetupOption<LlmProvider>[]
    provider: LlmProvider | null
  }
}

/** Where voice typing turns speech into text: Gemini, Whisper on this computer, ElevenLabs
 *  Scribe on fal, or the browser's own speech recognition. */
export type DictationEngine = 'browser' | 'fal' | 'gemini' | 'local'

/** The voice typing choice: one engine, the best one available (`auto`), or off. */
export type DictationSetting = 'auto' | 'off' | DictationEngine

/**
 * `GET /api/speech/dictation`. `engine` is the one voice typing uses: null when it's off, or when
 * the chosen engine isn't available (it is never swapped for another). `browser` is always
 * offered; the page itself knows whether its browser can do speech recognition.
 */
export interface DictationStatus {
  engine: DictationEngine | null
  options: SetupOption<DictationEngine>[]
  setting: DictationSetting
}
