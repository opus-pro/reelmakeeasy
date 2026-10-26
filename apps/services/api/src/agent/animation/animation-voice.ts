import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { captionWords, normalizedWord } from '@reelmakeeasy/common/asr/align-text'

import { run } from '../motion-reel/motion-runtime'

import { medianPitchHz, wavSamples } from './pitch'

/** One line to say: who says it, the words, and the voice (a description, or a Kokoro preset id). */
export type VoiceLineInput = { text: string; voice: string; who: string }

/** A recorded line in `public/voice/lines.json`: times in seconds from the video's first frame. */
export type VoiceLine = {
  end: number
  /** Loudness per frame from the line's start, 0..1 (1 = the line's loudest frame). */
  envelope: number[]
  pitchHz: null | number
  start: number
  text: string
  who: string
  words: { end: number; start: number; text: string }[]
}

/** How a take is made, timed and checked: the app's voices, its aligner (word times for the
 *  script's own words) and its speech to text (what the take really says). Stand-ins in tests. */
export type VoiceDeps = {
  align(file: string, text: string): Promise<{ end: number; start: number; text: string }[]>
  speak(line: { text: string; voice: string }): Promise<{ audio: Buffer; ranOn: 'fal' | 'local' }>
  transcribe(file: string): Promise<string[]>
}

/** An animation_voice call that can't be recorded; the message says what to fix. */
export class VoiceArgsError extends Error {}

const TAKES = 3
/** A take this close to the character's first pitch (as a share of it) is kept at once. */
const PITCH_TOLERANCE = 0.12
const DEFAULT_PAUSE_MS = 250
const RATE = 24000
const MAX_LINES = 40
const MAX_LINE_CHARS = 400

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** `Who: words` rows (or `Who: voice` rows), blank rows skipped. */
function rows(text: unknown): { body: string; row: number; who: string }[] {
  if (typeof text !== 'string') return []
  return text
    .split('\n')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r, i) => {
      const at = r.indexOf(':')
      return at > 0
        ? { body: r.slice(at + 1).trim(), row: i + 1, who: r.slice(0, at).trim() }
        : { body: r, row: i + 1, who: '' }
    })
}

/**
 * animation_voice's arguments, checked. The tool takes flat text (the Claude tool bridge needs
 * flat parameters): `lines`, one `Who: words` per row in order, and `voices`, one `Who: voice`
 * per speaker (a description, or a preset id starting kokoro-).
 */
export function parseVoiceArgs(args: unknown): {
  confirmPaid: boolean
  lines: VoiceLineInput[]
  pauseMs: number
} {
  const a = isRecord(args) ? args : {}
  const voices = new Map<string, string>()
  for (const v of rows(a['voices'])) if (v.who && v.body) voices.set(v.who, v.body)
  const lines = rows(a['lines']).map(({ body, row, who }) => {
    if (!who || !body)
      throw new VoiceArgsError(`Line ${row} must start with who says it: "Narrator: the words".`)
    if (body.length > MAX_LINE_CHARS)
      throw new VoiceArgsError(
        `Line ${row} is too long: keep each line under ${MAX_LINE_CHARS} characters.`,
      )
    const voice = voices.get(who)
    if (!voice)
      throw new VoiceArgsError(`Give ${who} a voice in voices ("${who}: a description of the voice").`)
    return { text: body, voice, who }
  })
  if (!lines.length) throw new VoiceArgsError('Pass the lines to record.')
  if (lines.length > MAX_LINES) throw new VoiceArgsError(`Record at most ${MAX_LINES} lines.`)
  const pause = Number(a['pauseMs'])
  return {
    confirmPaid: a['confirmPaid'] === true,
    lines,
    pauseMs: Number.isFinite(pause) && pause >= 0 && pause <= 2000 ? pause : DEFAULT_PAUSE_MS,
  }
}

/** Words as compared: split as captions and transcripts split them (a dash splits two words),
 *  then lowercase letters and digits only (digits stay digits). */
const comparable = (words: string[]): string[] =>
  captionWords(words.join(' ')).map(normalizedWord).filter(Boolean)

/** Word-level edit distance (insertions, deletions, swaps). */
function wordDistance(a: string[], b: string[]): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const row = [i]
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(
        (prev[j] as number) + 1,
        (row[j - 1] as number) + 1,
        (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    prev = row
  }
  return prev[b.length] as number
}

/** Whether a take's transcript says the script: word for word in a short line, one slip allowed
 *  in 12 words or more (speech to text mishears now and then too). */
export function wordsMatch(script: string, heard: string[]): boolean {
  const a = comparable([script])
  const b = comparable(heard)
  return wordDistance(a, b) <= Math.floor(a.length / 12)
}

type Take = {
  duration: number
  file: string
  matches: boolean
  pitch: null | number
  ranOn: 'fal' | 'local'
  words: { end: number; start: number; text: string }[]
}

/**
 * Records every line (up to 3 takes each), keeps the take whose words match the script and whose
 * pitch is closest to that character's first line, then writes `public/voice/line<N>.wav`,
 * `public/voice.wav` (the lines joined, `pauseMs` apart) and `public/voice/lines.json`.
 */
