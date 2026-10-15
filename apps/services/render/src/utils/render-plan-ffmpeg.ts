/**
 * Renders a render plan with plain ffmpeg (the only renderer the local app has).
 * It covers what Story Mode's final cut uses: video and image clips laid
 * out back to back on one video track (static crop, full-frame fit) plus audio
 * clips. Anything else -- overlays, captions, effects, animated transforms -- is
 * rejected up front with `UnsupportedRenderPlanError` rather than rendered wrong.
 */
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { promisify } from 'node:util'

import {
  buildCaptionOverlay,
  type CaptionOverlay,
  type CaptionSegment,
} from '@reelmakeeasy/common/adapters/caption/caption-painter'
import { logger } from '@reelmakeeasy/common/logger'
import {
  AssetType,
  type AudioSeg,
  type KeyFrame,
  type RenderPlan,
  type Seg,
  SegType,
  type VideoSeg,
  type VKF,
} from '@reelmakeeasy/common/types/render-plan-struct'
import { runFfmpeg } from '@reelmakeeasy/common/utils/cmdline'

const execFileAsync = promisify(execFile)

interface AudioClip {
  durationSec: number
  file: string
  sourceStartSec: number
  startSec: number
  volume: number
}

type XY = [number, number]

/** A plan feature the local ffmpeg renderer cannot reproduce faithfully. */
export class UnsupportedRenderPlanError extends Error {
  override name = 'UnsupportedRenderPlanError'
}

/** Fields the plan carries that the shared types leave out. */
type PlanAudioSeg = AudioSeg & { loop?: number; speed?: number }

type PlanVideoSeg = VideoSeg & { effects?: unknown[] }

interface VisualClip {
  crop?: { h: number; w: number; x: number; y: number }
  durationSec: number
  file: string
  isImage: boolean
  sourceStartSec: number
  startSec: number
  volume: number
}

/** A value, or a keyframe list that must hold at most one (static) keyframe. */
function staticValue<T extends number | XY>(
  value: undefined | VKF<(number | XY) & T>,
  what: string,
  segId: string,
): T | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || typeof value[0] === 'number') return value as T
  const frames = value as Array<KeyFrame<T>>
  if (frames.length > 1) {
    throw new UnsupportedRenderPlanError(`segment ${segId} animates ${what}`)
  }
  return frames[0]?.v
}

/** The plan writes volume both as a fraction (0~1) and as a percent (0~100). */
function volumeOf(volume: number | undefined): number {
  if (volume === undefined) return 1
  return volume > 1 ? volume / 100 : volume
}

const isZero = (xy: undefined | XY) => !xy || (xy[0] === 0 && xy[1] === 0)
const isOne = (xy: undefined | XY) => !xy || (xy[0] === 1 && xy[1] === 1)

function resolveMedia(uri: string | undefined, mediaDir: string, segId: string): string {
  if (!uri) throw new Error(`Segment ${segId} has no media`)
  const file = path.resolve(mediaDir, uri)
  if (!fs.existsSync(file)) throw new Error(`Media for segment ${segId} not found: ${file}`)
  return file
}

function toAudioClip(seg: PlanAudioSeg, mediaDir: string): AudioClip {
  if ((seg.speed ?? 1) !== 1)
    throw new UnsupportedRenderPlanError(`segment ${seg.id} changes speed`)
  if (seg.loop) throw new UnsupportedRenderPlanError(`segment ${seg.id} loops`)
  return {
    durationSec: (seg.out - seg.in) / 1000,
    file: resolveMedia(seg.uri, mediaDir, seg.id),
    sourceStartSec: (seg.trimStart ?? 0) / 1000,
    startSec: seg.in / 1000,
    volume: volumeOf(seg.volume),
  }
}

