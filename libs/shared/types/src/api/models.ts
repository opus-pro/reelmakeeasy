/**
 * `GET /api/models`: which model serves each role, as the server resolved
 * `reelmakeeasy.models.json` (plus any `<ROLE>_MODEL` override).
 *
 * Mirrors `PublicRegistry` in `libs/llm/src/registry/resolve.ts`. The API
 * controller returns `publicRegistry()` typed as this contract, so a drift
 * between the two fails the API type-check. Defined here rather than imported
 * because the registry's entry point is node-only and the web cannot load it.
 * No endpoints, adapters or keys: labels and capabilities only.
 */

export interface ImageModelCapabilities {
  aspectRatios: string[]
  maxReferenceImages: number
  resolutions: string[]
}

export interface LipsyncModelCapabilities {
  maxVideoSec: number
  minVideoSec: number
}

export type ModelCapabilities =
  | ImageModelCapabilities
  | LipsyncModelCapabilities
  | MusicModelCapabilities
  | VideoModelCapabilities

export type ModelKind =
  | 'align'
  | 'chat'
  | 'image'
  | 'lipsync'
  | 'music'
  | 'tts'
  | 'video'
  | 'voice-clone'

export type ModelProvider = 'elevenlabs' | 'fal' | 'google' | 'openai-compatible'

export type ModelRole =
  | 'chat.flash'
  | 'chat.lite'
  | 'chat.pro'
  | 'image.agentPreview'
  | 'image.edit'
  | 'image.fast'
  | 'image.generate'
  | 'music'
  | 'speech.align'
  | 'tts'
  | 'tts.gemini'
  | 'tts.kokoro'
  | 'tts.minimax'
  | 'tts.qwen3'
  | 'video.firstLast'
  | 'video.image'
  | 'video.lipsync'
  | 'video.reference'
  | 'video.text'
  | 'voice.clone'

export interface MusicModelCapabilities {
  maxDurationSec: number
}

export interface VideoModelCapabilities {
  aspectRatios: string[]
  audio: boolean
  /** Transitions are made one after another, each from the previous clip's last frame. */
  chainTransitions?: boolean
  durationsSec: number[]
  emitsNativeAudio?: boolean
  family?: string
  maxReferenceImages?: number
  maxResolution: string
  promptMaxChars?: number
  resolutions?: string[]
  /** Price per second of video at each resolution, e.g. `{ "768p": 0.02 }`. */
  usdPerSecond?: Record<string, number>
}

/** A registry entry, keyed by its registry key in `ModelsResponse.models`. */
export interface ModelInfo {
  /** Other ids that resolve to this entry (e.g. `kling` for `kling-3.0`). */
  aliases?: string[]
  capabilities?: ModelCapabilities
  kind: ModelKind
  label: string
  provider: ModelProvider
}

/** The model a role resolves to. */
export interface ModelsResponse {
  /** Which provider makes pictures and clips now; models and roles are for it. */
  generationProvider: 'fal' | 'google'
  models: Record<string, ModelInfo>
  /** `null` when the role is disabled in the registry. */
  roles: Record<ModelRole, null | RoleModelInfo>
  /** Clip models the composer offers, the default first (Gemini only; empty on fal). */
  videoChoices: string[]
}

export interface RoleModelInfo {
  capabilities?: ModelCapabilities
  /** Registry key, e.g. `kling-3.0`. The id to send when an API needs one. */
  key: string
  label: string
}
