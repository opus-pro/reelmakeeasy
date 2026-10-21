import { spawn } from 'node:child_process'
import path from 'node:path'

import { videoModelForRole } from '@reelmakeeasy/common/veo3/video-model-selection'
import { videoModelCapabilities } from '@reelmakeeasy/common/video-models/registry'
import { LLM, type VideoResolution } from '@reelmakeeasy/llm'

/** A ranking clip's length when none is asked: one action, start to payoff. */
export const AI_CLIP_DEFAULT_SEC = 5
export const AI_CLIP_MIN_SEC = 4
export const AI_CLIP_MAX_SEC = 8
/** Clips made per call at most (a top 5 or 6 at once). */
export const AI_CLIPS_MAX = 6

/** Every AI clip asks for a vertical, handheld, real-looking pet/people clip without text. */
export const AI_CLIP_STYLE =
  'Vertical smartphone video, handheld, natural light, realistic, candid viral clip, one continuous shot, no text, no captions, no watermark.'

/** Resolutions from best to worst. */
const RESOLUTION_ORDER = ['1080p', '768p', '720p', '480p']

/**
 * The resolutions the clip model (the user's chosen provider's text-to-video model) offers, best
 * first, each with its price per second. The best one is the recommended one: at lower ones,
 * water, splashes and fast motion smear and give the clip away as AI.
 */
export function aiClipOptions(): {
  key: string
  options: { resolution: VideoResolution; usdPerSecond: number }[]
} {
  const key = videoModelForRole('video.text')
  const caps = videoModelCapabilities(key, 'video.text')
  const offered = (caps.resolutions ?? ['720p']) as string[]
  const rank = (r: string) =>
    RESOLUTION_ORDER.includes(r) ? RESOLUTION_ORDER.indexOf(r) : RESOLUTION_ORDER.length
  const options = [...offered]
    .sort((a, b) => rank(a) - rank(b))
    .map((resolution) => ({
      resolution: resolution as VideoResolution,
      usdPerSecond: caps.usdPerSecond?.[resolution as VideoResolution] ?? 0.08,
    }))
  return { key, options }
}

/** The clip model at `resolution` when it offers it; otherwise null. */
export function aiClipModel(
  resolution: string,
): null | { key: string; resolution: VideoResolution; usdPerSecond: number } {
  const { key, options } = aiClipOptions()
  const option = options.find((o) => o.resolution === resolution)
  return option ? { key, ...option } : null
}

/** The resolutions in words for the user, best (recommended) first, with what a clip costs. */
export function describeAiClipOptions(count: number, seconds: number): string {
  return aiClipOptions()
    .options.map(
      (o, i) =>
        `${o.resolution}${i === 0 ? ' (recommended: sharpest, smears least on water and fast motion)' : ''}: about $${aiClipCost(o.usdPerSecond, count, seconds).toFixed(2)} for ${count} clip${count === 1 ? '' : 's'} of ${seconds} s`,
    )
    .join('; ')
}

/** About what `count` clips of `seconds` cost at `usdPerSecond`. */
export function aiClipCost(usdPerSecond: number, count: number, seconds: number): number {
  return Math.round(usdPerSecond * seconds * count * 100) / 100
}

/** Makes one clip from a text prompt into `outputPath`; answers its length and what it cost. */
export async function generateAiClip(o: {
  outputPath: string
  prompt: string
  resolution: string
  seconds: number
}): Promise<{ costUsd: number; durationSec: number; model: string }> {
  const model = aiClipModel(o.resolution)
  if (!model) throw new Error(`the clip model doesn't make ${o.resolution} clips`)
  const result = await LLM.generateVideo({
    aspectRatio: '9:16',
    durationSeconds: o.seconds,
    models: [model.key],
    outputPath: o.outputPath,
    prompt: `${o.prompt.trim()} ${AI_CLIP_STYLE}`,
    resolution: model.resolution,
    role: 'video.text',
    task: 'ranking-ai-clip',
  })
  return {
    costUsd: Math.round(model.usdPerSecond * o.seconds * 100) / 100,
    durationSec: Math.round(result.processedDuration * 100) / 100,
    model: model.key,
  }
}

/** A strip of frames, one every half second, to see a clip's action and when it happens. */
export function clipContactSheet(video: string, out: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-i',
        video,
        '-vf',
        'fps=2,scale=200:-2,tile=8x2:padding=4',
        '-frames:v',
        '1',
        out,
      ],
      { cwd: path.dirname(out), stdio: 'ignore', windowsHide: true },
    )
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg could not make a contact sheet (${code})`)),
    )
  })
}