function toVisualClip(seg: PlanVideoSeg, mediaDir: string): VisualClip {
  const assetType = seg.assetType ?? AssetType.Video
  if (assetType !== AssetType.Video && assetType !== AssetType.Image) {
    throw new UnsupportedRenderPlanError(`segment ${seg.id} has asset type ${assetType}`)
  }
  if ((seg.speed ?? 1) !== 1)
    throw new UnsupportedRenderPlanError(`segment ${seg.id} changes speed`)
  if (seg.loop) throw new UnsupportedRenderPlanError(`segment ${seg.id} loops`)
  if (seg.effects?.length) throw new UnsupportedRenderPlanError(`segment ${seg.id} has effects`)
  if (staticValue(seg.rotate, 'rotation', seg.id) ?? 0) {
    throw new UnsupportedRenderPlanError(`segment ${seg.id} is rotated`)
  }
  if ((staticValue(seg.opacity, 'opacity', seg.id) ?? 1) !== 1) {
    throw new UnsupportedRenderPlanError(`segment ${seg.id} is translucent`)
  }
  if (
    !isZero(staticValue<XY>(seg.position, 'position', seg.id)) ||
    !isOne(staticValue<XY>(seg.scale, 'scale', seg.id))
  ) {
    throw new UnsupportedRenderPlanError(`segment ${seg.id} is not full-frame`)
  }
  const cropPos = staticValue<XY>(seg.cropPosition, 'crop', seg.id)
  const cropSize = staticValue<XY>(seg.cropSize, 'crop', seg.id)
  const crop =
    cropSize && !isOne(cropSize)
      ? { h: cropSize[1], w: cropSize[0], x: cropPos?.[0] ?? 0, y: cropPos?.[1] ?? 0 }
      : undefined

  return {
    crop,
    durationSec: (seg.out - seg.in) / 1000,
    file: resolveMedia(seg.uri, mediaDir, seg.id),
    isImage: assetType === AssetType.Image,
    sourceStartSec: (seg.trimStart ?? 0) / 1000,
    startSec: seg.in / 1000,
    volume: volumeOf(seg.volume),
  }
}

/** Splits the plan into one ordered, non-overlapping video lane and the audio clips. */
// Caption presets (Classic's fill-pop, Punch's highlight colour, Explainer's strip and word box,
// the stamps' strip) are drawn as the editor draws them, any other preset as fill-pop: see
// adapters/caption/caption-layout (`presetOf`) and caption-painter.
const CAPTION_PRESET_URI = 'caption-preset://'

function collectClips(plan: RenderPlan, mediaDir: string) {
  const visual: VisualClip[] = []
  const audio: AudioClip[] = []
  const captions: CaptionSegment[] = []
  let videoTracks = 0
  for (const track of plan.tracks) {
    const segs = track.segs as Seg[]
    if (!segs.length) continue
    for (const seg of segs) {
      if (seg.type === SegType.Video) {
        visual.push(toVisualClip(seg as PlanVideoSeg, mediaDir))
      } else if (seg.type === SegType.Audio) {
        audio.push(toAudioClip(seg as PlanAudioSeg, mediaDir))
      } else if (
        seg.type === SegType.Text &&
        (seg as { uri?: string }).uri?.startsWith(CAPTION_PRESET_URI)
      ) {
        captions.push(seg as unknown as CaptionSegment)
      } else {
        throw new UnsupportedRenderPlanError(`track ${track.id} has ${seg.type} segments`)
      }
    }
    if (segs.some((s) => s.type === SegType.Video)) videoTracks++
  }
  if (videoTracks > 1) throw new UnsupportedRenderPlanError('more than one video track')
  visual.sort((a, b) => a.startSec - b.startSec)
  for (let i = 1; i < visual.length; i++) {
    if (visual[i].startSec < visual[i - 1].startSec + visual[i - 1].durationSec - 0.001) {
      throw new UnsupportedRenderPlanError('video segments overlap')
    }
  }
  return { audio, captions, visual }
}

async function hasAudioStream(file: string): Promise<boolean> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a',
    '-show_entries',
    'stream=index',
    '-of',
    'csv=p=0',
    file,
  ])
  return stdout.trim().length > 0
}

