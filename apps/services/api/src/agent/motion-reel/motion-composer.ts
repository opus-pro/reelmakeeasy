/**
 * Music the agent composes itself (engine "composer"): it writes `reel/music/music.mjs` with the
 * `reelmakeeasy-music-composer` skill and runs the composer (`tools/motion-composer`, copied into
 * `reel/music/tools/`) in its own sandboxed shell. ReelMakeEasy never imports or runs that code:
 * it reads what the composer wrote (`audio/score.wav`, and `build/music.json` and
 * `qc/score-report.json` parsed as plain JSON) and puts the score under the reel with its exact
 * beat grid and events, so nothing is found by ear.
 */
import fs from 'node:fs'
import path from 'node:path'

import { type BeatGrid, wholeBars } from '@reelmakeeasy/common/motion-reel/beat-grid'
import { tidyEvents } from '@reelmakeeasy/common/motion-reel/music-events'
import { MOTION_REEL_FPS } from '@reelmakeeasy/common/motion-reel/reel-config'
import { presetsDir } from '@reelmakeeasy/common/storage/presets'

/** The composer's folder inside the reel's project: `reel/music/`. */
export const COMPOSER_DIR = 'music'

/** The largest `build/music.json` read (a 60 s score's is about 0.3 MB, mostly control signals). */
const MAX_MUSIC_JSON_BYTES = 16 * 1024 * 1024
/** The largest `qc/score-report.json` read. */
const MAX_REPORT_BYTES = 2 * 1024 * 1024
/** The largest score WAV taken (60 s of 48 kHz 16-bit stereo is about 11.5 MB). */
const MAX_WAV_BYTES = 200 * 1024 * 1024
/** At most this many voices, and hits per voice, are read from music.json. */
const MAX_VOICES = 64
const MAX_HITS_PER_VOICE = 20_000
/** At most this many strong hits (section entries) go into the grid. */
const MAX_STRONG_HITS = 16

/** Kicks: a kick instrument or a voice named as one (a found-sound thud named `kick`); with
 *  none, the low hits (an 808, a sub). Snares: a snare or clap, by instrument or by name. */
const KICK_INSTRUMENTS = new Set(['kick'])
const KICK_NAME = /kick|^bd/i
const LOW_INSTRUMENTS = new Set(['e808', 'sub'])
const LOW_NAME = /808|sub/i
const SNARE_INSTRUMENTS = new Set(['clap', 'snare'])
const SNARE_NAME = /snare|clap/i
/** How far the score WAV's length may be from music.json's (seconds). */
const LENGTH_TOLERANCE_SEC = 0.05

/** A composed score, read: its exact grid (with events) and how ReelMakeEasy names it. */
export type ComposerScore = {
  grid: BeatGrid
  /** "F# dorian", or null when the score has no key. */
  key: null | string
  /** "Composed: F# dorian, 136 BPM". */
  title: string
}

/** The composed music, ready to go under the reel. */
export type ComposedMusic = ComposerScore & {
  /** The score's copy in `reel/music/composer-<time>.wav` (the composer may overwrite its own). */
  file: string
  /** The composer's QC, in a few lines (WARNs named; FAILs refuse the score). */
  qc: string[]
}

