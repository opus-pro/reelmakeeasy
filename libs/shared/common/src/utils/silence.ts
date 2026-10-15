/**
 * Pauses in speech audio, from FFmpeg's `silencedetect` filter, and the speech between them.
 * Used to stitch TTS chunks (boundary silence) and to time captions without word timestamps
 * (the punctuation + pause fallback in `asr/caption-timing.ts`).
 */
import { runCommand } from './cmdline'

export interface SilenceOptions {
  /** The audio length when the caller measured it; closes a silence still open at the end. */
  durationSeconds?: number
  /** Shortest pause to report, in seconds. */
  minSeconds: number
  /** Level under which the audio counts as silent, in dB (negative). */
  noiseDb: number
}

export interface SilenceReport {
  /** The caller's duration, else FFmpeg's `Duration:` line, else null. */
  durationSeconds: null | number
  silences: TimeSpan[]
}

export interface TimeSpan {
  end: number
  start: number
}

/** The pauses the caption fallback reads (beat-loop skill, section 7): 0.12 s+ under -35 dB. */
export const CAPTION_PAUSE = { minSeconds: 0.12, noiseDb: -35 } as const

/** Leading silence that starts this close to 0 counts as the audio's lead-in. */
const LEAD_IN_TOLERANCE_SECONDS = 0.01
/** Spans closer than this (rounding in FFmpeg's printout) are treated as touching. */
const TOUCH_SECONDS = 0.001

/** Runs `silencedetect` over the audio file and parses what it prints. */
export async function detectSilences(
  audioPath: string,
  options: SilenceOptions,
): Promise<SilenceReport> {
  const { stderr } = await runCommand([
    'ffmpeg',
    '-hide_banner',
    '-nostats',
    '-i',
    audioPath,
    '-af',
    `silencedetect=noise=${options.noiseDb}dB:d=${options.minSeconds}`,
    '-f',
    'null',
    '-',
  ])
  const durationSeconds = options.durationSeconds ?? parseDuration(stderr)
  return { durationSeconds, silences: parseSilenceDetect(stderr, durationSeconds ?? undefined) }
}

/**
 * The silences in `silencedetect` output, in order. FFmpeg can print a start a hair below 0;
 * it is clamped. A silence still open at the end of the audio closes at `durationSeconds`,
 * else at the input's `Duration:` line, else it is dropped.
 */
export function parseSilenceDetect(output: string, durationSeconds?: number): TimeSpan[] {
  const silences: TimeSpan[] = []
  let openStart: null | number = null
  for (const line of output.split('\n')) {
    const start = parseNumber(/silence_start:\s*(\S+)/.exec(line)?.[1])
    if (start !== null) openStart = Math.max(0, start)
    const end = parseNumber(/silence_end:\s*(\S+)/.exec(line)?.[1])
    if (end !== null && openStart !== null) {
      if (end >= openStart) silences.push({ end, start: openStart })
      openStart = null
    }
  }
  const audioEnd = durationSeconds ?? parseDuration(output)
  if (openStart !== null && audioEnd !== null && audioEnd >= openStart) {
    silences.push({ end: audioEnd, start: openStart })
  }
  return silences
}

/** Where the speech starts: the end of a silence at the very start of the audio, else 0. */
export function speechOnset(silences: TimeSpan[]): number {
  const first = sortedSpans(silences)[0]
  return first && first.start <= LEAD_IN_TOLERANCE_SECONDS ? first.end : 0
}

/**
 * The audio between the silences, inside [0, durationSeconds]. Silences may come unsorted or
 * overlapping. Sounds shorter than `minSpeechSeconds` (a click between two pauses) are left out.
 */
export function speechSpans(
  silences: TimeSpan[],
  durationSeconds: number,
  minSpeechSeconds = 0,
): TimeSpan[] {
  const end = Math.max(0, durationSeconds)
  const spans: TimeSpan[] = []
  let at = 0
  for (const silence of sortedSpans(silences)) {
    const from = Math.min(Math.max(0, silence.start), end)
    if (from > at + TOUCH_SECONDS) spans.push({ end: from, start: at })
    at = Math.max(at, Math.min(silence.end, end))
  }
  if (at < end - TOUCH_SECONDS) spans.push({ end, start: at })
  return spans.filter((span) => span.end - span.start >= minSpeechSeconds)
}

/**
 * Pieces of at most `maxSeconds` that cover the audio, each cut in the middle of the last pause
 * before its limit (at the limit itself when there is none). A forced aligner degrades on long
 * audio, so long voiceovers are aligned piece by piece.
 */
export function splitAtSilences(
  silences: TimeSpan[],
  durationSeconds: number,
  maxSeconds: number,
): TimeSpan[] {
  if (!Number.isFinite(maxSeconds) || maxSeconds <= 0) {
    throw new Error(`maxSeconds must be a positive number, got ${maxSeconds}`)
  }
  const middles = sortedSpans(silences).map((silence) => (silence.start + silence.end) / 2)
  const pieces: TimeSpan[] = []
  let start = 0
  while (durationSeconds - start > maxSeconds) {
    const limit = start + maxSeconds
    const cut = middles.findLast((middle) => middle > start && middle <= limit) ?? limit
    pieces.push({ end: round(cut), start: round(start) })
    start = cut
  }
  pieces.push({ end: durationSeconds, start: round(start) })
  return pieces
}

/** FFmpeg's `Duration: 00:01:02.50` line, in seconds, or null (missing or `N/A`). */
function parseDuration(output: string): null | number {
  const match = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(output)
  if (!match) return null
  const [hours, minutes, seconds] = match.slice(1).map(Number) as [number, number, number]
  return round(hours * 3600 + minutes * 60 + seconds)
}

function parseNumber(value: string | undefined): null | number {
  const parsed = Number.parseFloat(value ?? '')
  return Number.isFinite(parsed) ? parsed : null
}

function sortedSpans(spans: TimeSpan[]): TimeSpan[] {
  return spans.toSorted((a, b) => a.start - b.start)
}

const round = (seconds: number): number => Math.round(seconds * 1e6) / 1e6
