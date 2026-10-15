import { LanguageBoost } from './minimax-text'

export interface VoiceLanguageConfig {
  languageBoost: LanguageBoost
  previewText: string
}

/**
 * Outcome of classifying a voice-clone sample's language:
 * - supported:   MiniMax can clone this language; `config` carries the boost + preview text.
 * - undetected:  ASR returned no code (or failed); falls back to the English `config`.
 * - unsupported: a real language was detected, but MiniMax has no language_boost for it.
 */
export type VoiceLanguageDetection =
  | { config: VoiceLanguageConfig; kind: 'supported'; langCode: string }
  | { config: VoiceLanguageConfig; kind: 'undetected' }
  | { kind: 'unsupported'; langCode: string }

// Maps ISO 639-3 language codes (returned by ElevenLabs scribe_v2) to MiniMax voice-clone config.
// Covers MiniMax's language_boost set except Nynorsk, which scribe collapses into 'nor'.
// spellchecker: off
export const LANGUAGE_CODE_TO_CONFIG: Record<string, VoiceLanguageConfig> = {
  afr: {
    languageBoost: 'Afrikaans',
    previewText: 'Dít is hoe jou gekloonde stem klink. Ek kan natuurlik en ekspressief praat.',
  },
  ara: {
    languageBoost: 'Arabic',
    previewText: 'هذا هو صوتك المُستنسخ. يمكنني التحدث بأسلوب طبيعي ومُعبّر.',
  },
  bul: {
    languageBoost: 'Bulgarian',
    previewText: 'Това е вашият клониран глас. Мога да говоря естествено и изразително.',
  },
  cat: {
    languageBoost: 'Catalan',
    previewText: 'Així sona la teva veu clonada. Puc parlar de manera natural i expressiva.',
  },
  ces: {
    languageBoost: 'Czech',
    previewText: 'Takto zní váš naklonovaný hlas. Dokážu mluvit přirozeně a výrazně.',
  },
  dan: {
    languageBoost: 'Danish',
    previewText: 'Sådan lyder din klonede stemme. Jeg kan tale naturligt og udtryksfuldt.',
  },
  deu: {
    languageBoost: 'German',
    previewText: 'So klingt deine geklonte Stimme. Ich kann natürlich und ausdrucksstark sprechen.',
  },
  ell: {
    languageBoost: 'Greek',
    previewText: 'Αυτή είναι η κλωνοποιημένη φωνή σας. Μπορώ να μιλώ φυσικά και εκφραστικά.',
  },
  eng: {
    languageBoost: 'English',
    previewText:
      "This is how your voice will sound. I can speak naturally and expressively with your unique tone and style. Whether you're creating videos for social media, presentations, or storytelling, this preview demonstrates the clarity, emotion, and authenticity of your cloned voice across different phrases and contexts.",
  },
  fas: {
    languageBoost: 'Persian',
    previewText: 'این صدای شبیه‌سازی‌شده شماست. من می‌توانم طبیعی و رسا صحبت کنم.',
  },
  fil: {
    languageBoost: 'Filipino',
    previewText:
      'Ito ang tunog ng iyong na-clone na boses. Nakakapagsalita ako nang natural at may damdamin.',
  },
  fin: {
    languageBoost: 'Finnish',
    previewText: 'Tältä kuulostaa kloonattu äänesi. Voin puhua luonnollisesti ja ilmeikkäästi.',
  },
  fra: {
    languageBoost: 'French',
    previewText:
      'Voici comment sonne votre voix clonée. Je peux parler de façon naturelle et expressive.',
  },
  heb: {
    languageBoost: 'Hebrew',
    previewText: 'זהו הקול המשובט שלך. אני יכול לדבר בצורה טבעית ומלאת הבעה.',
  },
  hin: {
    languageBoost: 'Hindi',
    previewText: 'यह आपकी क्लोन आवाज़ है। मैं आपके अनोखे लहजे में स्वाभाविक रूप से बोल सकता हूँ।',
  },
  hrv: {
    languageBoost: 'Croatian',
    previewText: 'Ovako zvuči vaš klonirani glas. Mogu govoriti prirodno i izražajno.',
  },
  hun: {
    languageBoost: 'Hungarian',
    previewText: 'Így hangzik a klónozott hangod. Természetesen és kifejezően tudok beszélni.',
  },
  ind: {
    languageBoost: 'Indonesian',
    previewText:
      'Beginilah suara klon Anda terdengar. Saya dapat berbicara dengan cara yang alami dan ekspresif.',
  },
  ita: {
    languageBoost: 'Italian',
    previewText:
      'Ecco come suona la tua voce clonata. Posso parlare in modo naturale ed espressivo.',
  },
  jpn: {
    languageBoost: 'Japanese',
    previewText: 'これがあなたのクローン音声です。あなた独自の音色で自然に話すことができます。',
  },
  kor: {
    languageBoost: 'Korean',
    previewText: '이것이 당신의 클론 목소리입니다. 당신만의 음색으로 자연스럽게 말할 수 있습니다.',
  },
  msa: {
    languageBoost: 'Malay',
    previewText:
      'Beginilah bunyi suara klon anda. Saya boleh bercakap secara semula jadi dan ekspresif.',
  },
  nld: {
    languageBoost: 'Dutch',
    previewText:
      'Dit is hoe jouw gekloonde stem klinkt. Ik kan op een natuurlijke en expressieve manier spreken.',
  },
  nor: {
    languageBoost: 'Norwegian',
    previewText: 'Slik høres den klonede stemmen din ut. Jeg kan snakke naturlig og uttrykksfullt.',
  },
  pol: {
    languageBoost: 'Polish',
    previewText: 'Tak brzmi twój sklonowany głos. Mogę mówić w naturalny i ekspresyjny sposób.',
  },
  por: {
    languageBoost: 'Portuguese',
    previewText: 'Assim soa a sua voz clonada. Posso falar de forma natural e expressiva.',
  },
  ron: {
    languageBoost: 'Romanian',
    previewText: 'Aceasta este vocea ta clonată. Pot vorbi natural și expresiv.',
  },
  rus: {
    languageBoost: 'Russian',
    previewText: 'Так звучит ваш клонированный голос. Я могу говорить естественно и выразительно.',
  },
  slk: {
    languageBoost: 'Slovak',
    previewText: 'Takto znie váš naklonovaný hlas. Dokážem hovoriť prirodzene a výrazne.',
  },
  slv: {
    languageBoost: 'Slovenian',
    previewText: 'Tako zveni vaš klonirani glas. Govorim lahko naravno in izrazno.',
  },
  spa: {
    languageBoost: 'Spanish',
    previewText: 'Así suena tu voz clonada. Puedo hablar de manera natural y expresiva.',
  },
  swe: {
    languageBoost: 'Swedish',
    previewText: 'Så här låter din klonade röst. Jag kan tala naturligt och uttrycksfullt.',
  },
  tam: {
    languageBoost: 'Tamil',
    previewText: 'இது உங்கள் குரலின் நகல். நான் இயல்பாகவும் உணர்ச்சிபூர்வமாகவும் பேச முடியும்.',
  },
  tha: {
    languageBoost: 'Thai',
    previewText: 'นี่คือเสียงโคลนของคุณ ฉันสามารถพูดได้อย่างเป็นธรรมชาติและมีการแสดงออก',
  },
  tur: {
    languageBoost: 'Turkish',
    previewText: 'Klonlanmış sesiniz böyle duyuluyor. Doğal ve ifadeli bir şekilde konuşabilirim.',
  },
  ukr: {
    languageBoost: 'Ukrainian',
    previewText: 'Це ваш клонований голос. Я можу говорити природно та виразно.',
  },
  vie: {
    languageBoost: 'Vietnamese',
    previewText:
      'Đây là giọng nói được nhân bản của bạn. Tôi có thể nói một cách tự nhiên và biểu cảm.',
  },
  yue: {
    languageBoost: 'Chinese,Yue',
    previewText: '呢個係您嘅聲音克隆效果。我可以自然流暢地用您獨特嘅音色講嘢。',
  },
  zho: {
    languageBoost: 'Chinese',
    previewText: '这是您的声音克隆效果。我可以自然流畅地用您独特的音色说话。',
  },
}
// spellchecker: on

