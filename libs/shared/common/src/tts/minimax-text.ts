/**
 * Pure MiniMax speech helpers: text preprocessing, the T2A payload builder and
 * output-path routing. No network calls live here. Synthesis goes through fal's
 * hosted MiniMax (`fal-minimax.ts`), which reuses these builders verbatim so the
 * request matches what MiniMax itself expects.
 */
import { join } from 'node:path'

import { z } from 'zod'

import { completion } from '../llm'
import { logger } from '../logger'
import { ensureError } from '../utils/error-handler'
import { typedPathResolver } from '../utils/path-resolver'

// Define the response schema for text preprocessing
const TextPreprocessingSchema = z.string()

export const DEFAULT_VOICE_MODEL = 'speech-2.6-hd'

/** Model used when new_voice_model_minimax feature gate is enabled */
export const NEW_VOICE_MODEL = 'speech-2.8-hd'

/**

 * Built-in pronunciation dict entries (always sent to MiniMax TTS). Format: "Word/pronunciation".
 *
 * Shared with the fal-hosted client so every request carries the same dictionary; fal
 * spells the wrapper key `tone_list` rather than `tone`.
 */
export const BUILTIN_PRONUNCIATION_DICT: string[] = [
  'PDF/pdf',
  'PDFs/pdfs',
  'API/api',
  'CEO/ceo',
  'URL/url',
  'GOAT/goat',

  'ASAP/As soon as possible',
  'Omg/Oh my god',
  'omg/Oh my god',
  'ICE/ice',
  'FOMO/Fomo',
  // "NASA/Nasa",
  'JPEG/jay-peg',
  // "NATO/naydough",
  'NLP/nlp',
  'SaaS/Sass',
  'FAQ/FAQ',
  'BTW/By the way',
  'ETA/ETA',
  'TBD/tbd',
  'DIY/diy',
  'TL;DR/tldr',
  'IRL/irl',
  'NFL/nfl',
  'FIFA/Feefa',
  'US/U-S',
  'SQL/Sequel',
]

// Available TTS models
export type TTSModel =
  | 'speech-01-hd'
  | 'speech-01-turbo'
  | 'speech-02-hd'
  | 'speech-02-turbo'
  | 'speech-2.6-hd'
  | 'speech-2.6-turbo'
  | 'speech-2.8-hd'

// Supported values for language_boost (MiniMax official T2A set).
export type LanguageBoost =
  | 'Afrikaans'
  | 'Arabic'
  | 'auto'
  | 'Bulgarian'
  | 'Catalan'
  | 'Chinese'
  | 'Chinese,Yue'
  | 'Croatian'
  | 'Czech'
  | 'Danish'
  | 'Dutch'
  | 'English'
  | 'Filipino'
  | 'Finnish'
  | 'French'
  | 'German'
  | 'Greek'
  | 'Hebrew'
  | 'Hindi'
  | 'Hungarian'
  | 'Indonesian'
  | 'Italian'
  | 'Japanese'
  | 'Korean'
  | 'Malay'
  | 'Norwegian'
  | 'Nynorsk'
  | 'Persian'
  | 'Polish'
  | 'Portuguese'
  | 'Romanian'
  | 'Russian'
  | 'Slovak'
  | 'Slovenian'
  | 'Spanish'
  | 'Swedish'
  | 'Tamil'
  | 'Thai'
  | 'Turkish'
  | 'Ukrainian'
  | 'Vietnamese'

