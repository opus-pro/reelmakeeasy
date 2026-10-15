'use client'

import { AccentTag, cn } from '@shared/ui'
import { MESSAGE_BUBBLE_TONE_CLASS, type MessageBubbleTone } from '@shared/ui/chat'

import { isAudioVoUploadOnlyMessage } from '@/util/meta-tag-utils'

import { MODAL_TAG_LABEL } from '../defaults'
import type { MessageBlock } from '../state-types'

import { hasVisibleInlineMessageContent, InlineMessageContent } from './InlineMessageContent'

interface MessageBlockItemProps {
  block: MessageBlock
  // Surface of the user bubble. The canvas passes 'warm' for the brown bubble;
  // the legacy planner dialog keeps the translucent-white default.
  userTone?: MessageBubbleTone
}

export function MessageBlockItem({ block, userTone = 'neutral' }: MessageBlockItemProps) {
  const sourcePanel = block.sentFrom

  // Suppress user message bubbles that consist only of @audio/@vo upload tags,
  // including legacy broken sessions where the CDN URL contains parentheses
  // that cause the InlineMessageContent regex to leave a visible fragment.
  // The audio asset chip renders separately via the audio_asset_list block.
  if (block.role === 'user' && isAudioVoUploadOnlyMessage(block.text)) {
    return null
  }

  if (!hasVisibleInlineMessageContent(block.text)) {
    return null
  }

  if (block.role === 'assistant') {
    // Consecutive assistant messages read as one turn, so they sit 16px apart rather than the
    // timeline's 24px. Scoped to a sibling bubble so a suppressed block can never pull a message
    // up against a user turn or the top of the list.
    return (
      <div className="w-full [[data-role=assistant]+&]:-mt-2" data-role="assistant">
        <p className="max-w-screen-md whitespace-pre-wrap break-words text-left text-base font-normal leading-[26px] tracking-[-0.12px] text-white">
          <InlineMessageContent
            anchorAssets={block.anchorAssets}
            text={block.text}
            uploadedAssets={block.uploadedAssets}
          />
        </p>
      </div>
    )
  }

  return (
    <div className="ml-auto flex w-full max-w-[480px] flex-col items-end" data-role="user">
      {sourcePanel && (
        <div className="mb-1">
          <AccentTag label={MODAL_TAG_LABEL[sourcePanel]} tone="blue" />
        </div>
      )}
      <div
        className={cn(
          'w-fit max-w-full rounded-2xl px-4 py-3 text-left whitespace-pre-wrap break-words text-base font-normal leading-[26px] tracking-[-0.12px] text-white',
          MESSAGE_BUBBLE_TONE_CLASS[userTone],
        )}
      >
        <InlineMessageContent
          anchorAssets={block.anchorAssets}
          text={block.text}
          uploadedAssets={block.uploadedAssets}
        />
      </div>
    </div>
  )
}