// BCP-47 primary subtags (ISO 639-1) -> the ISO 639-3 keys used by
// LANGUAGE_CODE_TO_CONFIG. Normalization only: the boost VALUES stay defined once,
// in the map above. The voice-clone flow keys off ASR (639-3) directly; the
// voice-preview flow keys off the planner's `script_language` (BCP-47), so it needs
// this bridge. Covers the same language set as the map.
// Exported for the drift-guard test that pins this in sync with LANGUAGE_CODE_TO_CONFIG.
// spellchecker: off
export const BCP47_PRIMARY_TO_ISO_639_3: Record<string, string> = {
  af: 'afr',
  ar: 'ara',
  bg: 'bul',
  ca: 'cat',
  cs: 'ces',
  da: 'dan',
  de: 'deu',
  el: 'ell',
  en: 'eng',
  es: 'spa',
  fa: 'fas',
  fi: 'fin',
  fil: 'fil',
  fr: 'fra',
  he: 'heb',
  hi: 'hin',
  hr: 'hrv',
  hu: 'hun',
  id: 'ind',
  it: 'ita',
  ja: 'jpn',
  ko: 'kor',
  ms: 'msa',
  nb: 'nor',
  nl: 'nld',
  nn: 'nor',
  no: 'nor',
  pl: 'pol',
  pt: 'por',
  ro: 'ron',
  ru: 'rus',
  sk: 'slk',
  sl: 'slv',
  sv: 'swe',
  ta: 'tam',
  th: 'tha',
  tl: 'fil',
  tr: 'tur',
  uk: 'ukr',
  vi: 'vie',
  zh: 'zho',
}
// spellchecker: on

