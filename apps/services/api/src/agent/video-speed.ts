import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { VIDEO_SPEED } from '@reelmakeeasy/common/motion-reel/video-speed'
import {
  isStoreUri,
  storeKeyOf,
  type StoreUri,
  storeUri,
} from '@reelmakeeasy/common/storage/address'
import {
  filePath,
  storedFileExists,
  uploadToStore,
} from '@reelmakeeasy/common/storage/stored-files'
import { runCommand, runFfmpeg } from '@reelmakeeasy/common/utils/cmdline'
import type { AgentUiEvent } from '@shared/types/api/agent'

/**
 * A code video's render at another pace, made from the finished file in seconds (no new render):
 * the picture retimed, the sound stretched with `atempo`, which keeps the pitch, so a faster voice
 * doesn't sound higher. Voices, music, sounds and motion change together and stay in sync.
 */

/** The files being made, by key: asking twice makes each once. */
const making = new Map<string, Promise<void>>()

/** `animation-1.mp4` at 1.25x is `animation-1-speed125.mp4`, next to it. */
export function speedKey(sourceKey: string, speed: number): string {
  return sourceKey.replace(/\.mp4$/, '') + `-speed${Math.round(speed * 100)}.mp4`
}

/** The chat's rendered video with this item id, as stored (null when it has none). */
export function renderedVideo(events: AgentUiEvent[], itemId: string): null | StoreUri {
  const event = events.findLast((e) => e.type === 'motion_video' && e.itemId === itemId)
  if (event?.type !== 'motion_video' || !isStoreUri(event.videoUrl)) return null
  return event.videoUrl
}

/** The render at `speed` (a checked one, see isVideoSpeed): made once, then reused. */
export async function videoAtSpeed(source: StoreUri, speed: number): Promise<StoreUri> {
  if (Math.abs(speed - 1) < 1e-9) return source
  const sourceKey = storeKeyOf(source)
  if (!sourceKey) throw new Error(`Not a stored file: ${source}`)
  const key = speedKey(sourceKey, speed)
  const target = storeUri(key)
  if (await storedFileExists(target)) return target
  let job = making.get(key)
  if (!job) {
    job = makeAtSpeed(filePath(source), target, speed).finally(() => making.delete(key))
    making.set(key, job)
  }
  await job
  return target
}

async function makeAtSpeed(input: string, target: StoreUri, speed: number): Promise<void> {
  if (speed < VIDEO_SPEED.min || speed > VIDEO_SPEED.max) throw new Error(`No speed ${speed}`)
  const { fps, hasAudio } = await probe(input)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-speed-'))
  const output = path.join(dir, 'out.mp4')
  try {
    // The same frame rate as before: at 1.25x four frames in five are kept, each on its time.
    const video = `[0:v]setpts=PTS/${speed},fps=${fps}[v]`
    await runFfmpeg(
      '-i',
      input,
      '-filter_complex',
      hasAudio ? `${video};[0:a]atempo=${speed}[a]` : video,
      '-map',
      '[v]',
      ...(hasAudio ? ['-map', '[a]', '-c:a', 'aac', '-b:a', '192k'] : []),
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      output,
    )
    await uploadToStore(output, target)
  } finally {
    fs.rmSync(dir, { force: true, recursive: true })
  }
}

async function probe(file: string): Promise<{ fps: string; hasAudio: boolean }> {
  const { stdout } = await runCommand([
    'ffprobe',
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,r_frame_rate',
    '-of',
    'json',
    file,
  ])
  const streams =
    (JSON.parse(stdout) as { streams?: { codec_type?: string; r_frame_rate?: string }[] })
      .streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  const fps = /^\d+(\/\d+)?$/.test(video?.r_frame_rate ?? '')
    ? (video?.r_frame_rate as string)
    : '30'
  return { fps, hasAudio: streams.some((s) => s.codec_type === 'audio') }
}
