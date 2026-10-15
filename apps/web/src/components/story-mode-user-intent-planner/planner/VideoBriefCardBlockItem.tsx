'use client'

import { countWords, estimateDuration } from '@reelmakeeasy/common/utils/text'
import { useAtomValue } from 'jotai'
import type { ReactNode } from 'react'
import { useMemo } from 'react'

import { VideoBriefContent } from '@/components/artifact-content/VideoBriefContent'
import { useFetcherData } from '@/lib/jotai-fetcher-adapter'

import { getRenderStateAtom } from '../state/atoms/planner'
import { usePlannerState } from '../state/planner-context'
import type { VideoBriefCardBlock } from '../state-types'
import { getAudioMetadataCacheByPlanner } from '../utils/audio-metadata-cache'

interface VideoBriefCardProps {
  belowMeta?: ReactNode
  block: VideoBriefCardBlock
  // Initial state of the View more toggle. The canvas Summary section and the Edit
  // Summary modal open expanded; the chat timeline card keeps the collapsed default.
  defaultExpanded?: boolean
  flat?: boolean
  showBadges?: boolean
  showTitle?: boolean
}

/**
 * Planner-side glue: maps a video-brief block into the shared Summary presentation's props, with
 * the duration as its one badge (the video type duplicated what the brief title already says).
 */
export function VideoBriefCardBlockItem(props: VideoBriefCardProps) {
  const durationSeconds = useVideoBriefDurationSeconds(props.block)

  return (
    <VideoBriefCardBody
      {...props}
      badges={durationSeconds == null ? [] : [`${durationSeconds}s`]}
    />
  )
}

/**
 * The same card without deriving a duration, for a surface that already renders one of its own.
 * Deriving it twice would be worse than wasteful: the estimate is scheduled into one slot per
 * session, so a second consumer's cleanup cancels the first's pending estimate.
 */
export function VideoBriefCardBody({
  badges = [],
  belowMeta,
  block,
  defaultExpanded = false,
  flat = false,
  showBadges = true,
  showTitle = true,
}: VideoBriefCardProps & { badges?: readonly string[] }) {
  return (
    <VideoBriefContent
      badges={badges}
      belowMeta={belowMeta}
      briefId={block.id}
      compactMeta={block.metaItems}
      constraints={[
        { items: block.directives, label: 'KEY REQUIREMENTS' },
        { items: block.mustNotViolate, label: 'MUST NOT VIOLATE' },
      ]}
      defaultExpanded={defaultExpanded}
      description={block.description}
      expandedMeta={block.longMetaItems}
      flat={flat}
      freshness={block.blockStatus === 'default' ? 'current' : block.blockStatus}
      showBadges={showBadges}
      showTitle={showTitle}
      title={block.title}
    />
  )
}

/**
 * The brief's duration: measured from uploaded audio when there is one, otherwise estimated from
 * the script transcript, falling back to the block's own value. Exported so a surface rendering
 * the duration outside this card shows the same number instead of deriving its own.
 */
export function useVideoBriefDurationSeconds(block: VideoBriefCardBlock): null | number {
  const plannerState = usePlannerState()
  const renderState = useAtomValue(getRenderStateAtom(plannerState))
  const latestScript = renderState.latest.script
  const isAudioMode = latestScript?.audioSource === 'user_audio'
  const transcriptText = latestScript?.text ?? ''

  const audioMetadataData = useFetcherData(
    useMemo(() => {
      if (!isAudioMode || !latestScript?.audioUrl) {
        return null
      }
      return getAudioMetadataCacheByPlanner(plannerState).fetch(latestScript.audioUrl)
    }, [isAudioMode, latestScript?.audioUrl, plannerState]),
  )
  const audioDurationSeconds =
    audioMetadataData?.state === 'resolved' && audioMetadataData.value.metadata
      ? Math.max(0, Math.round(audioMetadataData.value.metadata.duration ?? 0))
      : null

  if (isAudioMode) {
    return audioDurationSeconds
  }
  const wordCount = countWords(transcriptText)
  return wordCount > 0 ? estimateDuration(wordCount)[1] : block.durationSecondsFallback
}
