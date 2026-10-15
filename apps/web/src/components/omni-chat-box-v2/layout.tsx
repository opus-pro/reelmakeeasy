'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { Attachment } from '@shared/types/assets/attachment'
import { cn } from '@shared/ui'
import { useCallback, useRef, useState } from 'react'

import { Attachment as AttachmentIcon } from '@/components/icons/core'
import {
  EditableProps,
  MarkdownEditor,
  MarkdownEditorHandle,
} from '@/components/markdown-editor/EditorContainer'

// Re-export for consumers
export type { ChatBoxSubmitButtonProps, SubmitButtonContext } from './ChatBoxSubmitButton'
export { ChatBoxSubmitButton } from './ChatBoxSubmitButton'

const nsLogger = Logger.get('omni-chat-box')

export interface BaseLayoutProps extends EditableProps {
  actionClassName?: string
  attachments?: Attachment[]
  attachmentsSection?: React.ReactNode
  className?: string
  customPlaceholder?: React.ReactNode
  disabled?: boolean
  editorDimmed?: boolean
  editorOverlayContent?: React.ReactNode
  editorRef?: React.Ref<MarkdownEditorHandle | null>
  enableEnterToSend?: boolean
  hasContentOverride?: boolean
  /** Collapse the textarea area to zero height while keeping it mounted (preserves editor state) */
  hideEditorText?: boolean
  /** Whether a send operation is in progress (disables editor) */
  isSending?: boolean
  /** Optional leading panel rendered on the left of editor + actions (used by Story Mode cards) */
  leadingPanel?: React.ReactNode
  leftActions?: null | React.ReactNode
  message: string
  /** When true, renders leadingPanel above the editor (not left) and hides bottom actions row */
  mobileSheetMode?: boolean
  onBlur?: () => void
  onClick?: (e: React.MouseEvent) => void
  /** Native-OS file drop onto the chat box; mirrors onPasteFiles routing into processFiles */
  onDropFiles?: (files: File[]) => Promise<void> | void
  onEngagedChange?: (isEngaged: boolean) => void
  onFocus?: () => void
  onLongTakeChange?: (hasLongTake: boolean) => void
  onMessageChange: (message: string) => void
  /** Callback when user triggers send via keyboard (Enter or Cmd+Enter) */
  onSubmit?: () => void
  placeholder?: string
  placeholderContainerClassName?: string
  /** Right actions including submit button - passed from parent */
  rightActions?: React.ReactNode
  /** Which omnibox surface this layout renders */
  surface?: 'desktop' | 'mobile'
  textareaClassName?: string
  topLeftActions?: React.ReactNode
}

