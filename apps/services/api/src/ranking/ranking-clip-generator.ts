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

/** The model that makes clips from text (the user's chosen provider's), and its price per second. */
export function aiClipModel(): { key: string; resolution: VideoResolution; usdPerSecond: number } {
  const key = videoModelForRole('video.text')
  const caps = videoModelCapabilities(key, 'video.text')
  const resolution = (caps.resolutions?.find((r) => r === '768p' || r === '720p') ?? caps.resolutions?.[0] ?? '720p') as VideoResolution
  return { key, resolution, usdPerSecond: caps.usdPerSecond?.[resolution] ?? 0.05 }
}

/** About what `count` clips of `seconds` cost on the current model. */
export function aiClipCost(count: number, seconds: number): number {
  return Math.round(aiClipModel().usdPerSecond * seconds * count * 100) / 100
}

/** Makes one clip from a text prompt into `outputPath`; answers its length and what it cost. */
export async function generateAiClip(o: {
  outputPath: string
  prompt: string
  seconds: number
}): Promise<{ costUsd: number; durationSec: number; model: string }> {
  const model = aiClipModel()
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
      ['-v', 'error', '-y', '-i', video, '-vf', 'fps=2,scale=200:-2,tile=8x2:padding=4', '-frames:v', '1', out],
      { cwd: path.dirname(out), stdio: 'ignore', windowsHide: true },
    )
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg could not make a contact sheet (${code})`))))
  })
}