export interface TTSOptions {
  /**
   * Project to attribute this generation's spend to, for callers that
   * must NOT take `projectId`'s storage routing. Cost attribution only -- it never
   * affects the output path. A fallback, not an override: when `projectId` is also
   * set it wins, so spend is never attributed away from the project the audio is
   * stored under.
   */
  costProjectId?: string
  emotion?: string
  /** Language detection/boost setting. Default: 'English'. Use 'auto' for auto-detection */
  languageBoost?: LanguageBoost
  /** TTS model to use. Default: 'speech-2.6-hd', or 'speech-2.8-hd' when useNewVoiceModel is true. */
  model?: TTSModel
  outputDirectory?: string
  /** Voice pitch adjustment. Range: -12 to 12. Default: 0 */
  pitch?: number
  /**
   * Story-loader project. Load-bearing for STORAGE: when set, the audio is written
   * to the canonical `story_loader/audio/voice_over.mp3` (storage or raw fs) instead of
   * `outputDirectory`. Use `costProjectId` when you only want cost attribution.
   */
  projectId?: string
  /** Pronunciation dictionary for custom word pronunciations, e.g., ['Omg/Oh my god'] */
  pronunciationDict?: string[]
  /** If true, exclude emotion parameter from TTS request. Controlled by new_voice_config_enabled feature gate */
  removeEmotion?: boolean
  /** If true, send text as-is. Used when long-form chunking already optimized the full script. */
  skipScriptOptimization?: boolean
  /** Voice speed. Range: 0.5-2.0. Default: 1 */
  speed?: number
  text: string
  /** If true, use 2.8 HD as default model. Controlled by new_voice_model_minimax feature gate. */
  useNewVoiceModel?: boolean
  voiceId: string
  /** Voice modification effects */
  voiceModify?: VoiceModifyOptions
  /** Voice volume. Range: 0.1-10. Default: 1 */
  vol?: number
}
export interface TTSResult {
  message: string
  outputPath?: string
  preprocessedText?: string
  status: 'error' | 'success'
  traceId?: string
}
export interface VoiceCloneOptions {
  audioFile: string
  /** Optional MiniMax clone_prompt input for accent/similarity optimization. */
  clonePrompt?: {
    audioFile: string
    text: string
  }
  /** Language boost for voice clone preview TTS. Helps MiniMax generate accurate demo audio in the detected language. */
  languageBoost?: LanguageBoost
  need_noise_reduction?: boolean
  need_volume_normalization?: boolean
  onPreviewGenerated?: (audioBuffer: Buffer, voiceId: string) => Promise<void>
  outputDirectory?: string
  text?: string
  userId: string
}
/** Voice modification effects for TTS */
export interface VoiceModifyOptions {
  /** Voice intensity adjustment */
  intensity?: number
  /** Voice pitch adjustment */
  pitch?: number
  /** Sound effects: 'spacious_echo', etc. */
  sound_effects?: 'spacious_echo' | string
  /** Voice timbre adjustment */
  timbre?: number
}

// Pattern: line ending in colon, hyphen, em-dash, or en-dash that signals a list lead-in.
const FRAGMENT_LIST_TRIGGER = /^(.+?)\s*(?:[-—–:])\s*$/

// Terminal punctuation, tolerating trailing closing quotes or brackets.
// e.g. `"Stop."` and `Done.)` are sentences, not fragments.
const SENTENCE_TERMINATOR = /[.!?]['"’”)\]]*$/

// Returns the fragment lines following a trigger, or empty if any line looks like a full sentence.
function collectFragmentLines(
  lines: string[],
  start: number,
): { end: number; fragments: string[] } {
  const fragments: string[] = []
  let j = start
  while (j < lines.length) {
    const candidate = lines[j].trim()
    if (candidate === '') {
      return { end: j, fragments }
    }
    if (SENTENCE_TERMINATOR.test(candidate)) {
      // Sentence, not a fragment - skip the whole block.
      return { end: start, fragments: [] }
    }
    fragments.push(candidate)
    j++
  }
  return { end: j, fragments }
}

function joinFragments(head: string, fragments: string[]): string {
  const last = fragments[fragments.length - 1]
  const lastIsConjunction = /^(and|or|but)\s/i.test(last)
  // Two-item lists don't take an Oxford comma in standard English.
  if (fragments.length === 2 && !lastIsConjunction) {
    return `${head} ${fragments[0]} and ${last}.`
  }
  const headJoined = fragments.slice(0, -1).join(', ')
  const tail = lastIsConjunction ? `${headJoined}, ${last}` : `${headJoined}, and ${last}`
  return `${head} ${tail}.`
}

const LETTERED_LIST_ITEM = /^(\s*)([A-Z])\s*(?:[.),]|[-—–])\s+(.+?)\s*$/

/**
 * Makes visual lettered lists explicit before MiniMax synthesis.
 *
 * MiniMax can verbalize the punctuation after an isolated letter (for example,
 * `A - Leave` becomes "A dot leave"). Only consecutive lettered items are
 * rewritten, so ordinary prose that happens to start with `A,` remains intact.
 */
export function normalizeLetteredListsForTts(text: string): string {
  const lines = text.split('\n')
  const items = lines.map((line) => line.match(LETTERED_LIST_ITEM))

  const adjacentItem = (index: number, step: -1 | 1): RegExpMatchArray | undefined => {
    for (let i = index + step; i >= 0 && i < lines.length; i += step) {
      if (lines[i].trim() === '') {
        continue
      }
      return items[i] ?? undefined
    }
    return undefined
  }

  return lines
    .map((line, index) => {
      const item = items[index]
      if (!item) {
        return line
      }

      const labelCode = item[2].charCodeAt(0)
      const previous = adjacentItem(index, -1)
      const next = adjacentItem(index, 1)
      const belongsToSequence =
        previous?.[2].charCodeAt(0) === labelCode - 1 || next?.[2].charCodeAt(0) === labelCode + 1

      return belongsToSequence ? `${item[1]}Option ${item[2]}, ${item[3]}` : line
    })
    .join('\n')
}

