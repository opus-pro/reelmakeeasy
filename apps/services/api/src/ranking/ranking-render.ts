import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { RANKING_FPS, RANKING_HEIGHT, RANKING_WIDTH } from '@reelmakeeasy/common/ranking/ranking-project'

/** Loudness the finished short is delivered at (streaming level, with headroom). */
export const RANKING_LOUDNESS = 'loudnorm=I=-14:TP=-1.5:LRA=11'

/** Runs a command quietly; rejects with the end of its output. */
export function run(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let out = ''
    const keep = (chunk: Buffer) => {
      out = (out + chunk.toString('utf8')).slice(-6000)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`${command} failed (${code}): ${out.trim().slice(-1200)}`)),
    )
  })
}

/** A clip's length in seconds and whether it has sound. */
export async function probeClip(file: string): Promise<{ durationSec: number; hasAudio: boolean }> {
  const out = await run(
    'ffprobe',
    ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file],
    path.dirname(file),
  )
  const parsed = JSON.parse(out) as { format?: { duration?: string }; streams?: { codec_type?: string }[] }
  const durationSec = Number(parsed.format?.duration)
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error('That file has no length: is it a video?')
  if (!parsed.streams?.some((s) => s.codec_type === 'video')) throw new Error('That file has no video.')
  return { durationSec, hasAudio: !!parsed.streams.some((s) => s.codec_type === 'audio') }
}

/**
 * The ffmpeg arguments for one segment: the clip's trim, scaled to cover the area under the
 * title band (cropped to fill, never letterboxed), the overlay on top, its own sound (or
 * silence) as 48 kHz stereo. Every segment has the same format, so they join without
 * re-encoding.
 */
export function segmentArgs(o: {
  bandHeight: number
  clipFile: string
  durSec: number
  hasAudio: boolean
  out: string
  overlay: string
  /** A sound that plays as the clip starts (the reveal sound), mixed over the clip's own. */
  sfx?: string
  startSec: number
}): string[] {
  const area = RANKING_HEIGHT - o.bandHeight
  const video =
    `[0:v]scale=${RANKING_WIDTH}:${area}:force_original_aspect_ratio=increase,` +
    `crop=${RANKING_WIDTH}:${area},setsar=1,fps=${RANKING_FPS},` +
    `pad=${RANKING_WIDTH}:${RANKING_HEIGHT}:0:${o.bandHeight}:black[base];` +
    `[base][1:v]overlay=0:0:format=auto,format=yuv420p[v]`
  const base = o.hasAudio
    ? `[0:a]aresample=48000,aformat=channel_layouts=stereo,apad`
    : `[2:a]aformat=channel_layouts=stereo`
  const sfxIndex = o.hasAudio ? 2 : 3
  const audio = o.sfx
    ? `${base}[clip];[${sfxIndex}:a]aresample=48000,aformat=channel_layouts=stereo,apad[fx];[clip][fx]amix=inputs=2:duration=first:normalize=0[a]`
    : `${base}[a]`
  return [
    '-v', 'error', '-y',
    '-ss', String(o.startSec), '-t', String(o.durSec), '-i', o.clipFile,
    '-loop', '1', '-t', String(o.durSec), '-i', o.overlay,
    ...(o.hasAudio ? [] : ['-f', 'lavfi', '-t', String(o.durSec), '-i', 'anullsrc=r=48000:cl=stereo']),
    ...(o.sfx ? ['-i', o.sfx] : []),
    '-filter_complex', `${video};${audio}`,
    '-map', '[v]', '-map', '[a]',
    '-t', String(o.durSec),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(RANKING_FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    o.out,
  ]
}

/**
 * The ffmpeg arguments for a transition slide: its full-frame PNG held for `durSec`, with its
 * sound (or silence), in the same format as the clip segments.
 */
export function transitionArgs(o: { durSec: number; out: string; png: string; sfx?: string }): string[] {
  const audio = o.sfx
    ? `[1:a]aformat=channel_layouts=stereo[bed];[2:a]aresample=48000,aformat=channel_layouts=stereo,apad[fx];[bed][fx]amix=inputs=2:duration=first:normalize=0[a]`
    : `[1:a]aformat=channel_layouts=stereo[a]`
  return [
    '-v', 'error', '-y',
    '-loop', '1', '-t', String(o.durSec), '-i', o.png,
    '-f', 'lavfi', '-t', String(o.durSec), '-i', 'anullsrc=r=48000:cl=stereo',
    ...(o.sfx ? ['-i', o.sfx] : []),
    '-filter_complex', `[0:v]scale=${RANKING_WIDTH}:${RANKING_HEIGHT},setsar=1,fps=${RANKING_FPS},format=yuv420p[v];${audio}`,
    '-map', '[v]', '-map', '[a]',
    '-t', String(o.durSec),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(RANKING_FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    o.out,
  ]
}

/** The last step: the joined short, a looped music bed under it (when there is one), even loudness. */
export function finishArgs(o: { joined: string; music?: { file: string; volume: number }; out: string }): string[] {
  const filter = o.music
    ? `[1:a]aresample=48000,aformat=channel_layouts=stereo,volume=${o.music.volume.toFixed(2)}[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0,${RANKING_LOUDNESS}[a]`
    : `[0:a]${RANKING_LOUDNESS}[a]`
  return [
    '-v', 'error', '-y',
    '-i', o.joined,
    ...(o.music ? ['-stream_loop', '-1', '-i', o.music.file] : []),
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    o.out,
  ]
}

/** One piece to render: a rank's clip under its overlay, or a transition slide. */
export type RenderPart =
  | { clipFile: string; durSec: number; kind: 'clip'; overlay: string; sfx?: string; startSec: number }
  | { durSec: number; kind: 'transition'; png: string; sfx?: string }

/**
 * Renders the short: each part (clip or slide) in order, joined, with the music bed and even
 * loudness. `onProgress` gets 0..1.
 */
export async function renderRanking(o: {
  bandHeight: number
  music?: { file: string; volume: number }
  onProgress: (progress: number) => void
  out: string
  parts: RenderPart[]
  workDir: string
}): Promise<void> {
  const files: string[] = []
  for (const [i, part] of o.parts.entries()) {
    const out = path.join(o.workDir, `part-${i}.mp4`)
    const args =
      part.kind === 'clip'
        ? segmentArgs({
            bandHeight: o.bandHeight,
            clipFile: part.clipFile,
            durSec: part.durSec,
            hasAudio: (await probeClip(part.clipFile)).hasAudio,
            out,
            overlay: part.overlay,
            sfx: part.sfx,
            startSec: part.startSec,
          })
        : transitionArgs({ durSec: part.durSec, out, png: part.png, sfx: part.sfx })
    await run('ffmpeg', args, o.workDir)
    files.push(out)
    o.onProgress(((i + 1) / o.parts.length) * 0.85)
  }
  const list = path.join(o.workDir, 'parts.txt')
  fs.writeFileSync(list, files.map((p) => `file '${path.basename(p)}'`).join('\n'))
  const joined = path.join(o.workDir, 'joined.mp4')
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], o.workDir)
  o.onProgress(0.92)
  await run('ffmpeg', finishArgs({ joined, music: o.music, out: o.out }), o.workDir)
  o.onProgress(1)
}
