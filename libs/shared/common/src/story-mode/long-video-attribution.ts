export const LONG_VIDEO_THRESHOLD_SECONDS = 240
const SCRIPT_LONG_VIDEO_THRESHOLD_SECONDS = 300
export const SCRIPT_WORDS_PER_MINUTE = 150
export const SCRIPT_CJK_CHARS_PER_MINUTE = 300
const AVG_SCRIPT_CHARS_PER_WORD = 6
const CJK_SCRIPT_CHAR_PATTERN = /[\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/g

/**
 * BCP-47 primary subtags for non-space-separated (CJK + Thai) scripts:
 * Chinese, Japanese, Korean, Thai. For these languages `countWords`
 * (utils/text.ts) treats each character as one "word". The trailing
 * negative lookahead matches only the primary subtag (so `zh-CN`, `zh_Hant`
 * are covered while English words like "than" / "the" are not).
 */
const CJK_SCRIPT_LANGUAGE_PATTERN = /^(zh|ja|ko|th)(?![a-z])/i

export type LongVideoAttemptSource =
  | 'audio_upload'
  | 'duration_picker'
  | 'script_length'
  | 'uip_duration_option'
  | 'uip_followup_prompt_duration_mention'
  | 'uip_initial_prompt_duration_mention'

export function buildLongVideoAttemptTrackingProperties(
  source?: LongVideoAttemptSource,
):
  | Record<string, never>
  | { longVideoAttempted: true; longVideoAttemptSource: LongVideoAttemptSource } {
  return source ? { longVideoAttempted: true, longVideoAttemptSource: source } : {}
}

export function estimateScriptDurationSeconds(script?: string): number | undefined {
  const trimmed = script?.trim()
  if (!trimmed) {
    return undefined
  }

  const cjkCharCount = countCjkScriptChars(trimmed)
  const nonCjkText = trimmed.replace(CJK_SCRIPT_CHAR_PATTERN, ' ')
  const wordCount = countApproxScriptWords(nonCjkText)
  const charCount = nonCjkText.replace(/\s/g, '').length
  const fromCjkChars = cjkCharCount > 0 ? (cjkCharCount * 60) / SCRIPT_CJK_CHARS_PER_MINUTE : 0
  const fromWords = wordCount > 0 ? (wordCount * 60) / SCRIPT_WORDS_PER_MINUTE : 0
  const fromChars =
    charCount > 0 ? (charCount * 60) / (SCRIPT_WORDS_PER_MINUTE * AVG_SCRIPT_CHARS_PER_WORD) : 0
  const estimate = fromCjkChars + Math.max(fromWords, fromChars)
  return estimate > 0 ? estimate : undefined
}

export function getMaxDurationMentionSeconds(text?: string): number | undefined {
  if (!text?.trim()) {
    return undefined
  }

  const seconds: number[] = []
  for (const match of text.matchAll(
    /(\d+(?:\.\d+)?)\s*-?\s*(hours?|hrs?|h|minutes?|mins?|min|m|seconds?|secs?|sec|s|小时|小時|分钟|分鐘|分|秒)(?=$|[^A-Za-z])/giu,
  )) {
    const amount = Number(match[1])
    const unit = match[2]
    const value = durationUnitToSeconds(unit, amount)
    if (value !== undefined) {
      seconds.push(value)
    }
  }

  for (const match of text.matchAll(
    /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen)\s*-?\s*(hours?|hrs?|h|minutes?|mins?|min|seconds?|secs?|sec)\b/giu,
  )) {
    const amount = NUMBER_WORDS[match[1]?.toLowerCase() ?? '']
    const unit = match[2]
    const value = durationUnitToSeconds(unit, amount)
    if (value !== undefined) {
      seconds.push(value)
    }
  }

  for (const match of text.matchAll(/([一二三四五六七八九十]+)\s*(小时|小時|分钟|分鐘|分|秒)/gu)) {
    const amount = parseChineseInteger(match[1] ?? '')
    const value = durationUnitToSeconds(match[2], amount)
    if (value !== undefined) {
      seconds.push(value)
    }
  }

  for (const match of text.matchAll(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\b/g)) {
    const first = Number(match[1])
    const second = Number(match[2])
    const third = match[3] === undefined ? undefined : Number(match[3])
    if ([first, second, third ?? 0].every(Number.isFinite)) {
      seconds.push(third === undefined ? first * 60 + second : first * 3600 + second * 60 + third)
    }
  }

  return seconds.length ? Math.max(...seconds) : undefined
}