export async function recordVoices(o: {
  deps: VoiceDeps
  fps: number
  lines: VoiceLineInput[]
  pauseMs?: number
  projectDir: string
}): Promise<{ lines: VoiceLine[]; ranOnFal: boolean; totalSec: number; warnings: string[] }> {
  const checks = { failed: false }
  const pauseSec = (o.pauseMs ?? DEFAULT_PAUSE_MS) / 1000
  const voiceDir = path.join(o.projectDir, 'public', 'voice')
  fs.mkdirSync(voiceDir, { recursive: true })
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'animation-voice-'))
  const firstPitch = new Map<string, number>()
  const warnings: string[] = []
  const kept: { input: VoiceLineInput; take: Take }[] = []
  let ranOnFal = false
  try {
    for (const [i, input] of o.lines.entries()) {
      const takes: Take[] = []
      const ref = firstPitch.get(input.who)
      for (let t = 0; t < TAKES; t++) {
        const take = await recordTake(
          o.deps,
          input,
          path.join(work, `line${i + 1}-take${t}.wav`),
          checks,
        )
        ranOnFal ||= take.ranOn === 'fal'
        takes.push(take)
        if (take.matches && (ref === undefined || nearPitch(take.pitch, ref))) break
      }
      const matching = takes.filter((t) => t.matches)
      const pool = matching.length ? matching : takes
      const take = closestPitch(pool, ref)
      if (!matching.length)
        warnings.push(
          `Line ${i + 1} ("${input.text}") may have a clipped or misheard word: listen to it.`,
        )
      if (ref === undefined && take.pitch !== null) firstPitch.set(input.who, take.pitch)
      fs.copyFileSync(take.file, path.join(voiceDir, `line${i + 1}.wav`))
      kept.push({ input, take })
    }

    const lines: VoiceLine[] = []
    const chunks: Float32Array[] = []
    let at = 0
    for (const [i, { input, take }] of kept.entries()) {
      if (i > 0) {
        chunks.push(new Float32Array(Math.round(pauseSec * RATE)))
        at += pauseSec
      }
      const { samples } = wavSamples(fs.readFileSync(take.file))
      chunks.push(samples)
      lines.push({
        end: round(at + take.duration),
        envelope: envelope(samples, RATE, o.fps),
        pitchHz: take.pitch === null ? null : Math.round(take.pitch),
        start: round(at),
        text: input.text,
        who: input.who,
        words: take.words.map((w) => ({
          end: round(at + w.end),
          start: round(at + w.start),
          text: w.text,
        })),
      })
      at += take.duration
    }
    fs.writeFileSync(path.join(o.projectDir, 'public', 'voice.wav'), toWav(chunks, RATE))
    fs.writeFileSync(path.join(voiceDir, 'lines.json'), `${JSON.stringify(lines)}\n`)
    if (checks.failed)
      warnings.push(
        "Couldn't check the takes' words (no speech to text ran): ask the user to listen to every line.",
      )
    return { lines, ranOnFal, totalSec: round(at), warnings }
  } finally {
    fs.rmSync(work, { force: true, recursive: true })
  }
}

/** One take: spoken, trimmed of silence at both ends (24 kHz mono WAV), checked against the
 *  script by a transcript, timed and measured. A transcript that can't be made passes the take
 *  (and `checks.failed` says the words went unchecked). */
async function recordTake(
  deps: VoiceDeps,
  input: VoiceLineInput,
  file: string,
  checks: { failed: boolean },
): Promise<Take> {
  const spoken = await deps.speak({ text: input.text, voice: input.voice })
  const raw = `${file}.in`
  fs.writeFileSync(raw, spoken.audio)
  const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03'
  await run(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-i',
      raw,
      '-af',
      `${trim},areverse,${trim},areverse`,
      '-ar',
      String(RATE),
      '-ac',
      '1',
      '-c:a',
      'pcm_s16le',
      file,
    ],
    path.dirname(file),
  )
  const wav = fs.readFileSync(file)
  const duration = wavSamples(wav).samples.length / RATE
  let matches = true
  try {
    matches = wordsMatch(input.text, await deps.transcribe(file))
  } catch {
    checks.failed = true
  }
  const words = await deps.align(file, captionWords(input.text).join(' '))
  return {
    duration,
    file,
    matches,
    pitch: medianPitchHz(wav),
    ranOn: spoken.ranOn,
    words: words.map((w) => ({
      end: Math.min(duration, w.end),
      start: Math.max(0, w.start),
      text: w.text,
    })),
  }
}

const nearPitch = (pitch: null | number, ref: number) =>
  pitch !== null && Math.abs(pitch - ref) / ref <= PITCH_TOLERANCE

function closestPitch(takes: Take[], ref: number | undefined): Take {
  if (ref === undefined) return takes[0] as Take
  return [...takes].sort(
    (a, b) => Math.abs((a.pitch ?? Infinity) - ref) - Math.abs((b.pitch ?? Infinity) - ref),
  )[0] as Take
}

/** RMS per video frame, scaled so the loudest frame is 1. */
function envelope(samples: Float32Array, rate: number, fps: number): number[] {
  const per = rate / fps
  const frames = Math.ceil(samples.length / per)
  const rms: number[] = []
  for (let f = 0; f < frames; f++) {
    const from = Math.floor(f * per)
    const to = Math.min(samples.length, Math.floor((f + 1) * per))
    let sum = 0
    for (let i = from; i < to; i++) sum += (samples[i] as number) ** 2
    rms.push(Math.sqrt(sum / Math.max(1, to - from)))
  }
  const peak = Math.max(...rms, 1e-6)
  return rms.map((v) => Math.round((v / peak) * 100) / 100)
}

function toWav(chunks: Float32Array[], rate: number): Buffer {
  const count = chunks.reduce((n, c) => n + c.length, 0)
  const data = Buffer.alloc(count * 2)
  let i = 0
  for (const chunk of chunks)
    for (const v of chunk) data.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 2 * i++)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

const round = (s: number) => Math.round(s * 1000) / 1000
