import type {
  AudioSeg,
  CaptionSeg,
  LottieSeg,
  RenderPlan,
  Seg,
  VideoSeg,
} from '@reelmakeeasy/common/types/render-plan-struct'
import { SegType, TrackType } from '@reelmakeeasy/common/types/render-plan-struct'

import { isVideoUri, uriPath } from '@/util/media'

import {
  FULL_RANGE_END,
  FULL_RANGE_START,
  PREFETCH_VIDEO_PADDING_MS,
} from './media-data-manager/constants'

/**
 * Priority levels for prefetch tasks.
 * Lower number = higher priority (fetched first).
 */
const PREFETCH_PRIORITY = {
  /** Global font package - always needed first for rendering */
  GLOBAL_FONT: 0,
  CUSTOM_FONT: 1,
  VIDEO: 1,
  MEDIA: 2,
  TEMPLATE_IMAGE: 3,
  BACKGROUND: 4,
} as const

/** Multiplier for time-based priority (10 per second) */
const TIME_PRIORITY_MULTIPLIER = 10

export interface PrefetchTask {
  end: number
  isTimeRange?: boolean
  priority: number
  start: number
  url: string
}

type AddTaskFn = (
  url: string | undefined,
  priority: number,
  timeline?: { in: number; out: number },
  isClip?: boolean,
) => void

/**
 * Extract prefetch tasks from a RenderPlan.
 *
 * This function extracts all media URLs that need to be prefetched from the renderPlan,
 * ensuring that remotion/codegen preview assets are correctly included since they are
 * generated during renderPlan creation (not present in the original videoScript).
 */
export function extractPrefetchTasksFromRenderPlan(
  renderPlan: RenderPlan,
  fontUrl?: string,
): PrefetchTask[] {
  const tasks: PrefetchTask[] = []
  const seen = new Set<string>()

  const addTask: AddTaskFn = (url, priority, timeline, isClip = false) => {
    if (!url || seen.has(url) || !url.startsWith('http')) {
      return
    }
    seen.add(url)

    // The path, not the query: a loop's joined clips carry their version (`.mp4?v=...`).
    const isMP4 = uriPath(url).endsWith('.mp4')
    if (isMP4 && timeline) {
      tasks.push({
        url,
        start: isClip ? timeline.in : timeline.in - PREFETCH_VIDEO_PADDING_MS,
        end: isClip ? timeline.out : timeline.out + PREFETCH_VIDEO_PADDING_MS,
        priority,
        isTimeRange: true,
      })
    } else {
      tasks.push({
        url,
        start: FULL_RANGE_START,
        end: FULL_RANGE_END,
        priority,
        isTimeRange: false,
      })
    }
  }

  // Add global font package
  if (fontUrl) {
    addTask(fontUrl, PREFETCH_PRIORITY.GLOBAL_FONT)
  }

  // Add default font gzip path if present
  if (renderPlan.defaultFontGzipPath) {
    addTask(renderPlan.defaultFontGzipPath, PREFETCH_PRIORITY.GLOBAL_FONT)
  }

  // Process all tracks
  for (const track of renderPlan.tracks) {
    for (const seg of track.segs) {
      extractFromSeg(seg, track.type, addTask)
    }
  }

  return tasks.toSorted((a, b) => a.priority - b.priority)
}

function extractBackgroundFromLottieParams(
  params: LottieSeg['params'],
  timeFactor: number,
  addTask: AddTaskFn,
) {
  if (!params || !('background' in params)) {
    return
  }
  if (typeof params.background !== 'object' || !params.background) {
    return
  }

  const bg = params.background as { previewSourceUri?: string; uri?: string }
  const uri = bg.previewSourceUri ?? bg.uri
  if (uri) {
    addTask(uri, PREFETCH_PRIORITY.BACKGROUND + timeFactor)
  }
}

function extractFontsFromLottieParams(
  params: LottieSeg['params'],
  timeFactor: number,
  addTask: AddTaskFn,
) {
  if (!params || !('texts' in params) || !Array.isArray(params.texts)) {
    return
  }

  for (const text of params.texts) {
    if (typeof text !== 'object' || !text) {
      continue
    }
    const font = text.font as undefined | { fallbackUri?: string; uri?: string }
    if (font?.uri) {
      addTask(font.uri, PREFETCH_PRIORITY.CUSTOM_FONT + timeFactor)
    }
    if (font?.fallbackUri) {
      addTask(font.fallbackUri, PREFETCH_PRIORITY.CUSTOM_FONT + timeFactor)
    }
  }
}

function extractFromAudioSeg(seg: AudioSeg, timeFactor: number, addTask: AddTaskFn) {
  if (seg.uri) {
    addTask(seg.uri, PREFETCH_PRIORITY.MEDIA + timeFactor)
  }
}

