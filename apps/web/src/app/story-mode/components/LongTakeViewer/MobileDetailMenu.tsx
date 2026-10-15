'use client'

import { Button, cn, Popover } from '@shared/ui'

import { Caption, Chat, Copy, Delete, More, Remix } from '@/components/icons/core'

import { STORY_MODE_ICON_BUTTON_CLASS } from '../../constants'

// h-9.5 (38px) rather than py-2: the rows carry a 24px icon, so symmetric
// padding made them 40px and the menu ran 2px per row taller than the design
// (`Menu Button` 288x38, stacked with no gap inside p-1.5).
const MENU_ITEM_CLASS =
  'flex h-9.5 w-full items-center gap-1.5 rounded-sm px-2.5 text-left text-sm font-medium leading-[17px] text-white transition-colors hover:bg-white/[0.18]'

export function MobileDetailMenu({
  canCopyStyle,
  canDelete,
  canRemix,
  captionEnabled,
  deleteDisabled,
  isCompleted,
  onCaptionHint,
  onCopyStyle,
  onDelete,
  onOpenChange,
  onRemix,
  onViewChatHistory,
  open,
  portalContainer,
  showCaption,
  showChatHistory,
}: {
  canCopyStyle: boolean
  canDelete: boolean
  canRemix: boolean
  captionEnabled: boolean
  /**
   * True while the project is still generating. Touch surface, so the
   * muted style carries the signal on its own -- no hover tooltip to read.
   */
  deleteDisabled: boolean
  isCompleted: boolean
  onCaptionHint: () => void
  onCopyStyle: () => void
  onDelete: () => void
  onOpenChange: (open: boolean) => void
  onRemix: () => void
  onViewChatHistory?: () => void
  open: boolean
  portalContainer?: HTMLElement | null
  showCaption: boolean
  showChatHistory: boolean
}) {
  const hasChatHistory = showChatHistory && Boolean(onViewChatHistory)
  if (!(canRemix || canCopyStyle || hasChatHistory || showCaption || canDelete)) {
    return null
  }

  const content = (
    // No row gap: the design stacks the 38px rows flush (y = 6, 44, 82, ...).
    <div className="flex flex-col p-1.5">
      {canRemix && (
        <button className={MENU_ITEM_CLASS} onClick={onRemix} type="button">
          <Remix className="size-6 shrink-0" />
          <span>Remix</span>
        </button>
      )}
      {canCopyStyle && (
        <button className={MENU_ITEM_CLASS} onClick={onCopyStyle} type="button">
          <Copy className="size-6 shrink-0" />
          <span>Copy style</span>
        </button>
      )}
      {showChatHistory && onViewChatHistory && (
        <button className={MENU_ITEM_CLASS} onClick={onViewChatHistory} type="button">
          <Chat className="size-6 shrink-0" />
          <span>Chat history</span>
        </button>
      )}
      {/* A read-only state, matching the Background music row below and the
          design. It used to render a Switch, which read as
          a live control it never was: on mobile onCaptionHint only raises the
          "open this project on desktop to toggle captions" toast, so the switch
          could be dragged and would snap back. The row keeps that tap. */}
      {showCaption && (
        <button
          className={MENU_ITEM_CLASS}
          disabled={!isCompleted}
          onClick={onCaptionHint}
          type="button"
        >
          <Caption className="size-6 shrink-0" />
          <span className="flex-1">Caption</span>
          <span className="text-sm font-medium text-white/50">{captionEnabled ? 'ON' : 'OFF'}</span>
        </button>
      )}
      {canDelete && (
        <>
          {/* 5px band: 2px, the hairline, 2px (Figma `Menu divider` 288x5). */}
          <div className="my-0.5 border-t border-white/10" />
          <button
            className={cn(
              MENU_ITEM_CLASS,
              deleteDisabled && 'cursor-not-allowed text-white/40 hover:bg-transparent',
            )}
            disabled={deleteDisabled}
            onClick={onDelete}
            type="button"
          >
            <Delete className="size-6 shrink-0" />
            <span>Delete</span>
          </button>
        </>
      )}
    </div>
  )

  return (
    <Popover
      align="start"
      // 300px per the design (`Dropdown Menu` 300x245, rows 288x38
      // inside the existing p-1.5).
      className="w-[300px] rounded-2xl border-0 bg-menu/80 p-0 shadow-none backdrop-blur-2xl"
      content={content}
      onOpenChange={onOpenChange}
      open={open}
      portalContainer={portalContainer}
      side="bottom"
      sideOffset={8}
    >
      <Button
        aria-label="More options"
        className={cn(STORY_MODE_ICON_BUTTON_CLASS)}
        type="button"
        variant="ghost"
      >
        <More className="size-[var(--mobile-icon-size)]" />
      </Button>
    </Popover>
  )
}