/**
 * Resolves the planner's `script_language` (a BCP-47 tag like "en", "pt-BR",
 * "zh-HK") to a MiniMax `language_boost`, reusing LANGUAGE_CODE_TO_CONFIG as the
 * single source of truth. Returns undefined for empty/unrecognized tags so callers
 * omit the boost and fall back to MiniMax auto-detection. Cantonese is matched via
 * the `yue` primary subtag or a `zh-HK` / `zh-yue` region. Without a
 * boost, MiniMax reads bare-digit years (e.g. 1930) in the wrong locale.
 */
export function resolveLanguageBoostFromScriptLanguage(
  scriptLanguage: string | undefined,
): LanguageBoost | undefined {
  const normalized = scriptLanguage?.trim().toLowerCase()
  if (!normalized) {
    return undefined
  }
  const [primary, region] = normalized.split('-')
  if (primary === 'yue' || (primary === 'zh' && (region === 'hk' || region === 'yue'))) {
    return LANGUAGE_CODE_TO_CONFIG['yue']?.languageBoost
  }
  const iso6393 = primary.length === 3 ? primary : BCP47_PRIMARY_TO_ISO_639_3[primary]
  return iso6393 ? LANGUAGE_CODE_TO_CONFIG[iso6393]?.languageBoost : undefined
}