type Hit = [number, number]
type MusicJson = {
  beatsPerBar: number
  bpm: number
  chords: { t: number }[]
  duration: number
  hits: Record<string, Hit[]>
  key: null | string
  motif: [number, number, string][]
  scale: unknown
  sections: { at: number; dur: number; energy: number; name: string }[]
  voices: Record<string, { inst?: string }>
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const round3 = (t: number) => Math.round(t * 1000) / 1000

/** The repo's copy of the composer (`tools/motion-composer`), next to `presets/`. */
export function composerSourceDir(): string {
  return path.join(path.dirname(presetsDir()), 'tools', 'motion-composer')
}

/**
 * Copies the composer into `reel/music/tools/` (refreshed on every prepare: ReelMakeEasy owns it)
 * and writes `reel/music/reel.config.mjs` from the setup. The agent sets `bpm` there (its
 * music.mjs reads it), so a bpm already in the file is kept; the rest is rewritten.
 */
export function installComposer(
  projectDir: string,
  o: { bpm: number; lengthSec: number; title: string },
): void {
  const dir = path.join(projectDir, COMPOSER_DIR)
  const tools = path.join(dir, 'tools')
  // The agent writes this folder: a link in its place (to anywhere) is removed, never followed,
  // so nothing here deletes or writes outside the reel.
  dropLink(dir)
  fs.mkdirSync(dir, { recursive: true })
  if (!insideReal(projectDir, dir)) throw new Error(`reel/${COMPOSER_DIR} is not inside the reel.`)
  fs.rmSync(tools, { force: true, recursive: true })
  fs.cpSync(composerSourceDir(), tools, {
    filter: (source) => path.basename(source) !== 'README.md',
    recursive: true,
  })
  const configFile = path.join(dir, 'reel.config.mjs')
  let bpm = o.bpm
  try {
    // Read as text, never imported: only a plain number counts.
    const kept = /^\s*bpm:\s*(\d{2,3}(?:\.\d+)?)\s*,/m.exec(fs.readFileSync(configFile, 'utf8'))
    if (kept && Number(kept[1]) >= 40 && Number(kept[1]) <= 240) bpm = Number(kept[1])
  } catch {
    // No config yet: the reel's tempo is the placeholder.
  }
  dropLink(configFile)
  fs.writeFileSync(configFile, renderComposerConfig({ ...o, bpm }))
}

/** Installs the composer when `reel/music/tools/` doesn't have it (a reel set up before it, or
 *  with other music); true when it did. */
export function ensureComposer(
  projectDir: string,
  o: { bpm: number; lengthSec: number; title: string },
): boolean {
  if (fs.existsSync(path.join(projectDir, COMPOSER_DIR, 'tools', 'score.mjs'))) return false
  installComposer(projectDir, o)
  return true
}

/** The composer's title for a reel: its subject on one line. */
export function composerTitle(subject: string): string {
  return subject.replace(/\s+/g, ' ').slice(0, 80)
}

/** How many whole 4/4 bars a reel of about `lengthSec` is at `bpm` (as the reel's grid rounds). */
export function reelBarsAt(lengthSec: number, bpm: number, beatsPerBar = 4): number {
  return wholeBars(lengthSec, bpm, beatsPerBar)
}

/** `reel/music/reel.config.mjs`: the reel's tempo, meter, length and loudness for the composer. */
export function renderComposerConfig(o: { bpm: number; lengthSec: number; title: string }): string {
  const bars = reelBarsAt(o.lengthSec, o.bpm)
  const duration = round3((bars * 240) / o.bpm)
  return [
    "// Written by ReelMakeEasy from the reel's setup, again on every setup: only your bpm is kept.",
    `// Set bpm to your music.mjs tempo. The reel is round(${o.lengthSec} x bpm / 240) whole bars, and`,
    "// music.mjs's sections must add up to exactly that many (duration below is that length).",
    'export default {',
    `  title: ${JSON.stringify(o.title)},`,
    `  bpm: ${o.bpm},`,
    "  meter: '4/4',",
    `  duration: ${duration},`,
    `  fps: ${MOTION_REEL_FPS},`,
    "  audio: { ending: 'ring', lufs: -14, tp: -1 },",
    '}',
    '',
  ].join('\n')
}

/**
 * The composer's `build/music.json` as a reel's grid: beats every 60/bpm seconds from 0, a
 * downbeat every bar, and its events exactly as written (kicks, snares and claps, the motif and
 * its voices' notes as the melody, chord starts, sections). A message saying what is wrong with
 * the file otherwise.
 */
export function composerScore(raw: unknown): ComposerScore | string {
  const json = parseMusicJson(raw)
  if (typeof json === 'string') return json
  const beatSec = 60 / json.bpm
  const durationSec = round3(json.duration)
  // From the unrounded length: rounding it to the millisecond can fall just short of the last beat.
  const count = Math.floor(json.duration / beatSec + 1e-3)
  const beats = Array.from({ length: count }, (_, i) => round3(i * beatSec))
  const downbeats = beats.filter((_, i) => i % json.beatsPerBar === 0)
  const sections = json.sections.map((s, i) => ({
    // A section ends where the next starts (music.json rounds both to the millisecond).
    endSec: Math.min(durationSec, nextStart(json.sections, i) ?? s.at + s.dur),
    energy: Math.max(0, Math.min(3, Math.round(s.energy))) as 0 | 1 | 2 | 3,
    name: s.name,
    startSec: s.at,
  }))
  // Nothing after the score's end (a loop ending's tail, or a file that says otherwise).
  const inside = (t: number) => t >= 0 && t < json.duration
  const events = tidyEvents(
    {
      chords: json.chords.map((c) => c.t).filter(inside),
      kicks: hitsOf(json, kickVoices(json)).filter((h) => inside(h.t)),
      melody: melodyOf(json).filter((m) => inside(m.t)),
      sections,
      snares: hitsOf(json, voicesWith(json, SNARE_INSTRUMENTS, SNARE_NAME)).filter((h) =>
        inside(h.t),
      ),
    },
    beats,
    durationSec,
  )
  const key = json.key
    ? `${json.key} ${typeof json.scale === 'string' ? json.scale : '(own scale)'}`
    : null
  return {
    grid: {
      beats,
      beatsPerBar: json.beatsPerBar,
      bpm: json.bpm,
      downbeats,
      durationSec,
      events,
      strongHits: strongHits(json.sections),
    },
    key,
    title: `Composed: ${key ?? 'no key'}, ${json.bpm} BPM`,
  }
}

/**
 * What the agent's composer run left in `reel/music/`, checked: the score and its music.json
 * exist and are newer than music.mjs, the QC has no FAIL, and the score is the reel's whole bars.
 * The score is copied to `composer-<time>.wav`. A message saying what to do otherwise.
 */
export function readComposedMusic(projectDir: string, lengthSec: number): ComposedMusic | string {
  const dir = path.join(projectDir, COMPOSER_DIR)
  const where = (file: string) => `reel/${COMPOSER_DIR}/${file}`
  const mtime = (file: string) => {
    try {
      return fs.statSync(path.join(dir, file)).mtimeMs
    } catch {
      return null
    }
  }
  // Read only what really is in the reel: a link to a file elsewhere is not a score.
  const outside = ['audio/score.wav', 'build/music.json', 'qc/score-report.json'].find(
    (file) => fs.existsSync(path.join(dir, file)) && !insideReal(projectDir, path.join(dir, file)),
  )
  if (outside)
    return `${where(outside)} is a link to a file outside the reel: delete it and run the composer again (\`cd reel/music && node tools/score.mjs --no-cues\`).`
  const source = mtime('music.mjs')
  if (source === null)
    return `There is no ${where('music.mjs')}: write it (the reelmakeeasy-music-composer skill), run \`cd reel/music && node tools/score.mjs --no-cues\`, then call motion_music again.`
  for (const file of ['audio/score.wav', 'build/music.json', 'qc/score-report.json']) {
    const made = mtime(file)
    if (made === null)
      return `There is no ${where(file)}: run the composer first (\`cd reel/music && node tools/score.mjs --no-cues\`, the whole score, not a slice).`
    if (made + 1 < source)
      return `${where(file)} is older than ${where('music.mjs')}: run the composer again (\`cd reel/music && node tools/score.mjs --no-cues\`) so the score is the music you wrote.`
  }
  const json = readJson(path.join(dir, 'build/music.json'), MAX_MUSIC_JSON_BYTES)
  if ('error' in json) return `${where('build/music.json')}: ${json.error}`
  const score = composerScore(json.value)
  if (typeof score === 'string') return `${where('build/music.json')}: ${score}`
  const report = readJson(path.join(dir, 'qc/score-report.json'), MAX_REPORT_BYTES)
  const sliced = 'error' in report ? null : slicedRun(report.value)
  if (sliced) return sliced
  const checks = 'error' in report ? [] : reportChecks(report.value)
  const harmony = harmonyRefusal(checks)
  if (harmony) return harmony
  const failed = checks.filter((c) => c.status === 'FAIL')
  if (failed.length) {
    const why = failed.map((c) => `${c.id}: ${c.msg}`).join('; ')
    return `The composer's QC failed: ${why}. Fix music.mjs (the skill's measurement section) and run it again.`
  }
  const { grid } = score
  const barSec = (60 / grid.bpm) * grid.beatsPerBar
  const bars = reelBarsAt(lengthSec, grid.bpm, grid.beatsPerBar)
  if (Math.abs(grid.durationSec - bars * barSec) > 0.05)
    return `The score is ${round3(grid.durationSec / barSec)} bars (${grid.durationSec} s); a ${lengthSec} s reel at ${grid.bpm} BPM is ${bars} bars (round(${lengthSec} x ${grid.bpm} / 240)): make the sections add up to ${bars} bars, run the composer again, then call motion_music.`
  const wav = path.join(dir, 'audio/score.wav')
  const size = fs.statSync(wav).size
  if (size < 1024 || size > MAX_WAV_BYTES)
    return `${where('audio/score.wav')} is not a score (${size} bytes): run the composer again.`
  // The WAV must be the whole score music.json describes (a slice rendered to it is not).
  const wavSec = wavSeconds(wav)
  if (wavSec === null || Math.abs(wavSec - grid.durationSec) > LENGTH_TOLERANCE_SEC)
    return `${where('audio/score.wav')} is ${wavSec === null ? 'not a WAV the composer wrote' : String(round3(wavSec)) + ' s'}, but build/music.json is the ${grid.durationSec} s score: run the whole score again (\`cd reel/music && node tools/score.mjs --no-cues\`, no slice), then call motion_music.`
  const file = path.join(dir, `composer-${Date.now()}.wav`)
  fs.copyFileSync(wav, file)
  // Its music.json goes with it, so a later setup that keeps this score reads its grid again.
  fs.copyFileSync(path.join(dir, 'build/music.json'), composerJsonOf(file))
  return { ...score, file, qc: qcLines(checks) }
}

/** Where a kept score's music.json lives: beside it, `composer-<time>.json`. */
export function composerJsonOf(file: string): string {
  return file.replace(/\.wav$/i, '.json')
}

/** A kept score's grid again (`composer-<time>.wav` and its music.json), or null. */
export function keptComposerScore(file: string): ComposerScore | null {
  const json = readJson(composerJsonOf(file), MAX_MUSIC_JSON_BYTES)
  if ('error' in json) return null
  const score = composerScore(json.value)
  return typeof score === 'string' ? null : score
}

/**
 * The composer's harmony check (`tools/audio/harmony.mjs`) must PASS: a score that measures clean
 * can still be dissonant (a mode switch, #11 chords over a pedal, an inharmonic lead holding
 * pitches against the chords), and nothing else here can hear that. A report without it is from
 * a composer older than the check. A message telling the agent what to fix, or null.
 */
function harmonyRefusal(checks: { id: string; msg: string; status: string }[]): null | string {
  const check = checks.find((c) => c.id === 'harmony')
  const rerun = '`cd reel/music && node tools/score.mjs --no-cues`'
  if (!check)
    return `qc/score-report.json has no harmony check (it is from an older composer): run ${rerun} again, fix what its harmony line lists, then call motion_music.`
  if (check.status === 'PASS') return null
  return `The composer's harmony check did not pass: ${check.msg.slice(0, 600)}. The score must be stable: fix every clash and note it lists (the full lists are under "harmony" in reel/music/qc/score-report.json; the rules are the composer skill's Harmony rules: one key in major, minor, dorian or mixolydian, every chord in the key (no borrowed chord but a Picardy last chord), 7th and 9th chords whose tones are in the key, every note a chord tone or its plain 9th/11th/6th with no passing tones, bass on roots and fifths, harmonic lead sounds), run ${rerun} again until harmony is ok, then call motion_music.`
}

function hitsOf(json: MusicJson, voices: string[]): { s: number; t: number }[] {
  return voices.flatMap((voice) => (json.hits[voice] ?? []).map(([t, vel]) => ({ s: vel, t })))
}

/** The kick voices: a kick instrument or a voice named as one, else the low hits (an 808 or a
 *  sub, by instrument or name). */
function kickVoices(json: MusicJson): string[] {
  const kicks = voicesWith(json, KICK_INSTRUMENTS, KICK_NAME)
  return kicks.length ? kicks : voicesWith(json, LOW_INSTRUMENTS, LOW_NAME)
}

/** Removes `file` when it is a symbolic link (the link only, never what it points at). */
function dropLink(file: string): void {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file)
  } catch {
    // Not there: nothing to remove.
  }
}

