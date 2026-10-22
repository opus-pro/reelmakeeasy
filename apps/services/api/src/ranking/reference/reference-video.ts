import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { decodeAudioMono, SOUND_ANALYSIS_RATE } from '@reelmakeeasy/common/audio/decode-audio'
import {
  describeSound,
  detectOnsets,
  findPulse,
  type LibraryPrint,
  matchSound,
  spectrogram,
} from '@reelmakeeasy/common/audio/sound-analysis'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'

/** How much of a reference is read: a Short is under a minute; three covers a long one. */
export const REFERENCE_MAX_SEC = 180
/** Sound effects reported at most (the strongest, back in time order). */
const SOUNDS_MAX = 40
const FRAME_WIDTH = 360

const YOUTUBE_HOSTS = new Set(['m.youtube.com', 'www.youtube.com', 'youtu.be', 'youtube.com'])

export class ReferenceError extends Error {}

/** Runs a command and keeps its whole output (scene detection prints a line per frame). */
function exec(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs = 10 * 60_000,
  env?: NodeJS.ProcessEnv,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    const keep = (chunk: Buffer) => {
      if (out.length < 8_000_000) out += chunk.toString('utf8')
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(out)
      else reject(new Error(`${command} failed (${code}): ${out.trim().slice(-2000)}`))
    })
  })
}

/** A YouTube video link (watch, shorts, youtu.be), normalized; throws for anything else. */
export function youtubeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new ReferenceError("That isn't a link. Paste a YouTube video's address (TikTok isn't supported yet).")
  }
  if (url.protocol !== 'https:' || !YOUTUBE_HOSTS.has(url.hostname.toLowerCase()))
    throw new ReferenceError(
      /tiktok\./i.test(url.hostname)
        ? "TikTok links aren't supported yet: TikTok blocks automated downloads. Use a YouTube link, or attach the video."
        : 'Only YouTube links are supported for now (or attach the video).',
    )
  return url.toString()
}

const YT_DLP_ASSET: Partial<Record<string, string>> = {
  'darwin-arm64': 'yt-dlp_macos',
  'darwin-x64': 'yt-dlp_macos',
  'linux-arm64': 'yt-dlp_linux_aarch64',
  'linux-x64': 'yt-dlp_linux',
  'win32-x64': 'yt-dlp.exe',
}

/** yt-dlp: the one on PATH, else its official release, fetched once into the data folder. */
export async function ytDlp(binDir: string = path.join(dataDir(), 'bin')): Promise<string> {
  try {
    await exec('yt-dlp', ['--version'], os.tmpdir(), 15_000)
    return 'yt-dlp'
  } catch {
    // Not installed: use (or fetch) our own copy.
  }
  const asset = YT_DLP_ASSET[`${process.platform}-${process.arch}`]
  if (!asset) throw new ReferenceError(`yt-dlp isn't available for ${process.platform}-${process.arch}: install it to read YouTube links.`)
  const file = path.join(binDir, asset === 'yt-dlp.exe' ? asset : 'yt-dlp')
  if (!fs.existsSync(file)) {
    const response = await fetch(`https://github.com/yt-dlp/yt-dlp/releases/latest/download/${asset}`)
    if (!response.ok) throw new ReferenceError(`yt-dlp could not be downloaded (${response.status}). Install it (brew install yt-dlp) and try again.`)
    fs.mkdirSync(binDir, { recursive: true })
    fs.writeFileSync(`${file}.tmp`, Buffer.from(await response.arrayBuffer()))
    // yt-dlp's release is a single executable: it must be runnable by its owner.
    // eslint-disable-next-line sonarjs/file-permissions -- our own copy, in the data folder
    fs.chmodSync(`${file}.tmp`, 0o755)
    fs.renameSync(`${file}.tmp`, file)
  }
  return file
}

