/**
 * Which voice engines the voice picker lists, and whether Qwen3 can clone, for
 * the keys set and the generation provider (fal or Gemini). On Gemini nothing
 * is billed to fal: Kokoro and Qwen3 are listed (and Qwen3 clones) only when
 * they run on this computer, and ElevenLabs only with its own key. Gemini's
 * voices are always listed, so people know they are there; they speak with
 * GEMINI_API_KEY whoever makes the videos, and without it they can be heard
 * (their previews ship with the app) but not picked.
 */
import { currentGenerationProvider, type GenerationProvider } from '@reelmakeeasy/llm/registry'

import { hasElevenLabsKey } from '../elevenlabs/key'

import { isGeminiVoiceId } from './gemini-voices'
import { localTtsHealth } from './local-tts'

export interface CloneEngineStatus {
  available: boolean
  reason?: string
}

export interface VoiceContext {
  elevenlabsKey: boolean
  falKey: boolean
  /** GEMINI_API_KEY is set: Gemini voices can be picked, whoever makes the videos. */
  geminiKey: boolean
  generation: GenerationProvider
  localEngines: { kokoro: boolean; qwen3: boolean }
}

export type VoiceEngine = 'elevenlabs' | 'gemini' | 'kokoro' | 'qwen3'

/** Why a Gemini voice can't be picked: the same words on the voice row, the API and the agent. */
export const NEEDS_GEMINI_KEY = 'Needs a Gemini key: add it in Setup'

/** Why Qwen3 can't clone: it needs the local voice server (and on fal, FAL_KEY would do). */
export const NEEDS_LOCAL_VOICES = 'Needs the free local voices: run pnpm reelmakeeasy setup'

/** GEMINI_API_KEY is set (a blank value counts as unset). */
export const hasGeminiKey = (env: NodeJS.ProcessEnv = process.env): boolean =>
  Boolean(env['GEMINI_API_KEY']?.trim())

/** The voice context now: keys from the environment, the Setup provider, the local voice server. */
export async function currentVoiceContext(
  env: NodeJS.ProcessEnv = process.env,
): Promise<VoiceContext> {
  const local = await localTtsHealth()
  return {
    // Phase 2's helper, so this report and GET /api/setup/status agree about a blank key.
    elevenlabsKey: hasElevenLabsKey(env),
    falKey: Boolean(env['FAL_KEY']?.trim()),
    geminiKey: hasGeminiKey(env),
    generation: currentGenerationProvider(),
    localEngines: { kokoro: Boolean(local?.engines.kokoro), qwen3: Boolean(local?.engines.qwen3) },
  }
}

/** Gemini voices speak on GEMINI_API_KEY, whoever makes the pictures and clips. */
export const geminiVoicesUsable = (c: Pick<VoiceContext, 'geminiKey'>): boolean => c.geminiKey

/** Why a picked voice can't be used: a Gemini voice without GEMINI_API_KEY. Undefined otherwise. */
export function pickedVoiceUnavailableReason(
  voiceId: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const id = voiceId?.trim()
  return id && isGeminiVoiceId(id) && !hasGeminiKey(env) ? NEEDS_GEMINI_KEY : undefined
}

/** The engine a preset voice speaks with (no provider means ElevenLabs). */
export const presetEngine = (provider?: string): VoiceEngine =>
  provider === 'gemini' || provider === 'kokoro' || provider === 'qwen3' ? provider : 'elevenlabs'

/** Qwen3 clones on this computer; on fal it may also clone on fal with FAL_KEY. */
export function qwen3CloneStatus(c: VoiceContext): CloneEngineStatus {
  if (c.localEngines.qwen3 || (c.generation === 'fal' && c.falKey)) return { available: true }
  return { available: false, reason: NEEDS_LOCAL_VOICES }
}

/**
 * Gemini's voices are always listed first (picked only with GEMINI_API_KEY: see
 * `geminiVoicesUsable`). fal also lists Kokoro, Qwen3 and ElevenLabs (each local,
 * on fal, or on your key). Gemini lists Kokoro and Qwen3 only where they run
 * locally, and ElevenLabs only with an ElevenLabs key.
 */
export function shownVoiceEngines(c: VoiceContext): VoiceEngine[] {
  const google = c.generation === 'google'
  const onFal = !google && c.falKey
  const shown: VoiceEngine[] = ['gemini']
  if (c.localEngines.kokoro || onFal) shown.push('kokoro')
  if (c.localEngines.qwen3 || onFal) shown.push('qwen3')
  if (c.elevenlabsKey || onFal) shown.push('elevenlabs')
  return shown
}