/** `file`, links resolved, is inside `root` (links resolved too). */
function insideReal(root: string, file: string): boolean {
  try {
    const base = fs.realpathSync(root)
    const real = fs.realpathSync(file)
    return real === base || real.startsWith(base + path.sep)
  } catch {
    return false
  }
}

/** The melody: the motif's notes (its accents, strength 1), then every other note of the
 *  voices it plays on (1 for an accent, velocity 0.9 and up, else 0.6). */
function melodyOf(json: MusicJson): { strength: number; t: number }[] {
  const motif = json.motif.map(([t]) => ({ strength: 1, t }))
  const taken = new Set(motif.map((m) => round3(m.t)))
  const voices = [...new Set(json.motif.map(([, , voice]) => voice))]
  const others = hitsOf(json, voices)
    .filter((h) => !taken.has(round3(h.t)))
    .map((h) => ({ strength: h.s >= 0.9 ? 1 : 0.6, t: h.t }))
  return [...motif, ...others]
}

/** The start of the section after `i` when it follows on (within 10 ms), else undefined. */
function nextStart(sections: MusicJson['sections'], i: number): number | undefined {
  const s = sections[i]
  const next = sections[i + 1]
  return s && next && Math.abs(next.at - (s.at + s.dur)) < 0.01 ? next.at : undefined
}

