/**
 * Delivery markup in voiceover scripts: a bracketed tag at the start of a
 * sentence (`[excited] We did it!`) sets how the following sentences are spoken,
 * until the next tag (`[neutral]` returns to plain delivery). Tags are never
 * spoken and never shown in captions.
 *
 * Each TTS engine renders them its own way:
 * - Qwen3-TTS preset speakers take a natural-language `instruct` per request, so
 *   a script is split where its delivery changes (see `planQwen3Segments`).
 * - Qwen3 cloned and designed voices (its Base model) take no instruction; tags
 *   are dropped, but questions are still split out so they can be re-rolled
 *   until the pitch rises.
 * - ElevenLabs v3 reads bracketed tags natively.
 * - Kokoro and MiniMax would read them aloud, so they are stripped.
 */

/** The tags the script writer may use, and the Qwen3 instruction each maps to. */
export const DELIVERY_TAGS: Record<string, string> = {
  angry: 'Angry and forceful.',
  calm: 'Calm, soft and reassuring.',
  confident: 'Confident and assured.',
  curious: 'Curious and intrigued.',
  excited: 'Very excited and energetic.',
  happy: 'Happy and warm, smiling while speaking.',
  playful: 'Playful and light-hearted.',
  sad: 'Sad and heavy, speaking slowly.',
  serious: 'Serious and firm.',
  surprised: 'Surprised and amazed.',
  warm: 'Warm and friendly.',
  whisper: 'Whispering, very quiet and breathy.',
}

/** Returns a tagged run to plain delivery. */
export const NEUTRAL_TAG = 'neutral'

/**
 * Added to a question's instruction so the pitch rises at the end. Without it a
 * Qwen3 preset rises on about 3 of 4 takes; with it, on every take we measured.
 */
export const RISING_QUESTION_INSTRUCT =
  'Ask this as a genuine question, with the pitch rising clearly at the end.'

/** Any bracketed token up to 48 characters, as the planner handoff strips them. */
const TAG_REGEX = /\[([^\]\n]{1,48})\]\s*/g

const WH_WORDS = new Set(['how', 'what', 'when', 'where', 'which', 'who', 'whom', 'whose', 'why'])
const OPENERS = new Set(['and', 'anyway', 'but', 'now', 'oh', 'ok', 'okay', 'so', 'then', 'well'])

/** Short tags tacked onto a statement: "..., right?", "..., isn't it?". */
const TAG_QUESTION_REGEX =
  /^(.*\S),\s*((?:right|okay|ok|yeah|yes|no|huh|eh|correct|agreed|you know|remember|see|got it|(?:is|are|was|were|do|does|did|can|could|will|would|should|have|has|had|wo|ca)n'?t \w+(?: \w+)?|don'?t you think)\?)$/i

export interface DeliverySentence {
  question?: QuestionKind
  /** The delivery tag in effect (lowercase), or undefined for plain delivery. */
  tag?: string
  text: string
}

export type QuestionKind = 'tag' | 'wh' | 'yes-no'

export function hasDeliveryMarkup(text: string): boolean {
  TAG_REGEX.lastIndex = 0
  return TAG_REGEX.test(text)
}

/** The script with every bracketed tag removed, as it is spoken and captioned. */
export function stripDeliveryMarkup(text: string): string {
  return text
    .replace(TAG_REGEX, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.!?;:])/g, '$1')
    .trim()
}

/** What kind of question a sentence is, if any. */
export function questionKind(sentence: string): QuestionKind | undefined {
  const s = sentence.trim()
  if (!s.endsWith('?')) return undefined
  if (TAG_QUESTION_REGEX.test(s)) return 'tag'
  // English wh-questions fall at the end; forcing a rise would sound wrong. Look
  // past openers like "So" or "And then" for the question word.
  const words = s
    .toLowerCase()
    .split(/[^a-z']+/)
    .filter(Boolean)
  const lead = words.findIndex((w) => !OPENERS.has(w))
  return lead !== -1 && WH_WORDS.has(words[lead] ?? '') ? 'wh' : 'yes-no'
}

/** Splits "We can do it today, right?" into the statement and its tag. */
export function splitTagQuestion(sentence: string): null | { head: string; tag: string } {
  const m = TAG_QUESTION_REGEX.exec(sentence.trim())
  if (!m?.[1] || !m[2]) return null
  const tag = m[2]
  return { head: `${m[1]},`, tag: tag.charAt(0).toUpperCase() + tag.slice(1) }
}

/**
 * The script as sentences, each with the delivery tag in effect. Unknown tags
 * are dropped (the writer is told the list), and a tag stays in effect across
 * sentences until the next one.
 */
export function parseDelivery(text: string): DeliverySentence[] {
  const out: DeliverySentence[] = []
  let tag: string | undefined
  // Split into tag tokens and the text between them.
  const parts = text.split(/(\[[^\]\n]{1,48}\])/)
  for (const part of parts) {
    const tagMatch = /^\[([^\]\n]{1,48})\]$/.exec(part)
    if (tagMatch) {
      const name = (tagMatch[1] ?? '').trim().toLowerCase()
      if (name === NEUTRAL_TAG) tag = undefined
      else if (DELIVERY_TAGS[name]) tag = name
      continue
    }
    for (const sentence of splitSentences(part)) {
      out.push({ question: questionKind(sentence), tag, text: sentence })
    }
  }
  return out
}

