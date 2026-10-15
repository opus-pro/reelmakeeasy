/**
 * What the project card's "..." menu contains.
 *
 * Extracted verbatim from ProjectListCardV2, which had reached the 800-line cap.
 * Pure functions over already-derived props -- no hooks, no card state -- so the
 * menu's rules can be read, and tested, without the card around them.
 */
import { Project } from '@shared/types/api/project'
import { isSettledProjectStage } from '@shared/types/enums/project'
import { ReactNode } from 'react'

import { type ContextMenuItem } from '@/components/ContextMenu'
import { Chat, CrossCircle, Delete, DownloadCircle, Edit, Export } from '@/components/icons/core'
import { StoryModeCardRemixGlyph } from '@/components/template-card/TemplateVideoCardComponents'

/** Shared with the agent sidebar's row menu (SidebarProjectActions.tsx), which blocks Delete
 *  project the same way. */
export const DELETE_WHILE_GENERATING_TOOLTIP =
  "This project is still generating. You can delete this project once it's complete."

export type BuildMenuItemsArgs = {
  /** Agent mode: the chat that made this project. Adds "Open chat". */
  agentSessionId?: null | string
  /** A cancel request is in flight; the row shows progress and refuses a second click. */
  isCancelling: boolean
  isDownloading: boolean
  /**
   * The project is still being generated. Blocks Delete; see
   * buildLastMenuItem for the settled-stage exemption.
   */
  isGenerating: boolean
  onCancel: () => void
  onDelete: () => void
  onDownloadClick: () => void
  onOpenChat?: () => void
  onRemix: () => void
  onRename: () => void
  onShareMobile?: () => void
  resultVideo?: string
  shareSubmenu?: ReactNode
  showRemix: boolean
  /** The project row's own stage, for the settled-stage delete exemption. */
  stage?: null | string
  /** Live UIP planner status; present only while the session is pre-confirm. */
  uip?: Project['uip']
}

/**
 * The last row of the card menu: Cancel while the planner is still running,
 * Delete once it is not.
 *
 * `uip` is present only while the UIP session is genuinely mid-plan --
 * the list enriches it for `isUip && stage === UIP_PLANNING && status ===
 * 'active'` (projects-list.util.ts). Confirming flips the stage to STORY_LOADER
 * and the session to `completed`, so the field disappears on its own and the
 * Delete branch takes over. That makes `uip` the whole pre-confirm test: no
 * phase allow-list needed, because confirm is refused from every phase but
 * `refinement` (uip-confirm-orchestration.ts).
 *
 * Past confirm, a generating project cannot be deleted -- the delete
 * would tear the row out from under a run the user can no longer follow.
 *
 * One exemption, where `isGenerating` is true but no work is actually in
 * flight, so blocking Delete would strand the row forever: PAUSED (and every
 * other settled stage). `isGenerating` stays true for a paused project with no
 * result video, and the staleness guard deliberately skips settled
 * stages, so it never ages into the failed treatment either -- the gate would
 * be permanent.
 *
 * Failed / canceled / stale-past-96h cards need no exemption -- isGenerating is
 * already false for all of them (isFailedCard).
 */
function buildLastMenuItem({
  isCancelling,
  isGenerating,
  onCancel,
  onDelete,
  stage,
  uip,
}: Pick<
  BuildMenuItemsArgs,
  'isCancelling' | 'isGenerating' | 'onCancel' | 'onDelete' | 'stage' | 'uip'
>): ContextMenuItem {
  if (uip) {
    return {
      icon: <CrossCircle className="size-4.5" />,
      label: isCancelling ? 'Cancelling...' : 'Cancel',
      // No confirmation dialog by product decision -- the click
      // cancels. Disabling while in flight is the only double-click guard.
      disabled: isCancelling,
      onClick: onCancel,
      separator: true,
    }
  }
  const blocked = isGenerating && !isSettledProjectStage(stage)
  return {
    icon: <Delete className="size-4.5" />,
    label: 'Delete',
    onClick: onDelete,
    separator: true,
    ...(blocked ? { disabled: true, tooltip: DELETE_WHILE_GENERATING_TOOLTIP } : {}),
  }
}

// Wraps the desktop Share submenu content so we emit a share-intent event once
// when the submenu Popover opens (mounts), not on copy-link.
export function buildMenuItems({
  agentSessionId,
  isCancelling,
  isDownloading,
  isGenerating,
  onCancel,
  onDelete,
  onDownloadClick,
  onOpenChat,
  onRemix,
  onRename,
  onShareMobile,
  resultVideo,
  shareSubmenu,
  showRemix,
  stage,
  uip,
}: BuildMenuItemsArgs): ContextMenuItem[] {
  const contentActions: ContextMenuItem[] = [
    {
      icon: <DownloadCircle className="size-4.5" />,
      label: isDownloading ? 'Exporting...' : 'Download',
      onClick: onDownloadClick,
      disabled: isDownloading || !resultVideo,
    },
    {
      icon: <Export className="size-4.5" />,
      label: 'Share',
      disabled: isDownloading || !resultVideo,
      submenu: shareSubmenu,
      onClick: onShareMobile,
    },
    ...(showRemix
      ? [
          {
            icon: <StoryModeCardRemixGlyph className="size-4.5" />,
            label: 'Remix', // always enabled: users remix while a video is still generating to create parallel versions
            onClick: onRemix,
          },
        ]
      : []),
  ]
  const lastItem = buildLastMenuItem({
    isCancelling,
    isGenerating,
    onCancel,
    onDelete,
    stage,
    uip,
  })
  return [
    ...contentActions,
    ...(agentSessionId && onOpenChat
      ? [{ icon: <Chat className="size-4.5" />, label: 'Open chat', onClick: onOpenChat }]
      : []),
    {
      icon: <Edit className="size-4.5" />,
      label: 'Rename',
      onClick: onRename,
    },
    lastItem,
  ]
}