export function normalizeMiniMaxTtsText(text: string): string {
  return collapseFragmentListsForTts(normalizeLetteredListsForTts(text))
}

/**
 * Deterministic safety net for the LLM optimizer's rule 7.
 *
 * MiniMax TTS (both speech-2.6-hd and speech-2.8-hd) verbalizes the word "dot"
 * when the input has a lead-in line ending in colon, hyphen, em-dash, or en-dash
 * followed by a paragraph break and two or more newline-separated phrase
 * fragments (each without terminal punctuation). The model treats the
 * structural break as something to read aloud.
 *
 * Collapses that pattern into a single flowing sentence with commas plus a
 * natural conjunction. Idempotent and conservative: if any fragment line ends
 * in a period, exclamation mark, or question mark, the block is left alone (it
 * is a real list of sentences, not a fragment list).
 */
export function collapseFragmentListsForTts(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length) {
    const trigger = lines[i].match(FRAGMENT_LIST_TRIGGER)
    if (trigger && i + 1 < lines.length && lines[i + 1].trim() === '') {
      const { end, fragments } = collectFragmentLines(lines, i + 2)
      if (fragments.length >= 2) {
        out.push(joinFragments(trigger[1].trim(), fragments))
        i = end
        continue
      }
    }
    out.push(lines[i])
    i++
  }
  return out.join('\n')
}

/**
 * Speech Adaptation Agent
 * Optimizes text for natural-sounding Text-to-Speech by:
 * 1. De-structuring: Converting visual formatting to natural speech flow
 * 2. Phonetics & Stress: Handling pronunciation of acronyms and difficult words
 * 3. Pacing: Using punctuation to control TTS rhythm and pauses
 */
export async function optimizeScriptForSpeech(text: string): Promise<string> {
  try {
    logger.info(
      { originalText: `${text.slice(0, 100)}...` },
      'Starting speech optimization for TTS',
    )

    const prompt = `Role: TTS Script Optimizer.
                        Task: Convert the input text to "Ear-Text" for natural speech, strictly following these rules.

                        Input Text:
                        """
                        ${text}
                        """
                        TRANSFORMATION RULES (MUST FOLLOW):
                        1. **Dates (CRITICAL)**: Convert ALL date formats to natural spoken English.
                          - Years: "2024" -> "twenty twenty-four", "1990" -> "nineteen ninety".
                          - Ranges: "2023-2024" -> "twenty twenty-three to twenty twenty-four".
                          - Full Dates: "Jan 1, 2024" -> "January first, twenty twenty-four".
                          - Slashes: "01/15/24" -> "January fifteenth, twenty twenty-four".
                          - Months: Expand abbreviations ("Jan" -> "January", "Sept" -> "September").
                        2. **Numbers & Symbols**: Convert ALL to spoken form.
                          - "$86.3 million" -> "eighty-six point three million dollars"
                          - "%" -> "percent"
                        3. **Lists**: Convert numbered lists to sequential words (e.g., "1. Run" -> "First, run").
                        4. **Acronyms**: Spell out letter-by-letter if meant to be read that way (e.g., "CIA" -> "C-I-A", "PAC" -> "P-A-C").
                        5. **Pronunciation**: Fix issues like "BrightLoop" -> "Bright Loop".
                        6. **Punctuation**: Keep existing. Add commas ONLY for breathing in very long sentences. NO XML/SSML tags.
                        7. **Fragment Lists (CRITICAL)**: When a lead-in line ends with a colon, hyphen, or dash and is followed by two or more newline-separated phrase fragments (each without terminal punctuation), MERGE them into one flowing sentence with commas plus a natural conjunction for the last item. The lead-in's trailing colon/dash MUST be removed. Examples:
                          - Input: "Especially when combined with -\\n\\ndelayed reactions\\nunnatural pauses\\nor forced eye contact" -> "Especially when combined with delayed reactions, unnatural pauses, or forced eye contact."
                          - Input: "The brain may be trying to -\\n\\ninvent a response\\navoid contradictions\\nand control emotions" -> "The brain may be trying to invent a response, avoid contradictions, and control emotions."
                          MiniMax otherwise verbalizes the structural break as the word "dot".
                        STRICT CONSTRAINTS (DO NOT IGNORE):
                        - **ABSOLUTELY NO** bridge words ("Now", "However", "Meanwhile") or intros ("Welcome to").
                        - **DO NOT** rephrase, reword, or change sentence structure/order.
                        - **DO NOT** add or remove information.
                        - Keep titles/headers as-is (except number/date conversion).
                        Output: Return ONLY the final adapted script text. No markdown.`
    logger.info('Calling completion function for speech optimization...')

    try {
      const optimizedText = await completion({
        models: ['gemini-2.5-pro', 'gpt-5'],
        responseFormat: TextPreprocessingSchema,
        prompt,
        task: 'optimize-script-for-speech',
        seed: 1,
        temperature: 0.1,
      })

      if (optimizedText) {
        logger.info(
          {
            originalLength: text.length,
            optimizedLength: optimizedText.length,
            originalSample: text.slice(0, 100),
            optimizedSample: optimizedText.slice(0, 100),
          },
          'Speech optimization completed successfully',
        )
        return normalizeMiniMaxTtsText(optimizedText)
      }
      return normalizeMiniMaxTtsText(text)
    } catch (llmError) {
      logger.warn(
        {
          llmError: llmError instanceof Error ? llmError.message : String(llmError),
        },
        'Completion function call failed during speech optimization',
      )
      throw llmError
    }
  } catch (error) {
    logger.warn(
      { error: ensureError(error) },
      'Failed to optimize text for speech, using original text',
    )
    return normalizeMiniMaxTtsText(text)
  }
}

