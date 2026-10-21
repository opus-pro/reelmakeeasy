import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { STICKER_IN_SEC, STICKER_OUT_SEC } from '@reelmakeeasy/common/ranking/ranking-motion'
import { RANKING_FPS, RANKING_HEIGHT, RANKING_WIDTH } from '@reelmakeeasy/common/ranking/ranking-project'

/** Loudness the finished short is delivered at (streaming level, with headroom). */
export const RANKING_LOUDNESS = 'loudnorm=I=-14:TP=-1.5:LRA=11'

/** A library sound as the render plays it: its file, the part (seconds) and the level (1: as is). */
export type SoundFile = { endSec: number; file: string; startSec: number; volume: number }

/** A sound at a moment of a clip, in seconds from the clip's start as it plays. */
export type SoundCue = { atSec: number; sound: SoundFile }

/** ffmpeg input arguments for just the trimmed part of a sound. */
export const soundInput = (sound: SoundFile): string[] => [
  '-ss', String(sound.startSec), '-t', String(Math.max(0.05, sound.endSec - sound.startSec)), '-i', sound.file,
]

/** The filter that brings a sound input to the common format, at its level. */
const soundChain = (index: number, sound: SoundFile, tail = 'apad') =>
  `[${index}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${sound.volume.toFixed(2)},${tail}`

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

/** How long a photo plays as a clip. */
export const PHOTO_CLIP_SEC = 5

/**
 * A photo as a clip: `seconds` long at the export's size, slowly zooming in to its centre (so a
 * still doesn't look frozen). Made at twice the size first, so the zoom moves smoothly.
 */