function parseFrameRate(rate: string | undefined): number {
  const [num, den] = (rate ?? '30').split('/').map(Number)
  const fps = den ? num / den : num
  return Number.isFinite(fps) && fps > 0 ? fps : 30
}

const sec = (n: number) => n.toFixed(3)

export async function renderPlanWithFfmpeg(options: {
  /** Folder the plan's relative media URIs resolve against. */
  mediaDir: string
  outputPath: string
  plan: RenderPlan
  /** Render only [start, end] ms of the timeline; `[0, 0]` or unset renders all of it. */
  timeRangeMs?: [number, number]
}): Promise<string> {
  const { mediaDir, outputPath, plan } = options
  const width = plan.videoInfo?.width ?? 1080
  const height = plan.videoInfo?.height ?? 1920
  const fps = parseFrameRate(plan.videoInfo?.frameRate)
  const sampleRate = plan.audioInfo?.sampleRate ?? 48000
  const layout = (plan.audioInfo?.channels ?? 2) === 1 ? 'mono' : 'stereo'

  const { audio, captions, visual } = collectClips(plan, mediaDir)
  const totalSec = Math.max(
    0,
    ...visual.map((c) => c.startSec + c.durationSec),
    ...audio.map((c) => c.startSec + c.durationSec),
  )
  if (totalSec <= 0) throw new UnsupportedRenderPlanError('the plan has no media')

  const args: string[] = []
  const filters: string[] = []
  let inputIndex = 0
  const addInput = (file: string, isImage: boolean, durationSec: number) => {
    if (isImage) args.push('-loop', '1', '-t', sec(durationSec))
    args.push('-i', file)
    return inputIndex++
  }

  const fit = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=${fps},format=yuv420p`
  const lane: string[] = []
  const mixes: string[] = []
  let cursor = 0
  const gap = (durationSec: number) => {
    const label = `g${lane.length}`
    filters.push(
      `color=c=black:s=${width}x${height}:r=${fps}:d=${sec(durationSec)},format=yuv420p,setsar=1[${label}]`,
    )
    lane.push(`[${label}]`)
  }

  for (const [i, clip] of visual.entries()) {
    if (clip.startSec > cursor + 0.001) gap(clip.startSec - cursor)
    const input = addInput(clip.file, clip.isImage, clip.durationSec)
    const crop = clip.crop
      ? `crop=w=iw*${clip.crop.w}:h=ih*${clip.crop.h}:x=iw*${clip.crop.x}:y=ih*${clip.crop.y},`
      : ''
    const trim = clip.isImage
      ? ''
      : `trim=start=${sec(clip.sourceStartSec)}:duration=${sec(clip.durationSec)},`
    // tpad + trim pin the clip to exactly its slot, even when the source runs short.
    filters.push(
      `[${input}:v]${trim}setpts=PTS-STARTPTS,${crop}${fit},tpad=stop_mode=clone:stop_duration=${sec(clip.durationSec)},trim=duration=${sec(clip.durationSec)},setpts=PTS-STARTPTS[v${i}]`,
    )
    lane.push(`[v${i}]`)
    if (!clip.isImage && clip.volume > 0 && (await hasAudioStream(clip.file))) {
      mixes.push(audioChain(input, clip, sampleRate, layout, `ca${i}`, filters))
    }
    cursor = clip.startSec + clip.durationSec
  }
  if (totalSec > cursor + 0.001) gap(totalSec - cursor)
  filters.push(`${lane.join('')}concat=n=${lane.length}:v=1:a=0[vlane]`)

  // Captions: the render step unpacked the font bundle into the media folder.
  const captionDir = `${outputPath}.captions`
  // From here on, the caption images are removed whatever happens.
  try {
    const captionOverlay = await buildCaptionOverlay({
      fontsDir: path.join(mediaDir, 'fonts'),
      fps,
      frame: { height, width },
      segments: captions,
      timeRangeMs: options.timeRangeMs,
      totalSec,
      workDir: captionDir,
    })
    args.push(...(captionOverlay?.inputArgs ?? []))
    filters.push(...captionFilters(captionOverlay, inputIndex))
    if (captionOverlay) inputIndex++

    for (const [i, clip] of audio.entries()) {
      if (clip.volume <= 0) continue
      mixes.push(
        audioChain(addInput(clip.file, false, 0), clip, sampleRate, layout, `a${i}`, filters),
      )
    }
    if (mixes.length) {
      filters.push(
        `${mixes.join('')}amix=inputs=${mixes.length}:normalize=0:duration=longest,apad,atrim=duration=${sec(totalSec)}[acat]`,
      )
    } else {
      filters.push(`anullsrc=r=${sampleRate}:cl=${layout},atrim=duration=${sec(totalSec)}[acat]`)
    }

    filters.push(...rangeFilters(options.timeRangeMs))

    fs.mkdirSync(path.dirname(outputPath), { recursive: true })
    logger.info(
      {
        audioClips: audio.length,
        captionLines: captions.length,
        clips: visual.length,
        durationSec: totalSec,
        outputPath,
      },
      '[render] Rendering with local ffmpeg',
    )
    await runFfmpeg(
      ...args,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[vout]',
      '-map',
      '[aout]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-r',
      String(fps),
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      String(sampleRate),
      '-movflags',
      '+faststart',
      outputPath,
    )
  } finally {
    fs.rmSync(captionDir, { force: true, recursive: true })
  }
  return outputPath
}

/** Overlays the caption stream (input `input`) on the clip lane, or passes it through. */
function captionFilters(overlay: CaptionOverlay | undefined, input: number): string[] {
  if (!overlay) return ['[vlane]null[vcat]']
  return [
    `[${input}:v]format=rgba,setpts=PTS-STARTPTS[caps]`,
    `[vlane][caps]overlay=x=0:y=${overlay.y}:eof_action=pass,format=yuv420p[vcat]`,
  ]
}

/** Cuts the output to [start, end] ms when a chunk is asked for. */
function rangeFilters(timeRangeMs: [number, number] | undefined): string[] {
  const [start, end] = timeRangeMs ?? [0, 0]
  if (end <= start) return ['[vcat]null[vout]', '[acat]anull[aout]']
  const range = `start=${sec(start / 1000)}:end=${sec(end / 1000)}`
  return [
    `[vcat]trim=${range},setpts=PTS-STARTPTS[vout]`,
    `[acat]atrim=${range},asetpts=PTS-STARTPTS[aout]`,
  ]
}

/** Trims one audio source to its slot, sets its level and delays it to its start time. */
function audioChain(
  input: number,
  clip: { durationSec: number; sourceStartSec: number; startSec: number; volume: number },
  sampleRate: number,
  layout: string,
  label: string,
  filters: string[],
): string {
  const delayMs = Math.round(clip.startSec * 1000)
  filters.push(
    `[${input}:a]atrim=start=${sec(clip.sourceStartSec)}:duration=${sec(clip.durationSec)},asetpts=PTS-STARTPTS,aresample=${sampleRate},aformat=channel_layouts=${layout},volume=${clip.volume},adelay=${delayMs}:all=1[${label}]`,
  )
  return `[${label}]`
}

/** A single frame of the plan at `timeMs`, as a PNG. */
export async function renderPlanFrameWithFfmpeg(options: {
  mediaDir: string
  outputPath: string
  plan: RenderPlan
  timeMs: number
}): Promise<string> {
  const videoPath = `${options.outputPath}.frame.mp4`
  const fps = parseFrameRate(options.plan.videoInfo?.frameRate)
  const frameMs = Math.ceil(1000 / fps)
  await renderPlanWithFfmpeg({
    mediaDir: options.mediaDir,
    outputPath: videoPath,
    plan: options.plan,
    timeRangeMs: [options.timeMs, options.timeMs + frameMs],
  })
  try {
    await runFfmpeg('-i', videoPath, '-frames:v', '1', options.outputPath)
  } finally {
    fs.rmSync(videoPath, { force: true })
  }
  return options.outputPath
}