function parseChords(raw: unknown): MusicJson['chords'] {
  return (Array.isArray(raw) ? raw : [])
    .filter((c): c is { t: number } => isRecord(c) && isNum(c['t']))
    .map((c) => ({ t: c.t }))
}

function parseHits(raw: unknown): Hit[] | string {
  if (!Array.isArray(raw)) return 'hits are [time, velocity] pairs'
  return raw
    .slice(0, MAX_HITS_PER_VOICE)
    .filter((h): h is Hit => Array.isArray(h) && isNum(h[0]) && isNum(h[1]) && h[0] >= 0)
    .map(([t, vel]) => [t, vel])
}

function parseMotif(raw: unknown): MusicJson['motif'] {
  return (Array.isArray(raw) ? raw : [])
    .slice(0, MAX_HITS_PER_VOICE)
    .filter(
      (m): m is [number, number, string] =>
        Array.isArray(m) && isNum(m[0]) && isNum(m[1]) && typeof m[2] === 'string',
    )
}

/** music.json checked against the shape score.mjs writes; a message saying what is off. */
function parseMusicJson(raw: unknown): MusicJson | string {
  if (!isRecord(raw)) return 'not a JSON object'
  const { beatsPerBar, bpm, duration } = raw
  if (!isNum(bpm) || bpm < 40 || bpm > 240) return 'bpm must be a number from 40 to 240'
  if (!isNum(beatsPerBar) || beatsPerBar !== 4)
    return "the reel's grid is 4/4: write music.mjs in 4/4 (meter '4/4')"
  if (!isNum(duration) || duration <= 0 || duration > 600) return 'duration is not a length'
  const sections = parseSections(raw['sections'])
  if (typeof sections === 'string') return sections
  const hits = parseVoiceHits(raw['hits'])
  if (typeof hits === 'string') return hits
  return {
    beatsPerBar,
    bpm,
    chords: parseChords(raw['chords']),
    duration,
    hits,
    key: typeof raw['key'] === 'string' ? raw['key'].slice(0, 12) : null,
    motif: parseMotif(raw['motif']),
    scale: raw['scale'],
    sections,
    voices: parseVoices(raw['voices']),
  }
}

