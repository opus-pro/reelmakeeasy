import { Button, cn, Popover } from '@shared/ui'
import { useState } from 'react'

import { Chat, Copy, Export, More } from '@/components/icons/core'

import {
  STORY_MODE_ACTION_BUTTON_BASE_CLASS,
  STORY_MODE_ACTION_BUTTON_LABEL_CLASS,
  STORY_MODE_ICON_BUTTON_CLASS,
} from '../../constants'
import { CopyStyleIcon, RemixIcon } from '../StoryModeIcons'

interface TopActionRowProps {
  canCopyStyle: boolean
  canRemix: boolean
  // Collapse the secondary actions (Copy style, View chat history) into the
  // top-right overflow menu. Only the owner's project page has two of them;
  // demo and share viewers have no chat history, so there the menu would hold
  // a single item and Copy style sits inline next to Remix instead.
  collapseSecondaryActions: boolean
  isMobile?: boolean
  onCopyStyle: () => void
  onRemix: () => void
  onShare: () => Promise<void> | void
  onViewChatHistory?: () => void
  showChatHistory?: boolean
}

const ACTION_BUTTON_CLASS = cn(
  STORY_MODE_ACTION_BUTTON_BASE_CLASS,
  STORY_MODE_ACTION_BUTTON_LABEL_CLASS,
)

const MENU_ITEM_CLASS =
  'flex w-full items-center gap-1.5 rounded-sm px-2.5 py-2 text-left text-sm font-medium leading-[17px] text-white transition-colors hover:bg-white/[0.18]'

export function TopActionRow({
  canCopyStyle,
  canRemix,
  collapseSecondaryActions,
  isMobile = false,
  onCopyStyle,
  onRemix,
  onShare,
  onViewChatHistory,
  showChatHistory = false,
}: TopActionRowProps) {
  // On mobile, render Remix as a direct flex child of the parent mobileActions
  // container (display: contents collapses the wrapper) so it participates in
  // the same flex-wrap layout as Share/Download.
  const mobileButtonClass = 'flex-1 basis-[calc(50%-6px)]'

  return (
    <div className={cn(isMobile ? 'contents' : 'flex w-full items-start justify-between gap-2')}>
      <div className={cn(isMobile ? 'contents' : 'flex items-start gap-2')}>
        <Button
          className={cn(ACTION_BUTTON_CLASS, isMobile && mobileButtonClass)}
          disabled={!canRemix}
          onClick={onRemix}
          variant="ghost"
        >
          <RemixIcon />
          <span className="px-[2px]">Remix</span>
        </Button>

        {!isMobile && !collapseSecondaryActions && (
          <Button
            className={ACTION_BUTTON_CLASS}
            disabled={!canCopyStyle}
            onClick={onCopyStyle}
            variant="ghost"
          >
            <CopyStyleIcon />
            <div>Copy style</div>
          </Button>
        )}
      </div>
      {!isMobile && (
        <div className="flex items-center gap-2">
          <VisitorShareButton onShare={onShare} />
          {collapseSecondaryActions && (
            <DesktopMoreMenu
              canCopyStyle={canCopyStyle}
              onCopyStyle={onCopyStyle}
              onViewChatHistory={onViewChatHistory}
              showChatHistory={showChatHistory}
            />
          )}
        </div>
      )}
    </div>
  )
}

// Top-right overflow menu holding the secondary actions (Copy style, View chat
// history) on the owner's project page. Rendered only when it has at least one
// item. Uses the Popover primitive rather than a Radix DropdownMenu, matching
// the mobile detail menu and avoiding the composer-area pointer-swallow issue.
function DesktopMoreMenu({
  canCopyStyle,
  onCopyStyle,
  onViewChatHistory,
  showChatHistory,
}: {
  canCopyStyle: boolean
  onCopyStyle: () => void
  onViewChatHistory?: () => void
  showChatHistory: boolean
}) {
  const [open, setOpen] = useState(false)
  const hasChatHistory = showChatHistory && Boolean(onViewChatHistory)
  if (!canCopyStyle && !hasChatHistory) {
    return null
  }

  const content = (
    <div className="flex flex-col gap-0.5 p-1.5">
      {canCopyStyle && (
        <button
          className={MENU_ITEM_CLASS}
          onClick={() => {
            setOpen(false)
            onCopyStyle()
          }}
          type="button"
        >
          <Copy className="size-4 shrink-0" />
          <span>Copy style</span>
        </button>
      )}
      {hasChatHistory && (
        <button
          className={MENU_ITEM_CLASS}
          onClick={() => {
            setOpen(false)
            onViewChatHistory?.()
          }}
          type="button"
        >
          <Chat className="size-4 shrink-0" />
          <span>View chat history</span>
        </button>
      )}
    </div>
  )

  return (
    <Popover
      align="end"
      className="w-[200px] rounded-2xl border-0 bg-menu/80 p-0 shadow-none backdrop-blur-2xl"
      content={content}
      onOpenChange={setOpen}
      open={open}
      side="bottom"
      sideOffset={8}
    >
      <Button
        aria-label="More options"
        className={cn(STORY_MODE_ICON_BUTTON_CLASS, 'shrink-0 rounded-md')}
        type="button"
        variant="ghost"
      >
        <More className="size-4.5" />
      </Button>
    </Popover>
  )
}

function VisitorShareButton({ onShare }: { onShare: () => Promise<void> | void }) {
  return (
    <Button
      aria-label="Share"
      className={cn(STORY_MODE_ICON_BUTTON_CLASS, 'shrink-0 rounded-md')}
      onClick={() => void onShare()}
      variant="ghost"
    >
      <Export className="size-4.5" />
    </Button>
  )
}