/**
 * The certificates the system trusts, as a PEM file for yt-dlp: its standalone build trusts only
 * its own bundled list, so on a network that inspects HTTPS (a company proxy, a VPN) it fails the
 * certificate check where the browser works. `SSL_CERT_FILE` / `NODE_EXTRA_CA_CERTS` when set,
 * plus (on macOS) the system keychains.
 */
async function systemCaBundle(binDir: string): Promise<string> {
  const file = path.join(binDir, 'system-ca.pem')
  const parts: string[] = []
  for (const extra of [process.env['SSL_CERT_FILE'], process.env['NODE_EXTRA_CA_CERTS']]) {
    if (extra && fs.existsSync(extra)) parts.push(fs.readFileSync(extra, 'utf8'))
  }
  if (process.platform === 'darwin') {
    parts.push(
      await exec(
        'security',
        ['find-certificate', '-a', '-p', '/Library/Keychains/System.keychain', '/System/Library/Keychains/SystemRootCertificates.keychain'],
        os.tmpdir(),
        30_000,
      ).catch(() => ''),
    )
  }
  fs.mkdirSync(binDir, { recursive: true })
  fs.writeFileSync(file, parts.join('\n'))
  return file
}

/** Why yt-dlp failed, in words for the user (and what to do). */
export function downloadFailure(output: string): string {
  if (/confirm you.?re not a bot|Sign in to confirm/i.test(output))
    return "YouTube asked to confirm this computer isn't a bot (it does this on VPNs and some networks). Attach the video file instead, or set YOUTUBE_COOKIES_FROM_BROWSER (e.g. chrome) in .env so downloads use your browser's YouTube sign-in."
  if (/Private video|members-only|age/i.test(output)) return "That video isn't public, so it can't be read. Attach the video file instead."
  if (/Video unavailable|not available/i.test(output)) return 'That video is unavailable. Check the link, or attach the video file.'
  if (/CERTIFICATE_VERIFY_FAILED/.test(output))
    return "This computer's network blocked the connection to YouTube (a certificate check failed). Attach the video file instead."
  const line = output.split('\n').find((l) => l.startsWith('ERROR'))
  return `The video could not be downloaded${line ? `: ${line.replace(/^ERROR:\s*/, '').slice(0, 200)}` : '.'} Attach the video file instead.`
}

/** Downloads a YouTube video (720p at most, its first three minutes) into `dir`; returns the file and its title. */
export async function downloadYoutube(url: string, dir: string): Promise<{ file: string; title: null | string }> {
  fs.mkdirSync(dir, { recursive: true })
  const binDir = path.join(dataDir(), 'bin')
  const binary = await ytDlp(binDir)
  const cookies = process.env['YOUTUBE_COOKIES_FROM_BROWSER']?.trim()
  const args = [
    '--no-playlist',
    '--no-progress',
    // YouTube needs a JavaScript runtime for some formats: the one running this app.
    '--js-runtimes',
    `node:${process.execPath}`,
    ...(cookies ? ['--cookies-from-browser', cookies] : []),
    '-f',
    'bv*[height<=720]+ba/b[height<=720]/b',
    '--merge-output-format',
    'mp4',
    '--download-sections',
    `*0-${REFERENCE_MAX_SEC}`,
    '--max-filesize',
    '400M',
    '--print',
    'after_move:title',
    '-o',
    'reference.%(ext)s',
    url,
  ]
  const attempt = (extra: string[], env?: NodeJS.ProcessEnv) => exec(binary, [...extra, ...args], dir, 5 * 60_000, env)
  let out: string
  try {
    out = await attempt([])
  } catch (error) {
    const message = (error as Error).message
    if (!/CERTIFICATE_VERIFY_FAILED/.test(message)) throw new ReferenceError(downloadFailure(message))
    // A network that inspects HTTPS: retry trusting the system's certificates.
    const bundle = await systemCaBundle(binDir)
    out = await attempt(['--compat-options', 'no-certifi'], { ...process.env, SSL_CERT_FILE: bundle }).catch((retry: Error) => {
      throw new ReferenceError(downloadFailure(retry.message))
    })
  }
  const name = fs.readdirSync(dir).find((n) => n.startsWith('reference.') && !n.endsWith('.part'))
  if (!name) throw new ReferenceError('The video could not be downloaded. Attach the video file instead.')
  const title = out.trim().split('\n').filter(Boolean).at(-1) ?? null
  return { file: path.join(dir, name), title }
}