/**
 * Can MiniMax render this script language?
 *
 * MiniMax only speaks a language properly when we can hand it a `language_boost`; without
 * one it auto-detects against the voice's own locale, and for a script it has no model for
 * it reads recognizable digits aloud in English and then degenerates (a Burmese
 * script became 153.6s of English number-reading, a Tigrinya one 271.8s).
 *
 * A **missing or blank** tag counts as supported on purpose: callers use this to divert away
 * from MiniMax, and diverting on "the planner gave us nothing" would change routing for every
 * untagged script.
 *
 * Any **present** tag with no boost returns false, including one this codebase does not
 * recognize at all. That is deliberate and not distinguishable here: `BCP47_PRIMARY_TO_ISO_639_3`
 * IS the recognized set, so "unrecognized tag" and "known language MiniMax cannot serve" are the
 * same condition -- there is no universal language list to separate them against. Diverting is
 * the behaviour we want for the real cases (`my`, `ti`, `bn`, ...), and for a malformed tag
 * MiniMax would get no boost either way.
 */
export function isMiniMaxSupportedScriptLanguage(scriptLanguage: string | undefined): boolean {
  if (!scriptLanguage?.trim()) {
    return true
  }
  return resolveLanguageBoostFromScriptLanguage(scriptLanguage) !== undefined
}

/**
 * The `language_boost` values fal's hosted MiniMax accepts. Transcribed from the fal client's
 * generated types for the sibling endpoints (`MinimaxSpeech02HdInput` /
 * `MinimaxSpeech02TurboInput` in `@fal-ai/client`); `speech-2.8-hd`, the endpoint the app
 * actually calls, has no generated type but shares the schema. Anything outside this set is a 422.
 */
const FAL_LANGUAGE_BOOSTS: ReadonlySet<LanguageBoost> = new Set([
  'Arabic',
  'auto',
  'Chinese',
  'Chinese,Yue',
  'Czech',
  'Dutch',
  'English',
  'Finnish',
  'French',
  'German',
  'Greek',
  'Hindi',
  'Indonesian',
  'Italian',
  'Japanese',
  'Korean',
  'Polish',
  'Portuguese',
  'Romanian',
  'Russian',
  'Spanish',
  'Thai',
  'Turkish',
  'Ukrainian',
  'Vietnamese',
])

/**
 * Can fal's hosted MiniMax be asked for this `language_boost`? An absent boost is supported:
 * the field is then omitted and fal auto-detects, which it accepts.
 */
export function isFalSupportedLanguageBoost(boost: LanguageBoost | undefined): boolean {
  return boost === undefined || FAL_LANGUAGE_BOOSTS.has(boost)
}

/**
 * Can fal's hosted MiniMax render this script language? Same semantics as
 * `isMiniMaxSupportedScriptLanguage` (missing or blank counts as supported so untagged scripts
 * keep their routing), against fal's much narrower enum.
 */
export function isFalSupportedScriptLanguage(scriptLanguage: string | undefined): boolean {
  if (!scriptLanguage?.trim()) {
    return true
  }
  const boost = resolveLanguageBoostFromScriptLanguage(scriptLanguage)
  return boost !== undefined && isFalSupportedLanguageBoost(boost)
}

export const DEFAULT_LANGUAGE_CONFIG: VoiceLanguageConfig = {
  languageBoost: 'English',
  previewText:
    "This is how your voice will sound. I can speak naturally and expressively with your unique tone and style. Whether you're creating videos for social media, presentations, or storytelling, this preview demonstrates the clarity, emotion, and authenticity of your cloned voice across different phrases and contexts.",
}

/**
 * Classifies an ASR language code against MiniMax's voice-clone support.
 * Pure (no I/O) so the supported / unsupported / undetected branching is unit-testable
 * without mocking ASR.
 */
export function classifyLanguageCode(langCode: string | undefined): VoiceLanguageDetection {
  const normalized = langCode?.toLowerCase()
  if (!normalized) {
    return { config: DEFAULT_LANGUAGE_CONFIG, kind: 'undetected' }
  }
  const config = LANGUAGE_CODE_TO_CONFIG[normalized]
  if (config) {
    return { config, kind: 'supported', langCode: normalized }
  }
  return { kind: 'unsupported', langCode: normalized }
}