function parseSections(raw: unknown): MusicJson['sections'] | string {
  if (!Array.isArray(raw) || !raw.length) return 'it has no sections'
  const sections: MusicJson['sections'] = []
  for (const s of raw.slice(0, 256)) {
    if (!isRecord(s) || !isNum(s['at']) || !isNum(s['dur']) || typeof s['name'] !== 'string')
      return 'a section has no name, at or dur'
    sections.push({
      at: s['at'],
      dur: s['dur'],
      energy: isNum(s['energy']) ? s['energy'] : 2,
      name: s['name'].slice(0, 40),
    })
  }
  return sections
}

function parseVoiceHits(raw: unknown): MusicJson['hits'] | string {
  if (!isRecord(raw)) return 'it has no hits'
  const hits: MusicJson['hits'] = {}
  for (const [voice, list] of Object.entries(raw).slice(0, MAX_VOICES)) {
    const parsed = parseHits(list)
    if (typeof parsed === 'string') return `voice ${voice}: ${parsed}`
    hits[voice] = parsed
  }
  return hits
}

function parseVoices(raw: unknown): MusicJson['voices'] {
  const voices: MusicJson['voices'] = {}
  if (isRecord(raw))
    for (const [voice, v] of Object.entries(raw).slice(0, MAX_VOICES))
      voices[voice] = isRecord(v) && typeof v['inst'] === 'string' ? { inst: v['inst'] } : {}
  return voices
}

