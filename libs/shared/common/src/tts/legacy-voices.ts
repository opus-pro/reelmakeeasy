/**
 * Voice ids that are no longer offered, kept only so existing projects that
 * picked one still render. Every one of them is synthesized with the default
 * ElevenLabs preset voice instead.
 */

/** The MiniMax presets, and the ElevenLabs library voice, that used to be in the voice list. */
export const LEGACY_PRESET_VOICE_IDS: readonly string[] = [
  'English_captivating_female1',
  'English_compelling_lady1',
  'English_expressive_narrator',
  'English_Insightful_Speaker',
  'English_magnetic_voiced_man',
  'English_Persuasive_Man',
  'English_Sharp_Commentator',
  // Brittney: an ElevenLabs library voice, which free plans cannot use through the API.
  'kPzsL2i3teMYv0FxEYQ6',
]

/** The Gemini TTS presets that used to be in the voice list. */
export const LEGACY_GEMINI_PRESET_VOICE_IDS: readonly string[] = [
  'Algenib',
  'Alnilam',
  'Aoede',
  'Callirrhoe',
  'Despina',
  'Enceladus',
  'Erinome',
  'Gacrux',
  'Kore',
  'Leda',
  'Orus',
  'Rasalgethi',
  'Zubenelgenubi',
]

/** The BytePlus Seed Audio presets that used to be in the voice list. */
export const LEGACY_BYTEPLUS_PRESET_VOICE_IDS: readonly string[] = [
  'en_male_tim_uranus_bigtts',
  'zh_female_vv_uranus_bigtts',
  'zh_female_xiaohe_uranus_bigtts',
  'zh_male_shaonianzixin_uranus_bigtts',
  'es_female_ht_mx_f6_uranus_bigtts',
  'mx_male_felipe_uranus_bigtts',
  'pt_female_bv530_uranus_bigtts',
  'pt_male_martins_uranus_bigtts',
  'fr_female_fr_f47_uranus_bigtts',
  'de_male_sven_uranus_bigtts',
  'ar_female_dina_uranus_bigtts',
  'ru_male_pavel_uranus_bigtts',
  'it_male_enzo_uranus_bigtts',
  'id_male_han_uranus_bigtts',
]

const LEGACY_PRESET_SET = new Set(LEGACY_PRESET_VOICE_IDS)
const GEMINI_PRESET_SET = new Set(LEGACY_GEMINI_PRESET_VOICE_IDS)
const BYTEPLUS_PRESET_SET = new Set(LEGACY_BYTEPLUS_PRESET_VOICE_IDS)
const BYTEPLUS_REFERENCE_PREFIX = 'byteplus-reference-'

export function isBytePlusPresetVoiceId(voiceId: string): boolean {
  return BYTEPLUS_PRESET_SET.has(voiceId)
}

export function isGeminiPresetVoiceId(voiceId: string): boolean {
  return GEMINI_PRESET_SET.has(voiceId)
}

/** A locally minted id for a retired BytePlus zero-shot clone. */
export function isBytePlusReferenceVoiceId(voiceId: string): boolean {
  return voiceId.startsWith(BYTEPLUS_REFERENCE_PREFIX)
}

/** Any retired voice id, which renders as the default preset voice. */
export function isRetiredVoiceId(voiceId: string): boolean {
  return (
    LEGACY_PRESET_SET.has(voiceId) ||
    isGeminiPresetVoiceId(voiceId) ||
    isBytePlusPresetVoiceId(voiceId) ||
    isBytePlusReferenceVoiceId(voiceId)
  )
}
