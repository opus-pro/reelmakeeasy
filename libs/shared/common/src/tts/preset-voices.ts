/**
 * The preset voice list.
 *
 * - ElevenLabs premade voices: the ones any ElevenLabs plan, including the free
 *   one, can use through the API. Library voices need a paid plan, so none is
 *   offered here.
 * - Kokoro (English) and Qwen3-TTS speakers on fal. Their ids are namespaced
 *   (`kokoro-*`, `qwen3-*`) and routed by prefix (see `fal-tts.ts`).
 * - Gemini TTS prebuilt voices (`gemini-*`, see gemini-voices.ts), listed when
 *   Gemini makes the voices.
 */
import { GEMINI_PRESET_VOICES } from './gemini-voices'

export interface PresetVoice {
  description: string
  /**
   * ElevenLabs presets only: what fal's Eleven v3 `voice` field takes for this voice
   * when there's no ElevenLabs key, as checked live against fal. Absent: the voice id.
   * A name: fal refuses the id but speaks this voice by that name. null: fal can't
   * speak this voice, so without a key it's replaced with the default voice.
   */
  falVoiceName?: null | string
  id: string
  /** Locale, demographic, then free-form tags (see `buildPresetVoiceProfile`). */
  labels: string[]
  name: string
  /** Where the voice is synthesized. Absent means ElevenLabs. */
  provider?: PresetVoiceProvider
  tone: string
  /**
   * False hides the voice from pickers; saved choices still resolve. ReelMakeEasy
   * is English-only for now (caption fonts cover English only), so non-English
   * speakers are hidden until other languages land.
   */
  visible?: boolean
}

export type PresetVoiceProvider = 'elevenlabs' | 'gemini' | 'kokoro' | 'qwen3'

/** The voice used when none is chosen, and the stand-in for retired voices. */
export const DEFAULT_VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'

