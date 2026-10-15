'use client'

import { Button, cn, Tooltip } from '@shared/ui'
import { useAtomValue, useSetAtom } from 'jotai'
import React, { useLayoutEffect, useMemo } from 'react'

import { ChatBoxMode, longTakeEnabledAtom } from '@/atom/home'
import { chatBoxRightOverlayOpenAtom } from '@/atom/notification'
import RiveCanvas from '@/components/animated/RiveCanvas'
import { MagicEdit } from '@/components/icons/core'
import { useIsMobile } from '@/util/browserUtils'
import { getPublicCdnUrl } from '@/util/cdn-utils'

import { AgentModeButton } from './AgentModeButton'
import { ChatBoxSubmitButton } from './ChatBoxSubmitButton'

export type ChatBoxRightActionsProps = {
  /** Character count for story mode (deprecated, use wordCount) */
  characterCount?: number
  /** Character limit for story mode (deprecated, use wordLimit) */
  characterLimit?: number
  /** Current chat box mode */
  chatBoxMode?: ChatBoxMode
  /** Whether the send button should be disabled */
  disableSend: boolean
  /** Whether the enhance prompt action is in progress */
  isEnhancing?: boolean
  /** Whether the prompt is valid */
  isPromptValid?: boolean
  /** Whether a send operation is in progress */
  isSending: boolean
  /** Whether guest image assets are being uploaded after login */
  isUploading?: boolean
  /** Layout variant */
  layout?: 'default' | 'story'
  /** Callback when user discards enhanced prompt */
  onDiscardEnhance?: () => void
  /** Callback to enhance the prompt */
  onEnhancePrompt: () => void
  /** Callback when user keeps enhanced prompt */
  onKeepEnhance?: () => void
  /** Handler to trigger send */
  onSend: () => void
  /** Whether to show word count in story mode */
  showWordCount?: boolean
  /**
   * Whether a style dialog (choose-style sheet / style studio) is open. These
   * cover the chat box, so tooltips anchored here would float orphaned above
   * them; suppress them while they are open without dismissing them.
   */
  styleDialogOpen?: boolean
  /** Tooltip shown when send is disabled for a specific actionable reason. */
  submitDisabledTooltipContent?: React.ReactNode
  /** Word count for story mode */
  wordCount?: number
  /** Word limit for story mode */
  wordLimit?: number
  /** Optional unit label for story mode counter (e.g. "sec") */
  wordUnit?: string
}

