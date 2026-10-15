import { RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import type { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import type { TranscriptData } from '@shared/types/agent/transcript'
import type { CaptionStyleSettings } from '@shared/types/api/caption-style'
import { useAsyncEffect } from 'ahooks'
import { useEffect, useMemo, useState } from 'react'

import { extractPrefetchTasksFromRenderPlan } from '@/app/projects/[projectId]/editor/utils/extract-prefetch-tasks'
import mediaDataManager from '@/app/projects/[projectId]/editor/utils/media-data-manager'
import type { StorySegment } from '@/app/story-mode/long-take.types'
import type { CaptionKind } from '@/components/captions/caption-settings'

import { factStampStripUrl } from './factStampStripUrl'
import { StoryRenderPlanBuilder } from './StoryRenderPlanBuilder'

const nsLogger = Logger.get('story-editor.render-plan', 'story-editor')

interface UseRenderPlanParams {
  allSegments: StorySegment[]
  aspectRatio: string
  bgmUrl?: null | string
  bgmVolume?: null | number
  captionEnabled: boolean
  captionKind?: CaptionKind
  captionStyle?: CaptionStyleSettings | null
  /** False holds a loop's fact stamps back (StoryRenderPlanBuilder's `factsReady`). */
  factsReady?: boolean
  /** A loop's joined clips, played in place of its clips one by one (the builder's). */
  loopClipsUrl?: null | string
  musicEnabled?: boolean
  totalMs: number
  transcript: TranscriptData | undefined
  videoScript: undefined | VideoScript
  voiceOverUrl?: null | string
}

/**
 * The engine's RenderPlan for these inputs, built again whenever one changes, and `failed`
 * once building it threw (the last plan, if any, stays): a player can show the rendered file
 * instead.
 */
export default function useRenderPlan({
  allSegments,
  aspectRatio,
  bgmUrl,
  bgmVolume,
  captionEnabled,
  captionKind,
  captionStyle,
  factsReady,
  loopClipsUrl,
  musicEnabled,
  totalMs,
  transcript,
  videoScript,
  voiceOverUrl,
}: UseRenderPlanParams): { failed: boolean; renderPlan: null | RenderPlan } {
  const [renderPlan, setRenderPlan] = useState<null | RenderPlan>(null)
  const [failed, setFailed] = useState(false)
  useAsyncEffect(async () => {
    if (!allSegments || allSegments.length === 0 || totalMs === 0) {
      return
    }
    try {
      const newRenderPlan = await StoryRenderPlanBuilder.build({
        segments: allSegments,
        aspectRatio,
        bgmUrl,
        bgmVolume,
        captionEnabled,
        captionKind,
        captionStyle,
        factsReady,
        factStripUrl: factStampStripUrl,
        loopClipsUrl,
        musicEnabled,
        totalMs,
        transcript,
        videoScript,
        voiceOverUrl,
      })
      setRenderPlan(newRenderPlan)
      setFailed(false)
    } catch (error) {
      nsLogger.warn(`Could not build the preview's render plan: ${String(error)}`)
      setFailed(true)
    }
  }, [
    allSegments,
    aspectRatio,
    bgmUrl,
    bgmVolume,
    captionEnabled,
    captionKind,
    captionStyle,
    factsReady,
    loopClipsUrl,
    musicEnabled,
    totalMs,
    transcript,
    videoScript,
    voiceOverUrl,
  ])

  const prefetchTasks = useMemo(() => {
    if (!renderPlan) {
      return []
    }
    return extractPrefetchTasksFromRenderPlan(renderPlan)
  }, [renderPlan])

  useEffect(() => {
    if (prefetchTasks.length > 0) {
      mediaDataManager.warmup(prefetchTasks)
    }
    return () => {
      mediaDataManager.abortWarmup()
    }
  }, [prefetchTasks])

  return { failed, renderPlan }
}
