import type { TtsEngine, TtsEnginesResponse, TtsEngineStatus } from '@shared/types/api/voice-over'

import type { VoiceOption } from './voice-over-selection'

export const ENGINE_LABELS: Record<TtsEngine, string> = {
  elevenlabs: 'ElevenLabs',
  gemini: 'Gemini',
  kokoro: 'Kokoro',
  qwen3: 'Qwen',
}

/** Shown on anything that needs the user's own ElevenLabs account. */
export const NEEDS_ELEVENLABS_KEY_LABEL = 'Needs an ElevenLabs key'

/** Shown on a Gemini voice without GEMINI_API_KEY: it can be heard, not picked. Same words as the API. */
export const NEEDS_GEMINI_KEY_LABEL = 'Needs a Gemini key: add it in Setup'

/** Where the Gemini key is added. */
export const SETUP_HREF = '/setup'

/** Shown on a voice cloned on fal (MiniMax) while Gemini makes the voices. */
export const RUNS_ON_FAL_LABEL = 'Runs on fal: pick fal in Setup'

/** What a voice row needs from GET /api/voice-over/engines; the generation fields are optional,
 *  so a report with only the ElevenLabs key (phase 2's tests) still works. */
type EngineReportForRows = Partial<
  Pick<TtsEnginesResponse, 'geminiKey' | 'generationProvider' | 'qwen3Clone'>
> &
  Pick<TtsEnginesResponse, 'elevenlabsKey'>

/** The Standard clone row: its subtitle, or why it can't be used with the keys in .env. */
export interface StandardCloneOption {
  description: string
  disabledReason?: string
}

/** The cost tag's text: Free on this computer, else Paid; only fal is named (the hover says who bills Gemini and ElevenLabs). */
export function engineCostLabel(status: TtsEngineStatus): string {
  if (status.free) return 'Free'
  return status.runsOn === 'fal' ? 'Paid · fal' : 'Paid'
}

/** Hover text for an engine's cost tag. */
export function engineCostTitle(engine: TtsEngine, status: TtsEngineStatus): string {
  if (status.free) return `${ENGINE_LABELS[engine]} runs on your computer. No per-use cost.`
  if (engine === 'gemini') return 'Gemini voices are billed to your Gemini API key.'
  if (engine === 'elevenlabs') {
    return status.runsOn === 'elevenlabs'
      ? 'ElevenLabs bills your account per character.'
      : 'ElevenLabs voices run through fal (no ElevenLabs key needed), billed per character.'
  }
  return `${ENGINE_LABELS[engine]} runs on fal, billed per character. Run \`pnpm reelmakeeasy setup\` to make it free on this computer.`
}

/** The Standard clone row, from GET /api/voice-over/engines (undefined while it loads). */
export function standardCloneOption(
  engines: Pick<TtsEnginesResponse, 'standardClone'> | undefined,
): StandardCloneOption {
  const backend = engines?.standardClone
  if (backend === 'elevenlabs') return { description: 'ElevenLabs · 15 s recording' }
  if (backend === 'minimax') return { description: 'MiniMax on fal · 15 s recording' }
  if (backend === null) {
    return {
      description: 'ElevenLabs · 15 s recording',
      disabledReason: NEEDS_ELEVENLABS_KEY_LABEL,
    }
  }
  return { description: 'ElevenLabs or MiniMax · 15 s recording' }
}

/**
 * Why a voice row can't be used with the keys in .env and the generation provider: the reason
 * the API put on the row first (a keyless Gemini voice, so it is greyed out before the engines
 * report loads); a Gemini voice needs GEMINI_API_KEY (whoever makes the videos); a voice the
 * user cloned on ElevenLabs needs their own ElevenLabs account; while Gemini makes the voices, a
 * MiniMax clone runs on fal and a Qwen3 clone needs the free local voices. Undefined when it can
 * be used. Other presets are left alone: the API lists only the presets that can speak.
 */
export function voiceUnavailableReason(
  voice: Pick<VoiceOption, 'provider' | 'unavailableReason' | 'voiceCloneId'>,
  engines: EngineReportForRows | undefined,
): string | undefined {
  if (voice.unavailableReason) return voice.unavailableReason
  if (!voice.voiceCloneId && voice.provider === 'gemini') {
    return engines?.geminiKey === false ? NEEDS_GEMINI_KEY_LABEL : undefined
  }
  if (!engines || !voice.voiceCloneId) return undefined
  if (voice.provider === 'elevenlabs') {
    return engines.elevenlabsKey ? undefined : NEEDS_ELEVENLABS_KEY_LABEL
  }
  if (engines.generationProvider !== 'google') return undefined
  if (voice.provider === 'fal' || voice.provider === 'minimax') return RUNS_ON_FAL_LABEL
  if (voice.provider === 'qwen3' && engines.qwen3Clone?.available === false) {
    return engines.qwen3Clone.reason ?? 'Needs the free local voices'
  }
  return undefined
}