export async function probeDuration(file: string): Promise<number> {
  const out = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], path.dirname(file), 60_000)
  const sec = Number(out.trim())
  if (!Number.isFinite(sec) || sec <= 0) throw new ReferenceError("That file isn't a video FFmpeg can read.")
  return sec
}

/** Shot changes, by FFmpeg's scene score. */
export async function detectCuts(file: string, maxSec: number, threshold = 0.3): Promise<number[]> {
  const out = await exec(
    'ffmpeg',
    ['-hide_banner', '-t', String(maxSec), '-i', file, '-an', '-vf', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'],
    path.dirname(file),
  )
  return [...out.matchAll(/pts_time:([\d.]+)/g)].map((m) => Math.round(Number(m[1]) * 100) / 100)
}

async function frameAt(file: string, atSec: number, out: string, width = FRAME_WIDTH): Promise<void> {
  await exec(
    'ffmpeg',
    ['-v', 'error', '-y', '-ss', atSec.toFixed(3), '-i', file, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', out],
    path.dirname(out),
    60_000,
  )
}

export type ReferenceShot = { endSec: number; frame: string; startSec: number }
export type ReferenceSound = {
  atSec: number
  /** About how long it rings. */
  durationSec: number
  /** In words, for finding it: "short low boom". */
  description: string
  /** A frame just after it starts: what the sound goes with. */
  frame: string
  /** The library sound it is, when one is clearly the closest and close enough. */
  match: null | { id: string; name: string; score: number }
  /** Library sounds it is like, when none is clearly it. */
  maybe: { id: string; name: string; score: number }[]
  /** On the steady music beat (a kick or snare of the music, not a sound effect). */
  onBeat: boolean
  /** In the shot that starts at this many seconds into the shot (the action's moment in its clip). */
  inShot: { index: number; secIntoShot: number } | null
  strength: number
}

export type ReferenceAnalysis = {
  durationSec: number
  /** Files, relative to the analysis folder. */
  files: { contactSheet: string; titleFrame: string }
  medianShotSec: null | number
  /** A steady beat under it (music), when there is one. */
  music: null | { bpm: number }
  shots: ReferenceShot[]
  sounds: ReferenceSound[]
  source: { file: string; title: null | string; url: null | string }
}

/**
 * Reads a video for its pattern: its shots (a frame each), a full-size frame for the title, a
 * contact sheet, and its sound effects (when each starts, what it is like, the library sound
 * it matches). Writes the frames and `analysis.json` into `dir` (frame paths are relative to it).
 */
export async function analyzeVideo(
  file: string,
  dir: string,
  library: LibraryPrint[],
  source: { title: null | string; url: null | string },
): Promise<ReferenceAnalysis> {
  fs.mkdirSync(path.join(dir, 'frames'), { recursive: true })
  const durationSec = Math.min(await probeDuration(file), REFERENCE_MAX_SEC)
  const cuts = (await detectCuts(file, durationSec)).filter((t) => t > 0.2 && t < durationSec - 0.2)
  const starts = [0, ...cuts]
  const shots: ReferenceShot[] = []
  for (const [i, startSec] of starts.entries()) {
    const endSec = starts[i + 1] ?? durationSec
    const frame = path.join('frames', `shot-${String(i + 1).padStart(2, '0')}-at-${startSec.toFixed(2)}s.jpg`)
    await frameAt(file, Math.min(endSec - 0.05, startSec + Math.min(0.6, (endSec - startSec) / 2)), path.join(dir, frame))
    shots.push({ endSec: round2(endSec), frame, startSec: round2(startSec) })
  }
  const titleFrame = 'title-frame.jpg'
  await frameAt(file, Math.min(1.5, durationSec / 2), path.join(dir, titleFrame), 1080)
  const contactSheet = 'contact-sheet.jpg'
  await exec(
    'ffmpeg',
    ['-v', 'error', '-y', '-t', String(durationSec), '-i', file, '-vf', `fps=${16 / durationSec},scale=270:-2,tile=8x2:padding=4:color=black`, '-frames:v', '1', '-q:v', '4', path.join(dir, contactSheet)],
    dir,
  )

  let sounds: ReferenceSound[] = []
  let music: ReferenceAnalysis['music'] = null
  try {
    const samples = await decodeAudioMono(file, SOUND_ANALYSIS_RATE, durationSec)
    const spec = spectrogram(samples)
    const all = detectOnsets(spec)
    const pulse = findPulse(all)
    music = pulse ? { bpm: pulse.bpm } : null
    const onsets = all
      .map((onset, i) => ({ ...onset, onBeat: pulse?.onPulse.has(i) ?? false }))
      .toSorted((a, b) => b.strength - a.strength)
      .slice(0, SOUNDS_MAX)
      .toSorted((a, b) => a.atSec - b.atSec)
    for (const [i, onset] of onsets.entries()) {
      const frame = path.join('frames', `sound-${String(i + 1).padStart(2, '0')}-at-${onset.atSec.toFixed(2)}s.jpg`)
      await frameAt(file, Math.min(durationSec - 0.05, onset.atSec + 0.1), path.join(dir, frame))
      const shotIndex = shots.findLastIndex((s) => s.startSec <= onset.atSec + 0.05)
      const shot = shots[shotIndex]
      sounds.push({
        atSec: onset.atSec,
        ...describeSound(spec, onset.atSec),
        frame,
        inShot: shot ? { index: shotIndex + 1, secIntoShot: round2(Math.max(0, onset.atSec - shot.startSec)) } : null,
        ...matchSound(spec, onset.atSec, library),
        onBeat: onset.onBeat,
        strength: onset.strength,
      })
    }
  } catch {
    // A silent video has no sounds to read; its shots still say how it moves.
    sounds = []
    music = null
  }

  const lengths = shots.map((s) => s.endSec - s.startSec).toSorted((a, b) => a - b)
  const analysis: ReferenceAnalysis = {
    durationSec: round2(durationSec),
    files: { contactSheet, titleFrame },
    medianShotSec: lengths.length ? round2(lengths[Math.floor(lengths.length / 2)] as number) : null,
    music,
    shots,
    sounds,
    source: { file: path.basename(file), ...source },
  }
  fs.writeFileSync(path.join(dir, 'analysis.json'), `${JSON.stringify(analysis, null, 1)}\n`)
  return analysis
}

/**
 * A clip's action moments, for trims and sound cues: its strongest sound onsets and its shot
 * changes, in seconds from the clip's start.
 */
export async function clipMoments(file: string): Promise<{
  cuts: number[]
  durationSec: number
  sounds: { atSec: number; description: string; strength: number }[]
}> {
  const durationSec = Math.min(await probeDuration(file), REFERENCE_MAX_SEC)
  const cuts = await detectCuts(file, durationSec)
  let sounds: { atSec: number; description: string; strength: number }[] = []
  try {
    const spec = spectrogram(await decodeAudioMono(file, SOUND_ANALYSIS_RATE, durationSec))
    sounds = detectOnsets(spec, { minStrength: 0.3 })
      .toSorted((a, b) => b.strength - a.strength)
      .slice(0, 8)
      .toSorted((a, b) => a.atSec - b.atSec)
      .map((o) => ({ atSec: o.atSec, description: describeSound(spec, o.atSec).description, strength: o.strength }))
  } catch {
    sounds = []
  }
  return { cuts, durationSec: round2(durationSec), sounds }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