/** The QC in a few lines: how many checks passed, then each WARN. */
function qcLines(checks: { id: string; msg: string; status: string }[]): string[] {
  const passed = checks.filter((c) => c.status === 'PASS').map((c) => c.id)
  const warned = checks.filter((c) => c.status === 'WARN')
  return [
    ...(passed.length ? [`QC passed: ${passed.join(', ')}.`] : []),
    ...warned.map((c) => `QC WARN ${c.id}: ${c.msg.slice(0, 300)}`),
  ]
}

function readJson(file: string, maxBytes: number): { error: string } | { value: unknown } {
  try {
    const stat = fs.lstatSync(file)
    if (!stat.isFile()) return { error: 'not a file (a link is not read)' }
    if (stat.size > maxBytes) return { error: 'too large to read' }
    return { value: JSON.parse(fs.readFileSync(file, 'utf8')) as unknown }
  } catch {
    return { error: 'not readable JSON' }
  }
}

function reportChecks(report: unknown): { id: string; msg: string; status: string }[] {
  const checks = isRecord(report) && Array.isArray(report['checks']) ? report['checks'] : []
  return checks
    .slice(0, 64)
    .filter(isRecord)
    .map((c) => ({
      id: typeof c['id'] === 'string' ? c['id'] : '?',
      msg: typeof c['msg'] === 'string' ? c['msg'] : '',
      status: typeof c['status'] === 'string' ? c['status'] : '',
    }))
}

/** A message when the report is of a slice or another output, not the whole score. */
function slicedRun(report: unknown): null | string {
  if (!isRecord(report)) return null
  const { out, window } = report
  if ((window === null || window === undefined) && (out === undefined || out === 'audio/score.wav'))
    return null
  const what = window ? 'a slice' : 'another output (' + String(out).slice(0, 60) + ')'
  return `qc/score-report.json is of ${what}, not the whole score: run \`cd reel/music && node tools/score.mjs --no-cues\` with no slice and no --out, then call motion_music.`
}

/** The strongest moments: the sections that raise the energy (drops first), strongest first. */
function strongHits(sections: MusicJson['sections']): number[] {
  return sections
    .map((s, i) => ({ rise: s.energy - (sections[i - 1]?.energy ?? s.energy), s }))
    .filter((x) => x.s.at > 0 && x.rise > 0)
    .sort((a, b) => b.s.energy - a.s.energy || b.rise - a.rise || a.s.at - b.s.at)
    .slice(0, MAX_STRONG_HITS)
    .map((x) => round3(x.s.at))
}

/** The voices playing one of `instruments` (by music.json's voices) or named as one: a
 *  found-sound kit's `kick` built from a membrane counts as the kick. */
function voicesWith(json: MusicJson, instruments: Set<string>, name: RegExp): string[] {
  return Object.keys(json.hits).filter((voice) => {
    const inst = json.voices[voice]?.inst
    return (inst !== undefined && instruments.has(inst)) || name.test(voice)
  })
}

/** A WAV's length in seconds from its header (`fmt ` byte rate, `data` size), or null. */
function wavSeconds(file: string): null | number {
  let fd: number | undefined
  try {
    fd = fs.openSync(file, 'r')
    const head = Buffer.alloc(4096)
    const n = fs.readSync(fd, head, 0, head.length, 0)
    if (
      n < 12 ||
      head.toString('ascii', 0, 4) !== 'RIFF' ||
      head.toString('ascii', 8, 12) !== 'WAVE'
    )
      return null
    let byteRate = 0
    for (let at = 12; at + 8 <= n; ) {
      const id = head.toString('ascii', at, at + 4)
      const size = head.readUInt32LE(at + 4)
      if (id === 'fmt ' && at + 20 <= n) byteRate = head.readUInt32LE(at + 16)
      if (id === 'data') return byteRate > 0 ? size / byteRate : null
      at += 8 + size + (size % 2)
    }
    return null
  } catch {
    return null
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}
