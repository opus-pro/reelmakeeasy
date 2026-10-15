import { BaseVoiceConfig } from './project'
import type { GenerationProvider } from './setup'

export type VoiceOverOption = BaseVoiceConfig & {
  // Flag to indicate if this is the default voice option
  default?: boolean
  description: string
  id: string
  labels: string[]
  needsPresignedUrl?: boolean
  previewAudioUrl: string
  provider?: string
  speed?: VoiceSpeed
  // Single marketing tone descriptor (e.g. "Engaging", "Insightful"). Authored
  // explicitly per preset so the UI never has to guess it from a labels index.
  tone: string
  /** Why this voice can't be picked now, in plain words (e.g. a Gemini voice without
   *  GEMINI_API_KEY). Its stored preview still plays. */
  unavailableReason?: string
  visible?: boolean
}
export type VoiceOverOptionsResponse = {
  data: VoiceOverOption[]
}

export type VoiceSpeed = 'fast' | 'medium' | 'slow'

/** A family of voices the voice picker can filter by. */
export type TtsEngine = 'elevenlabs' | 'gemini' | 'kokoro' | 'qwen3'

/** Where the Standard voice clone runs: ElevenLabs instant cloning, or MiniMax on fal. */
export type StandardCloneBackend = 'elevenlabs' | 'minimax'

/** Whether a clone engine works with the keys set, and why not. */
export type CloneEngineStatus = { available: boolean; reason?: string }

/**
 * Where an engine's speech is made right now. `local` is the local voice server
 * on the user's own machine (free); `fal` and `elevenlabs` are paid APIs.
 * ElevenLabs voices run on `fal` when no ElevenLabs key is set.
 * `google` is the Gemini API on the user's GEMINI_API_KEY (Gemini voices).
 */
export type TtsEnginesResponse = {
  /** ELEVENLABS_API_KEY is set: ElevenLabs voices, caption timing and cloning use the user's own account. */
  elevenlabsKey: boolean
  engines: Record<TtsEngine, TtsEngineStatus>
  /** GEMINI_API_KEY is set: Gemini voices can be picked, whoever makes the videos. Without it
   *  they are still listed (and previewable) but greyed out. */
  geminiKey: boolean
  /** Who makes the voices now (the generation provider chosen in Setup). On `google` the web
   *  greys out voice clones that would run on fal, and Qwen3 clones without the local voices. */
  generationProvider: GenerationProvider
  /** The local voice server's hardware backend (`mlx`, `cuda`, `mps`, `cpu`), when it runs. */
  localBackend?: string
  /** Whether Qwen3 can clone: locally, or on fal with FAL_KEY (never on fal while Gemini makes the voices). */
  qwen3Clone: CloneEngineStatus
  /** The engines whose voices the picker lists now, in display order. */
  shown: TtsEngine[]
  /** Where the Standard voice clone runs, or null when neither an ElevenLabs nor a fal key is set. */
  standardClone: null | StandardCloneBackend
}

export type TtsEngineStatus = {
  free: boolean
  runsOn: 'elevenlabs' | 'fal' | 'google' | 'local'
}
