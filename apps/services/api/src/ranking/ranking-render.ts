import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import {
  RANKING_FPS,
  RANKING_HEIGHT,
  RANKING_WIDTH,
  type RankingSegment,
} from '@reelmakeeasy/common/ranking/ranking-project'

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
  startSec: number
}): string[] {
  const area = RANKING_HEIGHT - o.bandHeight
  const video =
    `[0:v]scale=${RANKING_WIDTH}:${area}:force_original_aspect_ratio=increase,` +
    `crop=${RANKING_WIDTH}:${area},setsar=1,fps=${RANKING_FPS},` +
    `pad=${RANKING_WIDTH}:${RANKING_HEIGHT}:0:${o.bandHeight}:black[base];` +
    `[base][1:v]overlay=0:0:format=auto,format=yuv420p[v]`
  const audio = o.hasAudio
    ? `[0:a]aresample=48000,aformat=channel_layouts=stereo,apad[a]`
    : `[2:a]aformat=channel_layouts=stereo[a]`
  return [
    '-v', 'error', '-y',
    '-ss', String(o.startSec), '-t', String(o.durSec), '-i', o.clipFile,
    '-loop', '1', '-t', String(o.durSec), '-i', o.overlay,
    ...(o.hasAudio ? [] : ['-f', 'lavfi', '-t', String(o.durSec), '-i', 'anullsrc=r=48000:cl=stereo']),
    '-filter_complex', `${video};${audio}`,
    '-map', '[v]', '-map', '[a]',
    '-t', String(o.durSec),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(RANKING_FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    o.out,
  ]
}

/**
 * Renders the short: each segment's clip under its overlay, joined in reveal order, the sound
 * evened out. `overlays[i]` is segment i's PNG (the studio drew it). `onProgress` gets 0..1.
 */
export async function renderRanking(o: {
  bandHeight: number
  clipFile: (segment: RankingSegment) => string
  onProgress: (progress: number) => void
  out: string
  overlays: string[]
  segments: RankingSegment[]
  workDir: string
}): Promise<void> {
  const parts: string[] = []
  for (const [i, segment] of o.segments.entries()) {
    const clip = segment.item.clip
    if (!clip) continue
    const clipFile = o.clipFile(segment)
    const { hasAudio } = await probeClip(clipFile)
    const part = path.join(o.workDir, `part-${i}.mp4`)
    await run(
      'ffmpeg',
      segmentArgs({
        bandHeight: o.bandHeight,
        clipFile,
        durSec: segment.durSec,
        hasAudio,
        out: part,
        overlay: o.overlays[i] as string,
        startSec: clip.trimStartSec,
      }),
      o.workDir,
    )
    parts.push(part)
    o.onProgress(((i + 1) / o.segments.length) * 0.85)
  }
  const list = path.join(o.workDir, 'parts.txt')
  fs.writeFileSync(list, parts.map((p) => `file '${path.basename(p)}'`).join('\n'))
  const joined = path.join(o.workDir, 'joined.mp4')
  await run('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined], o.workDir)
  o.onProgress(0.92)
  await run(
    'ffmpeg',
    ['-v', 'error', '-y', '-i', joined, '-c:v', 'copy', '-af', RANKING_LOUDNESS, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', o.out],
    o.workDir,
  )
  o.onProgress(1)
}