function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  // A sentence ends at . ! ? (or runs of them), optionally followed by closing quotes.
  return (clean.match(/[^.!?]+(?:[.!?]+["'”’)\]]*|$)/g) ?? [clean])
    .map((s) => s.trim())
    .filter(Boolean)
}

/** One Qwen3 request in a voiceover split by delivery. */
export interface Qwen3Segment {
  /** Instruction for preset speakers; never set for cloned voices. */
  instruct?: string
  /** Pause to insert before this segment, in ms. */
  pauseBeforeMs: number
  /** Generate several takes and keep the one whose pitch rises most. */
  preferRising?: boolean
  text: string
}

/** Pause between two sentences spoken as separate takes. */
export const SENTENCE_PAUSE_MS = 180
/** Pause between a statement and its split-off tag question ("..., | right?"). */
export const TAG_QUESTION_PAUSE_MS = 70
/**
 * Pause after a question spoken as its own take. A question needs a beat before
 * the answer ("..., right? | Wrong."); the sentence pause ran them together.
 */
export const AFTER_QUESTION_PAUSE_MS = 450

/**
 * How to speak a script with Qwen3: consecutive sentences with the same delivery
 * share one request, so a plain script with no questions stays a single request.
 *
 * - `instructable` (preset speakers): each tag becomes that run's instruction,
 *   and yes/no and tag questions also get the rising-question instruction and
 *   are re-rolled on their own until they rise.
 * - Otherwise (cloned voices): tags are ignored. A yes/no question becomes its
 *   own request to re-roll until it rises, and a tag question is split so the
 *   short tag ("Right?") is re-rolled on its own, which rises far more often
 *   than a tag at the end of a long take.
 */
export function planQwen3Segments(text: string, instructable: boolean): Qwen3Segment[] {
  const segments: Qwen3Segment[] = []
  const push = (seg: Omit<Qwen3Segment, 'pauseBeforeMs'>, pauseMs: number) => {
    const last = segments[segments.length - 1]
    const mergeable =
      last &&
      !last.preferRising &&
      !seg.preferRising &&
      last.instruct === seg.instruct &&
      pauseMs === SENTENCE_PAUSE_MS
    if (mergeable) last.text = `${last.text} ${seg.text}`
    else if (last) {
      segments.push({
        ...seg,
        pauseBeforeMs: last.preferRising ? AFTER_QUESTION_PAUSE_MS : pauseMs,
      })
    } else {
      segments.push({ ...seg, pauseBeforeMs: 0 })
    }
  }

  for (const sentence of parseDelivery(text)) {
    const rising = sentence.question === 'yes-no' || sentence.question === 'tag'
    if (instructable) {
      const base = sentence.tag ? DELIVERY_TAGS[sentence.tag] : undefined
      const instruct = rising ? [base, RISING_QUESTION_INSTRUCT].filter(Boolean).join(' ') : base
      // The instruction alone lifted most takes; re-rolling catches the rest.
      push({ instruct, preferRising: rising || undefined, text: sentence.text }, SENTENCE_PAUSE_MS)
      continue
    }
    const split = sentence.question === 'tag' ? splitTagQuestion(sentence.text) : null
    if (split) {
      push({ text: split.head }, SENTENCE_PAUSE_MS)
      push({ preferRising: true, text: split.tag }, TAG_QUESTION_PAUSE_MS)
    } else {
      push({ preferRising: rising || undefined, text: sentence.text }, SENTENCE_PAUSE_MS)
    }
  }
  return segments
}

/**
 * Re-applies the delivery tag in effect at the start of each chunk, so a script
 * split into chunks keeps its delivery (a tag's run can cross a chunk boundary).
 */
export function carryDeliveryTags(chunks: string[]): string[] {
  let tag: string | undefined
  return chunks.map((chunk) => {
    const prefixed = tag && !/^\s*\[[^\]\n]{1,48}\]/.test(chunk) ? `[${tag}] ${chunk}` : chunk
    for (const m of chunk.matchAll(/\[([^\]\n]{1,48})\]/g)) {
      const name = (m[1] ?? '').trim().toLowerCase()
      if (name === NEUTRAL_TAG) tag = undefined
      else if (DELIVERY_TAGS[name]) tag = name
    }
    return prefixed
  })
}
