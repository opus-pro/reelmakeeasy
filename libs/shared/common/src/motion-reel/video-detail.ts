import type { VideoDetail } from '@shared/types/api/agent'

/**
 * How much detail goes into a code video (Motion Reel, Claude Animation), least first: how far
 * the agent takes the craft (layers, parts, particles, transitions). More detail takes longer and
 * more tokens and looks better: Extra high is the default and the recommended one.
 */
export const VIDEO_DETAILS: readonly VideoDetail[] = ['low', 'medium', 'high', 'xhigh']
export const VIDEO_DEFAULT_DETAIL: VideoDetail = 'xhigh'
export const VIDEO_DETAIL_LABEL: Record<VideoDetail, string> = {
  high: 'High',
  low: 'Low',
  medium: 'Medium',
  xhigh: 'Extra high',
}

export const isVideoDetail = (value: unknown): value is VideoDetail =>
  VIDEO_DETAILS.includes(value as VideoDetail)
