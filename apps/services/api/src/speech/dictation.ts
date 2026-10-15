import type {
  DictationEngine,
  DictationSetting,
  DictationStatus,
  SetupOption,
} from '@shared/types/api/setup'

/** What decides which engines voice typing can use. */
export interface DictationInputs {
  keys: { fal: boolean; gemini: boolean }
  /** The local voice server's Whisper: null when the server isn't running. */
  local: null | { device: string; transcribe: boolean }
  /** `LOCAL_ASR=off` in .env. */
  localAsrOff: boolean
  setting: DictationSetting
}

/** The order `auto` tries them in, and the order Setup lists them. */
export const DICTATION_ENGINES: readonly DictationEngine[] = ['gemini', 'local', 'fal', 'browser']

export const DICTATION_LABEL: Record<DictationEngine, string> = {
  browser: 'Your browser',
  fal: 'fal (ElevenLabs Scribe)',
  gemini: 'Gemini',
  local: 'Whisper on this computer',
}

/** Whisper on a CPU runs the smaller model and takes several seconds: `auto` skips it. */
const isSlowLocal = (local: DictationInputs['local']): boolean => local?.device === 'cpu'

function option(engine: DictationEngine, inputs: DictationInputs): SetupOption<DictationEngine> {
  const base = { id: engine, label: DICTATION_LABEL[engine] }
  switch (engine) {
    case 'browser': {
      return { ...base, available: true }
    }
    case 'fal': {
      return inputs.keys.fal
        ? { ...base, available: true }
        : { ...base, available: false, reason: 'Add FAL_KEY to .env' }
    }
    case 'gemini': {
      return inputs.keys.gemini
        ? { ...base, available: true }
        : { ...base, available: false, reason: 'Add GEMINI_API_KEY to .env' }
    }
    case 'local': {
      if (inputs.localAsrOff)
        return { ...base, available: false, reason: 'LOCAL_ASR is off in .env' }
      if (!inputs.local) {
        return { ...base, available: false, reason: "The local voice server isn't running" }
      }
      if (!inputs.local.transcribe) {
        return {
          ...base,
          available: false,
          reason: "Local caption timing isn't installed: run `pnpm reelmakeeasy setup`",
        }
      }
      return { ...base, available: true }
    }
  }
}

/** Every engine with whether it can be used here and, if not, why. */
export function dictationOptions(inputs: DictationInputs): SetupOption<DictationEngine>[] {
  return DICTATION_ENGINES.map((engine) => option(engine, inputs))
}

/**
 * The engine voice typing uses. `auto` takes the first available of Gemini, Whisper on a fast
 * machine (Apple Silicon or NVIDIA), fal, then the browser. A chosen engine is used only when
 * it's available: null otherwise, never another one. `off` is null.
 */
export function dictationEngine(inputs: DictationInputs): DictationEngine | null {
  const options = dictationOptions(inputs)
  const available = (engine: DictationEngine) =>
    options.find((o) => o.id === engine)?.available === true
  if (inputs.setting === 'off') return null
  if (inputs.setting !== 'auto') return available(inputs.setting) ? inputs.setting : null
  for (const engine of DICTATION_ENGINES) {
    if (engine === 'local' && isSlowLocal(inputs.local)) continue
    if (available(engine)) return engine
  }
  return 'browser'
}

export function dictationStatus(inputs: DictationInputs): DictationStatus {
  return {
    engine: dictationEngine(inputs),
    options: dictationOptions(inputs),
    setting: inputs.setting,
  }
}