function extractFromCaptionSeg(seg: CaptionSeg, timeFactor: number, addTask: AddTaskFn) {
  // Extract fonts from caption style
  if (seg.style?.fontPaths && Array.isArray(seg.style.fontPaths)) {
    for (const fontPath of seg.style.fontPaths) {
      addTask(fontPath, PREFETCH_PRIORITY.CUSTOM_FONT + timeFactor)
    }
  }
  if (seg.style?.fontGzipPath) {
    addTask(seg.style.fontGzipPath, PREFETCH_PRIORITY.CUSTOM_FONT + timeFactor)
  }
}

function extractFromLottieSeg(
  seg: LottieSeg,
  timeFactor: number,
  timeline: { in: number; out: number },
  addTask: AddTaskFn,
) {
  // Note: We don't prefetch the Lottie JSON template file (seg.uri) as it's
  // loaded separately by the Lottie renderer and is usually small
  const params = seg.params
  if (!params) {
    return
  }

  extractImagesFromLottieParams(params, timeFactor, timeline, addTask)
  extractFontsFromLottieParams(params, timeFactor, addTask)
  extractBackgroundFromLottieParams(params, timeFactor, addTask)
}

function extractFromSeg(seg: Seg, trackType: TrackType, addTask: AddTaskFn) {
  // Time-first priority: each second adds TIME_PRIORITY_MULTIPLIER (10)
  const timeFactor = Math.floor(seg.in / 1000) * TIME_PRIORITY_MULTIPLIER
  let timeline = { in: 0, out: seg.out - seg.in }

  switch (seg.type) {
    case SegType.AeEffect:
    case SegType.Effect: {
      // Effects don't have external resources to prefetch
      break
    }
    case SegType.Audio: {
      extractFromAudioSeg(seg as AudioSeg, timeFactor, addTask)
      break
    }
    case SegType.Lottie: {
      timeline = getLottieSegPrefetchTimeline(seg as LottieSeg, timeline)
      extractFromLottieSeg(seg as LottieSeg, timeFactor, timeline, addTask)
      break
    }
    case SegType.ManualText: {
      // ManualText doesn't have external resources to prefetch
      break
    }
    case SegType.Text: {
      extractFromCaptionSeg(seg as CaptionSeg, timeFactor, addTask)
      break
    }
    case SegType.Video: {
      const videoSeg = seg as VideoSeg
      if (videoSeg.trimStart === undefined && videoSeg.trimEnd === undefined) {
        timeline = { in: 0, out: videoSeg.out - videoSeg.in }
      } else {
        timeline = { in: videoSeg.trimStart || 0, out: videoSeg.trimEnd || 0 }
      }
      extractFromVideoSeg(seg as VideoSeg, timeFactor, timeline, addTask)
      break
    }
  }
}

function extractFromVideoSeg(
  seg: VideoSeg,
  timeFactor: number,
  timeline: { in: number; out: number },
  addTask: AddTaskFn,
) {
  if (!seg.uri) {
    return
  }

  const isVideo = isVideoUri(seg.uri)
  const basePriority = isVideo ? PREFETCH_PRIORITY.VIDEO : PREFETCH_PRIORITY.MEDIA
  const priority = basePriority + timeFactor

  if (isVideo) {
    addTask(seg.uri, priority, timeline, false)
  } else {
    addTask(seg.uri, priority)
  }

  // Handle background image if present
  if (seg.bg && 'uri' in seg.bg && seg.bg.uri) {
    addTask(seg.bg.uri, PREFETCH_PRIORITY.BACKGROUND + timeFactor)
  }
}

function extractImagesFromLottieParams(
  params: LottieSeg['params'],
  timeFactor: number,
  timeline: { in: number; out: number },
  addTask: AddTaskFn,
) {
  if (!params || !('images' in params) || !Array.isArray(params.images)) {
    return
  }

  for (const image of params.images) {
    if (typeof image !== 'object' || !image) {
      continue
    }
    const img = image as {
      previewSourceUri?: string
      timeline?: { in: number; out: number }
      uri?: string
    }
    const uri = img.uri
    if (!uri) {
      continue
    }

    addTask(uri, PREFETCH_PRIORITY.TEMPLATE_IMAGE + timeFactor, timeline, true)
  }
}

/** Resolve timeline for Lottie segment prefetch; use image.timeline when present, else default. */
function getLottieSegPrefetchTimeline(
  seg: LottieSeg,
  defaultTimeline: { in: number; out: number },
): { in: number; out: number } {
  const images = seg.params?.images
  if (!images || !Array.isArray(images)) {
    return defaultTimeline
  }
  for (const image of images) {
    if (!image.uri || !uriPath(image.uri).endsWith('.mp4')) {
      continue
    }
    const tl = image.timeline
    if (tl != null && typeof tl.in === 'number' && typeof tl.out === 'number') {
      return { in: tl.in, out: tl.out }
    }
  }
  return defaultTimeline
}