export const PRESET_VOICES: readonly PresetVoice[] = [
  {
    description: 'Confident, reassuring voice for promotional video.',
    id: DEFAULT_VOICE_ID,
    labels: ['English (US)', 'Female', 'Promotional video', 'Confident'],
    name: 'Sarah',
    tone: 'Confident',
  },
  {
    description: 'Knowledgeable voice for educational explainers.',
    id: 'XrExE9yKIg1WjnnlVkGX',
    labels: ['English (US)', 'Female', 'Educational explainers', 'Knowledgeable'],
    name: 'Matilda',
    tone: 'Knowledgeable',
  },
  {
    description: 'Wise, balanced voice for promotional video.',
    id: 'pqHfZKP75CvOlQylNhV4',
    labels: ['English (US)', 'Male', 'Promotional video', 'Wise'],
    name: 'Bill',
    tone: 'Wise',
  },
  {
    description: 'Smooth, trustworthy voice for thought leadership content.',
    id: 'cjVigY5qzO86Huf0OWal',
    labels: ['English (US)', 'Male', 'Thought leadership', 'Trustworthy'],
    name: 'Eric',
    tone: 'Trustworthy',
  },
  {
    description: 'Playful, bright voice for entertainment content.',
    id: 'cgSgspJ2msm6clMCkdW9',
    labels: ['English (US)', 'Female', 'Entertainment', 'Playful'],
    name: 'Jessica',
    tone: 'Playful',
  },
  {
    description: 'Energetic voice for entertainment content.',
    id: 'TX3LPaxmHKxFdv7VOQHJ',
    labels: ['English (US)', 'Male', 'Entertainment', 'Energetic'],
    name: 'Liam',
    tone: 'Energetic',
  },
  {
    description: 'Professional, bright voice for news content.',
    id: 'hpp4J3VqNfWAUOO0d1Us',
    labels: ['English (US)', 'Female', 'News', 'Professional'],
    name: 'Bella',
    tone: 'Professional',
  },
  {
    description: 'Warm, captivating voice for educational explainers.',
    id: 'JBFqnCBsd6RMkjVDRZzb',
    labels: ['English (UK)', 'Male', 'Educational explainers', 'Warm'],
    name: 'George',
    tone: 'Warm',
  },
  {
    description: 'Clear, engaging voice for educational explainers.',
    id: 'Xb7hH8MSUJpSbSDYk0k2',
    labels: ['English (UK)', 'Female', 'Educational explainers', 'Clear'],
    name: 'Alice',
    tone: 'Clear',
  },
  // Kokoro (fal), English only.
  {
    description: 'Warm, expressive voice for storytelling.',
    id: 'kokoro-af_heart',
    labels: ['English (US)', 'Female', 'Narration', 'Warm'],
    name: 'Kokoro Heart',
    provider: 'kokoro',
    tone: 'Warm',
  },
  {
    description: 'Bright, lively voice for upbeat videos.',
    id: 'kokoro-af_bella',
    labels: ['English (US)', 'Female', 'Entertainment', 'Bright'],
    name: 'Kokoro Bella',
    provider: 'kokoro',
    tone: 'Bright',
  },
  {
    description: 'Soft, close voice for calm explainers.',
    id: 'kokoro-af_nicole',
    labels: ['English (US)', 'Female', 'Conversational', 'Soft'],
    name: 'Kokoro Nicole',
    provider: 'kokoro',
    tone: 'Soft',
  },
  {
    description: 'Smooth, measured voice for narration.',
    id: 'kokoro-af_aoede',
    labels: ['English (US)', 'Female', 'Narration', 'Smooth'],
    name: 'Kokoro Aoede',
    provider: 'kokoro',
    tone: 'Smooth',
  },
  {
    description: 'Clear, steady voice for tutorials.',
    id: 'kokoro-af_kore',
    labels: ['English (US)', 'Female', 'Educational explainers', 'Clear'],
    name: 'Kokoro Kore',
    provider: 'kokoro',
    tone: 'Clear',
  },
  {
    description: 'Friendly voice for product videos.',
    id: 'kokoro-af_sarah',
    labels: ['English (US)', 'Female', 'Promotional video', 'Friendly'],
    name: 'Kokoro Sarah',
    provider: 'kokoro',
    tone: 'Friendly',
  },
  {
    description: 'Energetic voice for short social clips.',
    id: 'kokoro-af_nova',
    labels: ['English (US)', 'Female', 'Social media', 'Energetic'],
    name: 'Kokoro Nova',
    provider: 'kokoro',
    tone: 'Energetic',
  },
  {
    description: 'Youthful, airy voice for social content.',
    id: 'kokoro-af_sky',
    labels: ['English (US)', 'Female', 'Social media', 'Youthful'],
    name: 'Kokoro Sky',
    provider: 'kokoro',
    tone: 'Youthful',
  },
  {
    description: 'Neutral, even voice for general use.',
    id: 'kokoro-af_alloy',
    labels: ['English (US)', 'Female', 'Conversational', 'Neutral'],
    name: 'Kokoro Alloy',
    provider: 'kokoro',
    tone: 'Neutral',
  },
  {
    description: 'Casual, relaxed voice for vlogs.',
    id: 'kokoro-af_jessica',
    labels: ['English (US)', 'Female', 'Conversational', 'Casual'],
    name: 'Kokoro Jessica',
    provider: 'kokoro',
    tone: 'Casual',
  },
  {
    description: 'Calm voice for gentle narration.',
    id: 'kokoro-af_river',
    labels: ['English (US)', 'Female', 'Narration', 'Calm'],
    name: 'Kokoro River',
    provider: 'kokoro',
    tone: 'Calm',
  },
  {
    description: 'Deep, steady voice for narration.',
    id: 'kokoro-am_michael',
    labels: ['English (US)', 'Male', 'Narration', 'Deep'],
    name: 'Kokoro Michael',
    provider: 'kokoro',
    tone: 'Deep',
  },
  {
    description: 'Bold, dramatic voice for trailers.',
    id: 'kokoro-am_fenrir',
    labels: ['English (US)', 'Male', 'Entertainment', 'Bold'],
    name: 'Kokoro Fenrir',
    provider: 'kokoro',
    tone: 'Bold',
  },
  {
    description: 'Playful voice for fun, light content.',
    id: 'kokoro-am_puck',
    labels: ['English (US)', 'Male', 'Entertainment', 'Playful'],
    name: 'Kokoro Puck',
    provider: 'kokoro',
    tone: 'Playful',
  },
  {
    description: 'Relaxed voice for conversational videos.',
    id: 'kokoro-am_echo',
    labels: ['English (US)', 'Male', 'Conversational', 'Relaxed'],
    name: 'Kokoro Echo',
    provider: 'kokoro',
    tone: 'Relaxed',
  },
  {
    description: 'Confident voice for promotional video.',
    id: 'kokoro-am_eric',
    labels: ['English (US)', 'Male', 'Promotional video', 'Confident'],
    name: 'Kokoro Eric',
    provider: 'kokoro',
    tone: 'Confident',
  },
  {
    description: 'Upbeat voice for social clips.',
    id: 'kokoro-am_liam',
    labels: ['English (US)', 'Male', 'Social media', 'Upbeat'],
    name: 'Kokoro Liam',
    provider: 'kokoro',
    tone: 'Upbeat',
  },
  {
    description: 'Low, authoritative voice for serious topics.',
    id: 'kokoro-am_onyx',
    labels: ['English (US)', 'Male', 'Thought leadership', 'Authoritative'],
    name: 'Kokoro Onyx',
    provider: 'kokoro',
    tone: 'Authoritative',
  },
  {
    description: 'Plain, direct voice for explainers.',
    id: 'kokoro-am_adam',
    labels: ['English (US)', 'Male', 'Educational explainers', 'Plain'],
    name: 'Kokoro Adam',
    provider: 'kokoro',
    tone: 'Plain',
  },
  {
    description: 'Jolly, festive character voice.',
    id: 'kokoro-am_santa',
    labels: ['English (US)', 'Male', 'Entertainment', 'Jolly'],
    name: 'Kokoro Santa',
    provider: 'kokoro',
    tone: 'Jolly',
  },
  {
    description: 'Elegant British voice for narration.',
    id: 'kokoro-bf_emma',
    labels: ['English (UK)', 'Female', 'Narration', 'Elegant'],
    name: 'Kokoro Emma',
    provider: 'kokoro',
    tone: 'Elegant',
  },
  {
    description: 'Polished British voice for brand videos.',
    id: 'kokoro-bf_isabella',
    labels: ['English (UK)', 'Female', 'Promotional video', 'Polished'],
    name: 'Kokoro Isabella',
    provider: 'kokoro',
    tone: 'Polished',
  },
  {
    description: 'Crisp British voice for explainers.',
    id: 'kokoro-bf_alice',
    labels: ['English (UK)', 'Female', 'Educational explainers', 'Crisp'],
    name: 'Kokoro Alice',
    provider: 'kokoro',
    tone: 'Crisp',
  },
  {
    description: 'Gentle British voice for calm content.',
    id: 'kokoro-bf_lily',
    labels: ['English (UK)', 'Female', 'Conversational', 'Gentle'],
    name: 'Kokoro Lily',
    provider: 'kokoro',
    tone: 'Gentle',
  },
  {
    description: 'Classic British narrator voice.',
    id: 'kokoro-bm_george',
    labels: ['English (UK)', 'Male', 'Narration', 'Classic'],
    name: 'Kokoro George',
    provider: 'kokoro',
    tone: 'Classic',
  },
  {
    description: 'Storyteller British voice for tales.',
    id: 'kokoro-bm_fable',
    labels: ['English (UK)', 'Male', 'Entertainment', 'Storyteller'],
    name: 'Kokoro Fable',
    provider: 'kokoro',
    tone: 'Storyteller',
  },
  {
    description: 'Measured British voice for insight pieces.',
    id: 'kokoro-bm_lewis',
    labels: ['English (UK)', 'Male', 'Thought leadership', 'Measured'],
    name: 'Kokoro Lewis',
    provider: 'kokoro',
    tone: 'Measured',
  },
  {
    description: 'Professional British voice for news.',
    id: 'kokoro-bm_daniel',
    labels: ['English (UK)', 'Male', 'News', 'Professional'],
    name: 'Kokoro Daniel',
    provider: 'kokoro',
    tone: 'Professional',
  },
  // Qwen3-TTS preset speakers (local, else fal). Only the native English speakers
  // are shown while ReelMakeEasy is English-only; the rest stay for later.
  {
    description: 'Bright, lively young voice. Speaks 10 languages.',
    id: 'qwen3-vivian',
    labels: ['Chinese', 'Female', 'Social media', 'Bright'],
    name: 'Qwen Vivian',
    provider: 'qwen3',
    tone: 'Bright',
    visible: false,
  },
  {
    description: 'Warm, gentle young voice. Speaks 10 languages.',
    id: 'qwen3-serena',
    labels: ['Chinese', 'Female', 'Narration', 'Gentle'],
    name: 'Qwen Serena',
    provider: 'qwen3',
    tone: 'Gentle',
    visible: false,
  },
  {
    description: 'Seasoned, low and mellow voice. Speaks 10 languages.',
    id: 'qwen3-uncle_fu',
    labels: ['Chinese', 'Male', 'Narration', 'Mellow'],
    name: 'Qwen Uncle Fu',
    provider: 'qwen3',
    tone: 'Mellow',
    visible: false,
  },
  {
    description: 'Youthful Beijing voice. Speaks 10 languages.',
    id: 'qwen3-dylan',
    labels: ['Chinese', 'Male', 'Conversational', 'Youthful'],
    name: 'Qwen Dylan',
    provider: 'qwen3',
    tone: 'Youthful',
    visible: false,
  },
  {
    description: 'Lively Chengdu voice. Speaks 10 languages.',
    id: 'qwen3-eric',
    labels: ['Chinese', 'Male', 'Entertainment', 'Lively'],
    name: 'Qwen Eric',
    provider: 'qwen3',
    tone: 'Lively',
    visible: false,
  },
  {
    description: 'Dynamic voice with strong rhythm.',
    id: 'qwen3-ryan',
    labels: ['English (US)', 'Male', 'Promotional video', 'Dynamic'],
    name: 'Qwen Ryan',
    provider: 'qwen3',
    tone: 'Dynamic',
  },
  {
    description: 'Sunny, clear American voice.',
    id: 'qwen3-aiden',
    labels: ['English (US)', 'Male', 'Conversational', 'Sunny'],
    name: 'Qwen Aiden',
    provider: 'qwen3',
    tone: 'Sunny',
  },
  {
    description: 'Playful, light Japanese voice. Speaks 10 languages.',
    id: 'qwen3-ono_anna',
    labels: ['Japanese', 'Female', 'Entertainment', 'Playful'],
    name: 'Qwen Ono Anna',
    provider: 'qwen3',
    tone: 'Playful',
    visible: false,
  },
  {
    description: 'Warm, expressive Korean voice. Speaks 10 languages.',
    id: 'qwen3-sohee',
    labels: ['Korean', 'Female', 'Narration', 'Warm'],
    name: 'Qwen Sohee',
    provider: 'qwen3',
    tone: 'Warm',
    visible: false,
  },
  ...GEMINI_PRESET_VOICES,
]

const PRESET_VOICE_IDS = new Set(PRESET_VOICES.map((voice) => voice.id))

/**
 * What fal's Eleven v3 `voice` field takes for an ElevenLabs preset (used without
 * ELEVENLABS_API_KEY): its `falVoiceName` when set, else its id. null for ids that
 * aren't ElevenLabs presets, and for presets fal can't speak.
 */
export function falElevenLabsVoice(voiceId: string): null | string {
  const voice = PRESET_VOICES.find((preset) => preset.id === voiceId)
  if (!voice || (voice.provider ?? 'elevenlabs') !== 'elevenlabs') return null
  return voice.falVoiceName === undefined ? voice.id : voice.falVoiceName
}

export function isPresetVoiceId(voiceId: string): boolean {
  return PRESET_VOICE_IDS.has(voiceId)
}

/** Where a preset voice is synthesized, or undefined for non-preset ids. */
export function presetVoiceProvider(voiceId: string): PresetVoiceProvider | undefined {
  if (!PRESET_VOICE_IDS.has(voiceId)) return undefined
  return PRESET_VOICES.find((voice) => voice.id === voiceId)?.provider ?? 'elevenlabs'
}
