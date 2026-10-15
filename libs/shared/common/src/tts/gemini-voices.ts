/**
 * Gemini TTS prebuilt voices, offered when Gemini (google) makes the voices.
 * Ids are namespaced (`gemini-kore`) so they never collide with the retired
 * bare Gemini names in legacy-voices.ts. Browser-safe data. Genders were checked
 * against the Gemini API voice list (`GET /v1beta/voices`) when the previews
 * were made; tones are Google's.
 */
import type { PresetVoice } from './preset-voices'

export const GEMINI_VOICE_PREFIX = 'gemini-'

/** The voice used on Gemini when none is chosen (the owner picked Achernar by ear from the previews). */
export const GEMINI_DEFAULT_VOICE_ID = 'gemini-achernar'

interface GeminiVoice {
  description: string
  gender: 'Female' | 'Male'
  name: string
  tone: string
}

const GEMINI_VOICES: readonly GeminiVoice[] = [
  { description: 'Bright, lively voice.', gender: 'Female', name: 'Zephyr', tone: 'Bright' },
  { description: 'Upbeat, friendly voice.', gender: 'Male', name: 'Puck', tone: 'Upbeat' },
  {
    description: 'Calm voice that explains clearly.',
    gender: 'Male',
    name: 'Charon',
    tone: 'Informative',
  },
  {
    description: 'Firm, confident voice for promotional video.',
    gender: 'Female',
    name: 'Kore',
    tone: 'Firm',
  },
  { description: 'Excited, energetic voice.', gender: 'Male', name: 'Fenrir', tone: 'Excitable' },
  { description: 'Young, light voice.', gender: 'Female', name: 'Leda', tone: 'Youthful' },
  { description: 'Firm, steady voice.', gender: 'Male', name: 'Orus', tone: 'Firm' },
  { description: 'Breezy, relaxed voice.', gender: 'Female', name: 'Aoede', tone: 'Breezy' },
  {
    description: 'Easy-going, chatty voice.',
    gender: 'Female',
    name: 'Callirrhoe',
    tone: 'Easy-going',
  },
  { description: 'Bright, clear voice.', gender: 'Female', name: 'Autonoe', tone: 'Bright' },
  { description: 'Soft, breathy voice.', gender: 'Male', name: 'Enceladus', tone: 'Breathy' },
  { description: 'Clear, even voice.', gender: 'Male', name: 'Iapetus', tone: 'Clear' },
  { description: 'Easy-going, warm voice.', gender: 'Male', name: 'Umbriel', tone: 'Easy-going' },
  { description: 'Smooth, polished voice.', gender: 'Male', name: 'Algieba', tone: 'Smooth' },
  { description: 'Smooth, polished voice.', gender: 'Female', name: 'Despina', tone: 'Smooth' },
  { description: 'Clear, precise voice.', gender: 'Female', name: 'Erinome', tone: 'Clear' },
  { description: 'Gravelly, textured voice.', gender: 'Male', name: 'Algenib', tone: 'Gravelly' },
  {
    description: 'Professional voice that explains clearly.',
    gender: 'Male',
    name: 'Rasalgethi',
    tone: 'Informative',
  },
  { description: 'Upbeat, cheerful voice.', gender: 'Female', name: 'Laomedeia', tone: 'Upbeat' },
  { description: 'Soft, gentle voice.', gender: 'Female', name: 'Achernar', tone: 'Soft' },
  { description: 'Firm, assured voice.', gender: 'Male', name: 'Alnilam', tone: 'Firm' },
  { description: 'Even, balanced voice.', gender: 'Male', name: 'Schedar', tone: 'Even' },
  { description: 'Mature, grounded voice.', gender: 'Female', name: 'Gacrux', tone: 'Mature' },
  { description: 'Direct, forward voice.', gender: 'Female', name: 'Pulcherrima', tone: 'Forward' },
  {
    description: 'Friendly, approachable voice.',
    gender: 'Male',
    name: 'Achird',
    tone: 'Friendly',
  },
  {
    description: 'Casual, laid-back voice.',
    gender: 'Male',
    name: 'Zubenelgenubi',
    tone: 'Casual',
  },
  { description: 'Gentle, kind voice.', gender: 'Female', name: 'Vindemiatrix', tone: 'Gentle' },
  { description: 'Lively, animated voice.', gender: 'Male', name: 'Sadachbia', tone: 'Lively' },
  {
    description: 'Knowledgeable, assured voice.',
    gender: 'Male',
    name: 'Sadaltager',
    tone: 'Knowledgeable',
  },
  { description: 'Warm, welcoming voice.', gender: 'Female', name: 'Sulafat', tone: 'Warm' },
]

const idOf = (voice: GeminiVoice): string => `${GEMINI_VOICE_PREFIX}${voice.name.toLowerCase()}`

export const GEMINI_PRESET_VOICES: readonly PresetVoice[] = GEMINI_VOICES.map((voice) => ({
  description: voice.description,
  id: idOf(voice),
  labels: ['English (US)', voice.gender, 'Narration', voice.tone],
  name: `Gemini ${voice.name}`,
  provider: 'gemini',
  tone: voice.tone,
}))

const NAMES = new Map(GEMINI_VOICES.map((voice) => [idOf(voice), voice.name]))

/** The preset id (`gemini-leda`) for a retired bare Gemini name (`Leda`), or null. */
export function geminiPresetIdForLegacyName(name: string): null | string {
  const id = `${GEMINI_VOICE_PREFIX}${name.toLowerCase()}`
  return NAMES.has(id) ? id : null
}

/** The Gemini prebuilt voice name (`Kore`) for a preset id (`gemini-kore`), or null. */
export function geminiVoiceName(voiceId: string): null | string {
  return NAMES.get(voiceId) ?? null
}

export const isGeminiVoiceId = (voiceId: string): boolean => NAMES.has(voiceId)
