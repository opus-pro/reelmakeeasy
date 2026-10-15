'use client'

import type { MessageBubbleTone } from '@shared/ui/chat'
import { useAtomValue } from 'jotai'

import {
  getIsVideoReadyAtom,
  getOutputVideoAtom,
  getRenderStateAtom,
  getVideoThumbnailAtom,
} from '../state/atoms/planner'
import { usePlannerState } from '../state/planner-context'
import type { TimelineRenderBlock } from '../state-types'

import { AssistantThinkingBlockItem } from './AssistantThinkingBlockItem'
import { TimelineItem } from './TimelineItem'
import { VideoReadyBlock } from './VideoReadyBlock'

export interface TimelineListProps {
  shouldHideArtifacts?: boolean
  // The canvas-vs-legacy surface, threaded from the planner so the thinking row cannot re-derive
  // it and disagree with the surface it renders inside.
  shouldUseCanvasStyle?: boolean
  // Surface of the user message bubbles -- 'warm' on the canvas, default elsewhere.
  userMessageTone?: MessageBubbleTone
}

/**
 * Inside StoryModeCanvas the artifact sections own the brand_brief_card,
 * style_candidates, video_brief_card, script_transcript, storyboards and
 * anchor_asset_list blocks (Brand + Style + Summary + Script + Voiceover +
 * Storyboard + Assets sections), so the chat timeline drops them instead of
 * rendering the artifact twice. Also used for the auto-scroll key so hidden
 * blocks cannot yank the chat scroll position.
 */
export function getVisibleTimelineBlocks(
  blocks: TimelineRenderBlock[],
  shouldHideArtifacts: boolean | undefined,
): TimelineRenderBlock[] {
  if (!shouldHideArtifacts) {
    return blocks
  }
  return blocks.filter(
    (block) =>
      block.kind !== 'brand_brief_card' &&
      block.kind !== 'style_candidates' &&
      block.kind !== 'video_brief_card' &&
      block.kind !== 'script_transcript' &&
      block.kind !== 'storyboards' &&
      block.kind !== 'anchor_asset_list',
  )
}

export function TimelineList({
  shouldHideArtifacts = false,
  shouldUseCanvasStyle,
  userMessageTone,
}: TimelineListProps) {
  const state = usePlannerState()
  const renderState = useAtomValue(getRenderStateAtom(state))
  const outputVideoUrl = useAtomValue(getOutputVideoAtom(state))
  const videoThumbnailUrl = useAtomValue(getVideoThumbnailAtom(state))
  const isVideoReady = useAtomValue(getIsVideoReadyAtom(state))
  const { blocks, status } = renderState
  const visibleBlocks = getVisibleTimelineBlocks(blocks, shouldHideArtifacts)
  const hasTimelineThinkingBlock = visibleBlocks.some((b) => b.kind === 'assistant_thinking')

  return (
    <>
      {visibleBlocks.map((item) => (
        <TimelineItem
          item={item}
          key={item.id}
          shouldUseCanvasStyle={shouldUseCanvasStyle}
          userMessageTone={userMessageTone}
        />
      ))}
      {status === 'active' && !hasTimelineThinkingBlock && (
        <AssistantThinkingBlockItem shouldUseCanvasStyle={shouldUseCanvasStyle} />
      )}
      {/* When shouldHideArtifacts is set, VideoSection owns the ready video.
          It shows iff isVideoReady && outputVideoUrl (useVideoSectionProps),
          so suppressing on the same condition never hides it in both panes. */}
      {outputVideoUrl && !(shouldHideArtifacts && isVideoReady) && (
        <VideoReadyBlock thumbnailUrl={videoThumbnailUrl} videoUrl={outputVideoUrl} />
      )}
    </>
  )
}