export function BaseLayout({
  actionClassName,
  attachmentsSection,
  autoFocus,
  className = '',
  customPlaceholder,
  placeholderContainerClassName,
  disabled = false,
  editorDimmed = false,
  leadingPanel,
  editorOverlayContent,
  hasContentOverride,
  editorRef: externalEditorRef,
  enableEnterToSend = false,
  hideEditorText = false,
  isSending = false,
  leftActions,
  message,
  mobileSheetMode = false,
  onBlur,
  onClick,
  onEngagedChange,
  onFocus,
  onMessageChange,
  onLongTakeChange,
  onMetaTagDelete,
  onDropFiles,
  onPasteFiles,
  onSubmit,
  placeholder = '',
  rightActions,
  mentionCandidates,
  mentionMenuVariant,
  onUploadNewAsset,
  textareaClassName,
  topLeftActions,
  enableCustomTools,
}: BaseLayoutProps) {
  const hasContent = hasContentOverride ?? message.trim().length > 0
  const [isEngaged, setIsEngaged] = useState(false)
  const mouseIsInsideRef = useRef(false)
  const handleEditorFocus = useCallback(() => {
    setIsEngaged(true)
    onEngagedChange?.(true)
    onFocus?.()
  }, [onEngagedChange, onFocus])
  const handleBlur = useCallback(
    (e: React.FocusEvent<HTMLDivElement>) => {
      const related = e.relatedTarget as Element | null
      if (shouldSkipBlurCollapse(related, e.currentTarget, mouseIsInsideRef.current)) {
        return
      }
      // setTimeout(0) defers to a new macro task, after mouseup/click fire, so layout shift never steals the click
      setTimeout(() => {
        setIsEngaged(false)
        onEngagedChange?.(false)
        if (textareaRef.current) {
          textareaRef.current.scrollTop = 0
        }
      }, 0)
    },
    [onEngagedChange],
  )

  const textareaRef = useRef<HTMLDivElement>(null)
  const internalEditorRef = useRef<MarkdownEditorHandle | null>(null)
  // Use external ref if provided, otherwise use internal ref
  const editorRef = externalEditorRef || internalEditorRef

  // Handle keyboard shortcuts - only for Command/Ctrl+Enter in submission mode
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      // Only handle Command/Ctrl+Enter for submission mode (when enableEnterToSend is false)
      if (!enableEnterToSend && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onSubmit?.()
      }
    },
    [onSubmit, enableEnterToSend],
  )

  // Handle Enter press from the editor (for chat mode)
  const handleEnterPress = useCallback(() => {
    onSubmit?.()
  }, [onSubmit])

  // Native-OS file drag-and-drop. Only react to `Files` drags so the editor's
  // internal anchor-asset reorder / meta-tag drags pass through untouched.
  // Overlay visibility is tracked by relatedTarget boundary detection: dragenter
  // shows it, dragleave hides it only when the cursor leaves the container (not
  // when it crosses into a nested child), so it never flickers.
  const [isFileDragOver, setIsFileDragOver] = useState(false)
  // Ignore drags bubbling out of a portaled dialog (e.g. the style picker).
  // React routes events through the React tree, so a dialog rendered as our
  // descendant but portaled to <body> would otherwise toggle this overlay, and
  // its drop handler's stopPropagation would leave the overlay stuck on. Only
  // react to drags whose target is inside our own DOM subtree.
  const isNativeFileDrag = useCallback(
    (e: React.DragEvent) =>
      Boolean(onDropFiles) &&
      e.currentTarget.contains(e.target as Node) &&
      Array.from(e.dataTransfer.types).includes('Files'),
    [onDropFiles],
  )
  const handleDragEnter = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isNativeFileDrag(e)) {
        return
      }
      e.preventDefault()
      setIsFileDragOver(true)
    },
    [isNativeFileDrag],
  )
  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isNativeFileDrag(e)) {
        return
      }
      e.preventDefault()
    },
    [isNativeFileDrag],
  )
  const handleDragLeave = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isNativeFileDrag(e)) {
        return
      }
      e.preventDefault()
      const related = e.relatedTarget as Node | null
      if (related == null || !e.currentTarget.contains(related)) {
        setIsFileDragOver(false)
      }
    },
    [isNativeFileDrag],
  )
  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (!isNativeFileDrag(e)) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      setIsFileDragOver(false)
      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        // processFiles surfaces its own user-facing errors via toast; guard the
        // promise so an unexpected rejection never becomes an unhandled rejection.
        Promise.resolve(onDropFiles?.(files)).catch((err) => {
          nsLogger.error('Failed to process dropped files:', err)
        })
      }
    },
    [isNativeFileDrag, onDropFiles],
  )

  return (
    <div
      className={cn(
        'relative bg-[rgba(68,68,68,0.5)] flex flex-col rounded-[24px] backdrop-blur-[40px] shadow-none p-2 group/chatbox min-h-[76px] transition-[min-height,max-height] duration-[450ms] ease-in',
        'md:max-h-[142px] md:data-[engaged]:min-h-[142px] md:data-[engaged]:max-h-[334px]',
        hasContent && !isEngaged && 'md:min-h-[142px]',
        className,
      )}
      data-engaged={isEngaged || undefined}
      data-has-content={hasContent || undefined}
      data-testid="omni-chatbox"
      onBlur={handleBlur}
      onClickCapture={onClick}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onMouseEnter={() => {
        mouseIsInsideRef.current = true
      }}
      onMouseLeave={() => {
        mouseIsInsideRef.current = false
      }}
    >
      {isFileDragOver && (
        <div
          aria-live="polite"
          className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-[24px] border border-dashed border-white/40 bg-[rgba(68,68,68,0.8)] backdrop-blur-2xl"
          role="status"
        >
          <AttachmentIcon className="size-6 shrink-0 text-white" />
          <p className="text-[14px] font-medium leading-[22px] text-white">Drop files to attach</p>
        </div>
      )}
      {topLeftActions && <div className="flex items-start p-2">{topLeftActions}</div>}

      {mobileSheetMode && leadingPanel && (
        <div className="flex flex-row gap-2 px-2 pb-2">{leadingPanel}</div>
      )}

      <div className={cn('flex min-h-0 flex-1 flex-col sm:flex-row sm:gap-2')}>
        {!mobileSheetMode && leadingPanel && (
          <div className="shrink-0 pt-2 mb-[9px] sm:mb-0">{leadingPanel}</div>
        )}

        <div className="flex min-h-0 flex-1 flex-col">
          <div
            className={cn(
              'relative flex flex-1 flex-col min-h-0 bg-transparent',
              editorDimmed && 'opacity-[0.12]',
              editorOverlayContent ? 'overflow-visible' : 'overflow-hidden',
            )}
            data-onboarding-target="video-description"
          >
            {editorOverlayContent && (
              <div className="absolute inset-0 z-10">{editorOverlayContent}</div>
            )}
            {/* min-h-[52px] = 2 lines at leading-[26px]; Lexical ContentEditable has no rows attribute */}
            <MarkdownEditor
              ariaLabel="Describe your video"
              autoFocus={autoFocus}
              className={cn(
                'relative flex-1 min-h-[52px] md:min-h-0 max-h-[260px] md:[[data-engaged]_&]:max-h-[260px] border-0 text-base leading-[26px] pl-2 pr-1 py-1 cursor-text caret-white text-primary resize-none overflow-y-auto md:overflow-y-hidden md:[[data-engaged]_&]:overflow-y-auto [scrollbar-gutter:stable] bg-transparent [&::-webkit-scrollbar-track]:my-3',
                hideEditorText &&
                  '[&_p>span:not([data-meta-tag])]:hidden caret-transparent [&_[data-meta-tag]]:pointer-events-auto',
                textareaClassName,
              )}
              containerClassName={cn(
                'relative overflow-hidden flex flex-1 flex-col min-h-0 bg-transparent',
              )}
              disabled={disabled || isSending}
              divRef={textareaRef}
              enableCustomTools={enableCustomTools}
              enableEnterToSend={enableEnterToSend}
              initValue={message}
              mentionCandidates={mentionCandidates}
              mentionMenuVariant={mentionMenuVariant}
              onBlur={onBlur}
              onChange={onMessageChange}
              onEnterPress={handleEnterPress}
              onFocus={handleEditorFocus}
              onKeyDown={handleKeyDown}
              onLongTakeChange={onLongTakeChange}
              onMetaTagDelete={onMetaTagDelete}
              onPasteFiles={onPasteFiles}
              onUploadNewAsset={onUploadNewAsset}
              placeholder={customPlaceholder ? '' : placeholder}
              placeholderClassName="text-secondary text-base px-2 py-1 leading-[26px]"
              ref={editorRef}
            />

            {customPlaceholder && !hasContent && (
              <div className="absolute inset-x-0 top-0 pointer-events-none">
                <div className={cn('px-2 py-1', placeholderContainerClassName)}>
                  {customPlaceholder}
                </div>
              </div>
            )}
          </div>

          {attachmentsSection}
        </div>
      </div>

      {/* Bottom actions: a sibling of the editor row rather than a child of its column, so
          the controls span the composer's full width the way the design has them. Nested
          inside, they started after `leadingPanel` and the row narrowed whenever one was
          present. */}
      {!mobileSheetMode && (
        <div className={cn('flex items-center justify-between px-2 pt-2 pb-0', actionClassName)}>
          <div className="ml-1 flex items-center gap-1">{leftActions}</div>
          <div className="flex items-center gap-1.5">{rightActions}</div>
        </div>
      )}
    </div>
  )
}

export function shouldSkipBlurCollapse(
  related: Element | null,
  currentTarget: Element,
  mouseIsInside: boolean,
): boolean {
  if (related && currentTarget.contains(related)) {
    return true
  }
  if (mouseIsInside && related?.closest('[data-radix-popper-content-wrapper]')) {
    return true
  }
  if (related?.closest('[data-no-engaged-collapse]')) {
    return true
  }
  return false
}