const ChatBoxRightActionsComponent: React.FC<ChatBoxRightActionsProps> = ({
  characterCount = 0,
  characterLimit = 3000,
  chatBoxMode = 'edit',
  disableSend,
  isEnhancing = false,
  isPromptValid = false,
  isSending,
  isUploading = false,
  layout = 'default',
  onDiscardEnhance,
  onEnhancePrompt,
  onKeepEnhance,
  onSend,
  submitDisabledTooltipContent,
  styleDialogOpen = false,
  wordCount,
  wordLimit,
  wordUnit,
  showWordCount = true,
}) => {
  const longTakeEnabled = useAtomValue(longTakeEnabledAtom)
  const isStoryLayout = layout === 'story'
  const isMobile = useIsMobile()

  // Something this box owns is covering it: read by the discovery tours mounted
  // outside this tree through the atom below.
  const setRightOverlayOpen = useSetAtom(chatBoxRightOverlayOpenAtom)
  useLayoutEffect(() => {
    setRightOverlayOpen(styleDialogOpen)
    return () => setRightOverlayOpen(false)
  }, [styleDialogOpen, setRightOverlayOpen])

  const displayWordCount = wordCount ?? characterCount
  const displayWordLimit = wordLimit ?? characterLimit
  const shouldShowDisabledSubmitTooltip =
    disableSend && !isSending && Boolean(submitDisabledTooltipContent) && !isMobile
  const shouldShowUploadingTooltip = isUploading && !isMobile
  const renderSubmitButton = (submitButton: React.ReactNode) => {
    if (shouldShowUploadingTooltip) {
      return (
        <Tooltip
          className="max-w-none rounded-[8px] bg-[#444444] p-[6px] text-sm font-medium leading-4 text-primary"
          content={<span className="px-0.5">Uploading to the cloud...</span>}
          disablePersistedActivation
          side="top"
          sideOffset={6}
        >
          <span className="inline-flex">{submitButton}</span>
        </Tooltip>
      )
    }
    if (shouldShowDisabledSubmitTooltip) {
      return (
        <Tooltip
          className="max-w-none rounded-[8px] bg-[#444444] p-[6px] text-sm font-medium leading-4 text-primary"
          content={<span className="px-0.5">{submitDisabledTooltipContent}</span>}
          disablePersistedActivation
          side="top"
          sideOffset={6}
        >
          <span className="inline-flex">{submitButton}</span>
        </Tooltip>
      )
    }
    return submitButton
  }

  const enhanceButtonTooltip = useMemo(() => {
    if (longTakeEnabled) {
      return 'Prompt enhance is unavailable in Story Mode'
    }
    if (!isPromptValid) {
      return 'Please enter a valid prompt'
    }
    return 'Polish my prompt for better results.'
  }, [isPromptValid, longTakeEnabled])

  // Enhance review mode - show Keep/Discard buttons
  if (chatBoxMode === 'enhance-review' && !isEnhancing) {
    return (
      <div className="flex items-center gap-2">
        <Button
          className="h-9.5 bg-transparent border border-tertiary hover:bg-secondary"
          onClick={onDiscardEnhance}
        >
          Discard
        </Button>
        <Button className="hover:bg-white/90 h-9.5" onClick={onKeepEnhance} variant="primary">
          Keep
        </Button>
      </div>
    )
  }

  if (isStoryLayout) {
    return (
      <div className="flex items-center justify-between w-full md:w-auto md:justify-start md:gap-2">
        <div className="flex items-center gap-1">
          {showWordCount && (
            <div className="flex items-center px-[6px]">
              <div className="flex items-center gap-0.5 text-xs font-medium leading-[15px]">
                <span className="text-white/50">
                  {displayWordCount}
                  {wordUnit ? ` ${wordUnit}` : ''}
                </span>
                <span className="text-white/50">/</span>
                <span className="text-white/50">
                  {displayWordLimit}
                  {wordUnit ? ` ${wordUnit}` : ''}
                </span>
              </div>
            </div>
          )}

          <AgentModeButton />

          <div className="ml-1">
            {renderSubmitButton(
              <ChatBoxSubmitButton
                disabled={disableSend}
                isPromptValid={isPromptValid}
                isSending={isSending || isUploading}
                onSend={onSend}
              />,
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Enhance Prompt Button */}
      <Tooltip
        className="bg-overlay rounded-xs text-primary backdrop-blur-xl px-2 py-1"
        content={enhanceButtonTooltip}
        side="top"
        sideOffset={8}
      >
        <span>
          <Button
            className={cn(
              'size-9 min-w-9 p-0 bg-transparent hover:bg-fill-hover hover:text-primary rounded-sm flex items-center justify-center transition-colors text-primary',
              longTakeEnabled && 'cursor-not-allowed opacity-50',
            )}
            disabled={isEnhancing || !isPromptValid || longTakeEnabled}
            onClick={onEnhancePrompt}
          >
            <MagicEdit className={cn('size-4.5', isEnhancing && 'hidden')} />
            <RiveCanvas
              autoplay
              className={cn('size-4.5', !isEnhancing && 'hidden')}
              showLoadingSkeleton={false}
              src={getPublicCdnUrl('agent/rive/ai_icon_primary.riv')}
              stateMachines="State Machine"
            />
          </Button>
        </span>
      </Tooltip>

      <AgentModeButton />

      {renderSubmitButton(
        <ChatBoxSubmitButton
          disabled={disableSend}
          isPromptValid={isPromptValid}
          isSending={isSending || isUploading}
          onSend={onSend}
        />,
      )}
    </>
  )
}

export const ChatBoxRightActions = React.memo(ChatBoxRightActionsComponent)
