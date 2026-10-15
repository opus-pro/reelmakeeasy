'use client'

import type { MessageBubbleTone } from '@shared/ui/chat'

import type { TimelineRenderBlock } from '../state-types'

import { AnchorAssetListBlockItem } from './AnchorAssetListBlockItem'
import { AssistantThinkingBlockItem } from './AssistantThinkingBlockItem'
import { AudioAssetListBlockItem } from './AudioAssetListBlockItem'
import { BrandBriefCardBlockItem } from './BrandBriefCardBlockItem'
import { MessageAssetListBlockItem } from './MessageAssetListBlockItem'
import { MessageBlockItem } from './MessageBlockItem'
import { QaRecapBlockItem } from './QaRecapBlockItem'
import { ScriptTranscriptBlockItem } from './ScriptTranscriptBlockItem'
import { StoryboardsBlockItem } from './StoryboardsBlockItem'
import { StyleCandidatesBlockItem } from './StyleCandidatesBlockItem'
import { VideoBriefCardBlockItem } from './VideoBriefCardBlockItem'

interface TimelineItemProps {
  item: TimelineRenderBlock
  // Passed straight through to the thinking row, which renders differently per surface.
  shouldUseCanvasStyle?: boolean
  // Passed straight through to the user message bubble.
  userMessageTone?: MessageBubbleTone
}

export function TimelineItem({ item, shouldUseCanvasStyle, userMessageTone }: TimelineItemProps) {
  switch (item.kind) {
    case 'anchor_asset_list': {
      return <AnchorAssetListBlockItem block={item} />
    }

    case 'assistant_thinking': {
      return <AssistantThinkingBlockItem shouldUseCanvasStyle={shouldUseCanvasStyle} />
    }

    case 'audio_asset_list': {
      return <AudioAssetListBlockItem block={item} />
    }

    case 'brand_brief_card': {
      return <BrandBriefCardBlockItem block={item} />
    }

    case 'message': {
      return <MessageBlockItem block={item} userTone={userMessageTone} />
    }

    case 'message_asset_list': {
      return <MessageAssetListBlockItem block={item} />
    }

    case 'qa_recap': {
      return <QaRecapBlockItem block={item} />
    }

    case 'script_transcript': {
      return <ScriptTranscriptBlockItem block={item} />
    }

    case 'storyboards': {
      return <StoryboardsBlockItem block={item} />
    }

    case 'style_candidates': {
      return <StyleCandidatesBlockItem block={item} />
    }

    case 'video_brief_card': {
      return <VideoBriefCardBlockItem block={item} />
    }

    default: {
      return null
    }
  }
}