/**
 * True when a script-language code denotes a non-space-separated language
 * (Chinese, Japanese, Korean, Thai). Matches on the primary subtag so
 * regional variants (`zh-CN`, `zh-TW`, `zh_Hant`, etc.) are covered.
 */
export function isCjkScriptLanguage(scriptLanguage?: null | string): boolean {
  return Boolean(scriptLanguage && CJK_SCRIPT_LANGUAGE_PATTERN.test(scriptLanguage.trim()))
}

export function isLongVideoDuration(seconds: unknown): boolean {
  const normalized = normalizePositiveSeconds(seconds)
  return normalized !== undefined && normalized > LONG_VIDEO_THRESHOLD_SECONDS
}

export function isLongVideoScriptDuration(seconds: unknown): boolean {
  const normalized = normalizePositiveSeconds(seconds)
  return normalized !== undefined && normalized > SCRIPT_LONG_VIDEO_THRESHOLD_SECONDS
}

/**
 * Narration rate in `countWords`-units per minute, used to size a script to a
 * target duration. For non-space-separated languages each character counts as
 * a word and those characters are spoken ~2x faster than the 150-wpm English
 * rate, so a duration -> word budget MUST use the CJK rate or it
 * under-provisions CJK scripts by half. This is the inverse of the
 * rate model in `estimateScriptDurationSeconds`.
 */
export function narrationRatePerMinute(scriptLanguage?: null | string): number {
  return isCjkScriptLanguage(scriptLanguage) ? SCRIPT_CJK_CHARS_PER_MINUTE : SCRIPT_WORDS_PER_MINUTE
}

export function normalizePositiveSeconds(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return undefined
  }
  return value
}

export function resolveClassicLongVideoAttemptSource(params: {
  audioDurationSeconds?: number
  requestedDurationSeconds?: number
  script?: string
}): LongVideoAttemptSource | undefined {
  if (isLongVideoDuration(params.audioDurationSeconds)) {
    return 'audio_upload'
  }
  if (isLongVideoDuration(params.requestedDurationSeconds)) {
    return 'duration_picker'
  }
  if (isLongVideoScriptDuration(estimateScriptDurationSeconds(params.script))) {
    return 'script_length'
  }
  return undefined
}

export function textHasLongVideoDurationMention(text?: string): boolean {
  return isLongVideoDuration(getMaxDurationMentionSeconds(text))
}

function countApproxScriptWords(text: string): number {
  const wordMatches = text.match(/[\p{L}\p{N}]+(?:['-][\p{L}\p{N}]+)*/gu)
  return wordMatches?.length ?? 0
}

function countCjkScriptChars(text: string): number {
  return text.match(CJK_SCRIPT_CHAR_PATTERN)?.length ?? 0
}

function durationUnitToSeconds(
  unit: string | undefined,
  amount: number | undefined,
): number | undefined {
  if (amount === undefined || !Number.isFinite(amount) || amount <= 0 || !unit) {
    return undefined
  }
  const normalized = unit.toLowerCase()
  if (['h', 'hour', 'hours', 'hr', 'hrs', '小时', '小時'].includes(normalized)) {
    return amount * 3600
  }
  if (['m', 'min', 'mins', 'minute', 'minutes', '分', '分钟', '分鐘'].includes(normalized)) {
    return amount * 60
  }
  if (['s', 'sec', 'second', 'seconds', 'secs', '秒'].includes(normalized)) {
    return amount
  }
  return undefined
}

function parseChineseInteger(value: string): number | undefined {
  if (!value) {
    return undefined
  }
  if (value === '十') {
    return 10
  }
  const tenIndex = value.indexOf('十')
  if (tenIndex !== -1) {
    const tens = tenIndex === 0 ? 1 : CHINESE_DIGITS[value.slice(0, tenIndex)]
    const ones = tenIndex === value.length - 1 ? 0 : CHINESE_DIGITS[value.slice(tenIndex + 1)]
    if (tens === undefined || ones === undefined) {
      return undefined
    }
    return tens * 10 + ones
  }
  return CHINESE_DIGITS[value]
}

const NUMBER_WORDS: Record<string, number> = {
  eight: 8,
  eleven: 11,
  fifteen: 15,
  five: 5,
  four: 4,
  fourteen: 14,
  nine: 9,
  one: 1,
  seven: 7,
  six: 6,
  ten: 10,
  thirteen: 13,
  three: 3,
  twelve: 12,
  two: 2,
}

const CHINESE_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
}