/** Resolve effective TTS model from options (for feature gate + explicit model). Exported for tests. */
export function getEffectiveModel(options: TTSOptions): TTSModel {
  if (options.model) {
    return options.model
  }
  return options.useNewVoiceModel ? NEW_VOICE_MODEL : DEFAULT_VOICE_MODEL
}

/**
 * Build the MiniMax T2A request payload.
 *
 * fal serves the same MiniMax model, so every field MiniMax accepts it accepts. Only
 * the transport-level deltas are adapted at the fal call site -- see `fal-minimax.ts`.
 */
export function buildTTSPayload(processedText: string, options: TTSOptions) {
  // Build voice_setting object conditionally based on removeEmotion flag
  const voiceSetting: Record<string, unknown> = {
    voice_id: options.voiceId,
    speed: options.speed ?? 1,
    vol: options.vol ?? 1,
    pitch: options.pitch ?? 0,
    ...(!options.removeEmotion && options.emotion ? { emotion: options.emotion } : {}),
  }

  const payload: Record<string, unknown> = {
    model: getEffectiveModel(options),
    text: processedText,
    stream: false,
    output_format: 'hex',
    voice_setting: voiceSetting,
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  }

  // Always send `language_boost`. `pronunciation_dict` is only honoured when
  // the boost is present -- with the field omitted the vendor auto-detects and the
  // overrides are dropped silently, with no error. The app sends a built-in dictionary on
  // every request, so the boost has to be unconditional rather than tied to the caller
  // passing one.
  //
  // 'auto' is the vendor's own explicit spelling of the auto-detection that omitting the
  // field used to select, so language selection is unchanged for callers that pass
  // nothing. Deliberately NOT defaulted to a concrete language: probing fal showed the
  // same script renders ~50% longer under `language_boost: 'English'` than with the field
  // absent, so guessing a language here would change prosody on every untagged request.
  //
  // Set in this shared builder rather than per-provider so the fal path inherits exactly
  // the same value -- the divergence that has bitten this migration repeatedly.
  payload['language_boost'] = options.languageBoost ?? 'auto'

  // Add pronunciation dictionary: built-in entries + optional caller overrides/additions
  const pronunciationDict = [...BUILTIN_PRONUNCIATION_DICT, ...(options.pronunciationDict ?? [])]
  if (pronunciationDict.length) {
    payload['pronunciation_dict'] = { tone: pronunciationDict }
  }

  // Add voice modification effects if provided
  if (options.voiceModify) {
    payload['voice_modify'] = options.voiceModify
  }

  return payload
}

/**
 * Resolve where a non-storage TTS artifact is written. Shared by every
 * synthesis path so audio lands at stable locations.
 */
export function determineTtsOutputPaths(options: TTSOptions): {
  outputPath: string
  relativeOutputPath: string
} {
  if (options.projectId) {
    const audioFolderPath = typedPathResolver.getStoryLoaderAudioFolderPath(options.projectId)
    typedPathResolver.createDirectoryIfNotExists(audioFolderPath)
    const fileName = 'voice_over.mp3'
    return {
      outputPath: join(audioFolderPath, fileName),
      relativeOutputPath: join('audio', fileName),
    }
  }

  const outputDir = options.outputDirectory || join(process.cwd(), 'output')
  const randomStr = Math.random().toString(36).slice(2, 8)
  const timestamp = Date.now().toString().slice(-6)
  const fileName = `tts_${options.voiceId}_${timestamp}_${randomStr}.mp3`
  return {
    outputPath: join(outputDir, fileName),
    relativeOutputPath: join(outputDir, fileName),
  }
}