export async function photoToClip(photo: string, out: string, seconds = PHOTO_CLIP_SEC): Promise<void> {
  const frames = Math.round(seconds * RANKING_FPS)
  const [w, h] = [RANKING_WIDTH * 2, RANKING_HEIGHT * 2]
  const zoom = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    `zoompan=z='1+0.12*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${RANKING_WIDTH}x${RANKING_HEIGHT}:fps=${RANKING_FPS}`,
    'format=yuv420p',
  ].join(',')
  await run(
    'ffmpeg',
    ['-y', '-v', 'error', '-i', photo, '-vf', zoom, '-frames:v', String(frames), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-movflags', '+faststart', out],
    path.dirname(out),
  )
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
 * A moving sticker over a segment: its picture (drawn by the studio, centred on its anchor),
 * where its anchor is, when it shows (segment seconds) and how it moves (`stickerMotionExpr`,
 * offsets in fractions of the frame). `fadeIn` / `fadeOut`: when its fades start (segment
 * seconds), if it has them.
 */
export type StickerLayer = {
  cx: number
  cy: number
  fadeIn?: number
  fadeOut?: number
  from: number
  motion: { dx: string; dy: string; scale: string }
  png: string
  to: number
}

/** The filter that animates sticker input `input` over `[from]`, out as `[to]`. */
export function stickerFilter(layer: StickerLayer, input: number, from: string, to: string, fadeSec: { in: number; out: number }): string {
  const { motion } = layer
  const size = (side: string) => `max(2,trunc(${side}*(${motion.scale})/2)*2)`
  const fades = [
    layer.fadeIn === undefined ? '' : `,fade=t=in:st=${layer.fadeIn}:d=${fadeSec.in}:alpha=1`,
    layer.fadeOut === undefined ? '' : `,fade=t=out:st=${layer.fadeOut}:d=${fadeSec.out}:alpha=1`,
  ].join('')
  const scale = motion.scale === '1' ? '' : `,scale=w='${size('iw')}':h='${size('ih')}':eval=frame`
  return (
    `[${input}:v]format=rgba${scale}${fades}[st${input}];` +
    `[${from}][st${input}]overlay=x='${layer.cx}+(${motion.dx})*${RANKING_WIDTH}-overlay_w/2':` +
    `y='${layer.cy}+(${motion.dy})*${RANKING_HEIGHT}-overlay_h/2':enable='between(t,${layer.from},${layer.to})':format=auto[${to}]`
  )
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
  /** Sounds at moments of the clip (the reveal sound at 0, meme sounds on the action), mixed
   *  over the clip's own sound. */
  cues?: SoundCue[]
  startSec: number
  /** Moving stickers over it (animated, or coming and going). */
  stickers?: StickerLayer[]
}): string[] {
  const area = RANKING_HEIGHT - o.bandHeight
  const video =
    `[0:v]scale=${RANKING_WIDTH}:${area}:force_original_aspect_ratio=increase,` +
    `crop=${RANKING_WIDTH}:${area},setsar=1,fps=${RANKING_FPS},` +
    `pad=${RANKING_WIDTH}:${RANKING_HEIGHT}:0:${o.bandHeight}:black[base];` +
    `[base][1:v]overlay=0:0:format=auto[ov0]`
  const base = o.hasAudio
    ? `[0:a]aresample=48000,aformat=channel_layouts=stereo,apad`
    : `[2:a]aformat=channel_layouts=stereo`
  const first = o.hasAudio ? 2 : 3
  const cues = (o.cues ?? []).filter((c) => c.atSec < o.durSec)
  const audio = cues.length
    ? `${base}[clip];` +
      cues
        .map((cue, i) => {
          const ms = Math.round(cue.atSec * 1000)
          return `${soundChain(first + i, cue.sound, `adelay=${ms}|${ms},apad`)}[fx${i}]`
        })
        .join(';') +
      `;[clip]${cues.map((_, i) => `[fx${i}]`).join('')}amix=inputs=${cues.length + 1}:duration=first:normalize=0[a]`
    : `${base}[a]`
  const layers = o.stickers ?? []
  const stickerStart = first + cues.length
  const stickers = layers.map((layer, i) =>
    stickerFilter(layer, stickerStart + i, `ov${i}`, `ov${i + 1}`, { in: STICKER_IN_SEC, out: STICKER_OUT_SEC }),
  )
  const finish = `[ov${layers.length}]format=yuv420p[v]`
  return [
    '-v', 'error', '-y',
    '-ss', String(o.startSec), '-t', String(o.durSec), '-i', o.clipFile,
    '-loop', '1', '-t', String(o.durSec), '-i', o.overlay,
    ...(o.hasAudio ? [] : ['-f', 'lavfi', '-t', String(o.durSec), '-i', 'anullsrc=r=48000:cl=stereo']),
    ...cues.flatMap((cue) => soundInput(cue.sound)),
    ...layers.flatMap((layer) => ['-loop', '1', '-framerate', String(RANKING_FPS), '-t', String(o.durSec), '-i', layer.png]),
    '-filter_complex', [video, ...stickers, finish, audio].join(';'),
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
export function transitionArgs(o: { durSec: number; out: string; png: string; sfx?: SoundFile }): string[] {
  const audio = o.sfx
    ? `[1:a]aformat=channel_layouts=stereo[bed];${soundChain(2, o.sfx)}[fx];[bed][fx]amix=inputs=2:duration=first:normalize=0[a]`
    : `[1:a]aformat=channel_layouts=stereo[a]`
  return [
    '-v', 'error', '-y',
    '-loop', '1', '-t', String(o.durSec), '-i', o.png,
    '-f', 'lavfi', '-t', String(o.durSec), '-i', 'anullsrc=r=48000:cl=stereo',
    ...(o.sfx ? soundInput(o.sfx) : []),
    '-filter_complex', `[0:v]scale=${RANKING_WIDTH}:${RANKING_HEIGHT},setsar=1,fps=${RANKING_FPS},format=yuv420p[v];${audio}`,
    '-map', '[v]', '-map', '[a]',
    '-t', String(o.durSec),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-r', String(RANKING_FPS),
    '-c:a', 'aac', '-b:a', '192k', '-ar', '48000',
    o.out,
  ]
}

/**
 * The last step: the joined short, a music bed under it (when there is one: its trimmed part,
 * looped to the end, at its own level times the short's music level), even loudness.
 */
export function finishArgs(o: { joined: string; music?: { level: number; sound: SoundFile }; out: string }): string[] {
  const music = o.music
  const filter = music
    ? `[1:a]atrim=start=${music.sound.startSec}:end=${music.sound.endSec},asetpts=PTS-STARTPTS,aloop=loop=-1:size=2e9,aresample=48000,aformat=channel_layouts=stereo,volume=${(music.sound.volume * music.level).toFixed(2)}[bed];[0:a][bed]amix=inputs=2:duration=first:normalize=0,${RANKING_LOUDNESS}[a]`
    : `[0:a]${RANKING_LOUDNESS}[a]`
  return [
    '-v', 'error', '-y',
    '-i', o.joined,
    ...(music ? ['-i', music.sound.file] : []),
    '-filter_complex', filter,
    '-map', '0:v', '-map', '[a]',
    '-c:v', 'copy', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    o.out,
  ]
}

/** One piece to render: a rank's clip under its overlay, or a transition slide. */
export type RenderPart =
  | {
      clipFile: string
      cues?: SoundCue[]
      durSec: number
      kind: 'clip'
      overlay: string
      startSec: number
      stickers?: StickerLayer[]
    }
  | { durSec: number; kind: 'transition'; png: string; sfx?: SoundFile }

/**
 * Renders the short: each part (clip or slide) in order, joined, with the music bed and even
 * loudness. `onProgress` gets 0..1.
 */
export async function renderRanking(o: {
  bandHeight: number
  music?: { level: number; sound: SoundFile }
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
            cues: part.cues,
            overlay: part.overlay,
            startSec: part.startSec,
            stickers: part.stickers,
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
