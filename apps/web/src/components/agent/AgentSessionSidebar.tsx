'use client'

import {
  AGENT_MODE_LABEL,
  sessionRowMenu,
  sessionRowStatus,
  visibleSessions,
} from '@reelmakeeasy/common/codex-agent/agent-sessions'
import type { AgentSessionListItem } from '@shared/types/api/agent'
import { Button, cn, Popover } from '@shared/ui'
import { type ReactNode, useEffect, useRef, useState } from 'react'

import { type ContextMenuItem, ContextMenuItems } from '@/components/ContextMenu'
import { Chat, Delete, More as MoreIcon, Plus } from '@/components/icons/core'
import { ProjectCardStatusPill } from '@/components/projects-v2/ProjectCardStatusPill'

import { useAgentPicker } from './AgentPickerDialog'
import { DeleteChatDialog } from './DeleteChatDialog'
import { useAgentSessions, useRefreshAgentSessions } from './useAgentSessions'
import { useProjectProgress } from './useProjectProgress'

export type RowMenuBuilder = (item: AgentSessionListItem) => ContextMenuItem[]

const RELATIVE = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' })

function ago(iso: string): string {
  const minutes = Math.round((Date.parse(iso) - Date.now()) / 60_000)
  if (Math.abs(minutes) < 60) return RELATIVE.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return RELATIVE.format(hours, 'hour')
  return RELATIVE.format(Math.round(hours / 24), 'day')
}

function Row({
  active,
  item,
  menu,
  onDeleteChat,
  onOpen,
  onRenameDone,
  renaming,
}: {
  active: boolean
  item: AgentSessionListItem
  menu: ContextMenuItem[]
  onDeleteChat: () => void
  onOpen: () => void
  onRenameDone?: (name: null | string) => void
  renaming: boolean
}) {
  const [open, setOpen] = useState(false)
  // Escape cancels and the input unmounts while still focused; React can then deliver its
  // blur with the pre-unmount handler, which would otherwise commit the typed name. Reset
  // whenever a rename starts so a later Escape-then-reopen still cancels correctly.
  const cancelledRef = useRef(false)
  useEffect(() => {
    if (renaming) cancelledRef.current = false
  }, [renaming])
  const rules = sessionRowMenu(item)
  const items: ContextMenuItem[] = [
    ...menu,
    {
      disabled: !rules.deleteChat,
      icon: <Delete className="size-4.5" />,
      label: 'Delete chat',
      onClick: onDeleteChat,
      separator: menu.length > 0,
      ...(rules.deleteChat ? {} : { tooltip: 'Stop the chat first' }),
    },
  ]
  const thumb = (
    <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/5">
      {item.project?.thumbnail && !item.project.deleted ? (
        <img alt="" className="size-full object-cover" src={item.project.thumbnail} />
      ) : item.rankingCoverUrl ? (
        // A Ranking chat: its ranking's cover, cut to its middle (the clip shows best there; the
        // title band is too small to read at this size).
        <img alt="" className="size-full object-cover" src={item.rankingCoverUrl} />
      ) : (
        <Chat aria-hidden className="size-4.5 text-secondary" />
      )}
    </span>
  )
  const meta = (
    <>
      <span className="block truncate text-xs text-secondary">
        {item.mode ? `${AGENT_MODE_LABEL[item.mode]} · ` : ''}
        {ago(item.updatedAt)}
      </span>
      <RowStatus item={item} />
    </>
  )
  // The chat opens from a real button, with the actions button beside it rather than inside
  // it: a control inside another can't be reached or announced properly.
  return (
    <div
      className={cn(
        'group flex w-full items-center gap-1 rounded-lg pr-2 hover:bg-white/5',
        active && 'bg-white/10 hover:bg-white/10',
      )}
    >
      {renaming ? (
        <div className="flex min-w-0 flex-1 items-center gap-2.5 p-2">
          {thumb}
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <input
              aria-label="Chat name"
              autoFocus
              className="w-full rounded-md border border-white/10 bg-black/15 px-2 py-0.5 text-sm text-white outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring"
              defaultValue={item.title}
              maxLength={100}
              onBlur={(e) => {
                if (cancelledRef.current) return
                onRenameDone?.(e.currentTarget.value)
              }}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                e.stopPropagation()
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  cancelledRef.current = true
                  onRenameDone?.(null)
                }
              }}
            />
            {meta}
          </div>
        </div>
      ) : (
        <button
          aria-current={active ? 'page' : undefined}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-lg p-2 text-left"
          onClick={onOpen}
          type="button"
        >
          {thumb}
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="block truncate text-sm text-primary">{item.title}</span>
            {meta}
          </span>
        </button>
      )}
      <div onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
        <Popover
          align="end"
          className="w-[220px] rounded-[16px] border-0 bg-menu/80 p-0 shadow-none backdrop-blur-2xl"
          content={
            <ContextMenuItems
              itemClassName="h-[38px] rounded-sm px-2.5 text-sm font-medium leading-[17px] hover:bg-white/10"
              items={items}
              onItemClick={() => setOpen(false)}
            />
          }
          onOpenChange={setOpen}
          open={open}
          side="bottom"
          sideOffset={6}
        >
          <Button
            aria-label="Chat actions"
            className="size-6 rounded-full border-0 bg-transparent p-0 text-white/60 opacity-0 transition-opacity hover:bg-white/[0.18] hover:text-white focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
            size="sm"
            type="button"
            variant="ghost"
          >
            <MoreIcon className="size-4" />
          </Button>
        </Popover>
      </div>
    </div>
  )
}

function RowStatus({ item }: { item: AgentSessionListItem }) {
  const status = sessionRowStatus(item)
  // Under the sidebar's ProjectProgressProvider (AgentPageContent) for generating rows.
  const progress = useProjectProgress(status.kind === 'generating' ? item.project!.id : null)
  if (status.kind === 'none') return null
  if (status.kind === 'deleted')
    return <span className="text-xs text-secondary">Project deleted</span>
  if (status.kind === 'failed') return <span className="text-xs text-red-400">Failed</span>
  if (status.kind === 'done')
    return <ProjectCardStatusPill className="h-6 self-start" label="Done" variant="done" />
  return (
    <ProjectCardStatusPill
      className="h-6 self-start"
      label="Generating"
      progressLabel={progress.percent > 0 ? `${Math.round(progress.percent)}%` : undefined}
      variant="progress"
    />
  )
}

/**
 * The agent page's list of chats, newest first, each with the video it made. A click opens
 * the chat (a client navigation inside /agent); the row menu manages the chat and its
 * project. `rowMenu` adds the project items (Task 7); Delete chat is always last.
 */
export function AgentSessionSidebar({
  activeId,
  footer,
  onNavigate,
  onRenameDone,
  renamingId,
  rowMenu,
}: {
  activeId: null | string
  footer?: ReactNode
  onNavigate: (url: string) => void
  onRenameDone?: (name: null | string) => void
  renamingId?: null | string
  rowMenu?: RowMenuBuilder
}) {
  const { data, error, isLoading } = useAgentSessions()
  const refresh = useRefreshAgentSessions()
  const { openPicker, picker, starting } = useAgentPicker({ hard: false })
  const [deleting, setDeleting] = useState<AgentSessionListItem | null>(null)
  // Hides rows whose mode was never chosen (an Agent-button press that never became a real
  // chat) except the one that's currently open, so empty "New chat" rows don't pile up.
  const rows = data ? visibleSessions(data, activeId) : data

  return (
    <nav aria-label="Agent chats" className="flex size-full flex-col gap-2 p-2">
      <Button
        className="h-9 justify-start gap-2 rounded-lg bg-white/5 px-3 text-sm text-primary hover:bg-white/10"
        disabled={starting}
        onClick={openPicker}
        variant="ghost"
      >
        <Plus aria-hidden className="size-4" />
        {starting ? 'Opening…' : 'New chat'}
      </Button>
      {picker}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <p className="p-2 text-xs text-secondary">Loading chats…</p>}
        {error && <p className="p-2 text-xs text-secondary">{error.message}</p>}
        {rows?.length === 0 && <p className="p-2 text-xs text-secondary">No chats yet</p>}
        <div className="flex flex-col gap-0.5">
          {rows?.map((item) => (
            <Row
              active={item.id === activeId}
              item={item}
              key={item.id}
              menu={rowMenu?.(item) ?? []}
              onDeleteChat={() => setDeleting(item)}
              onOpen={() => onNavigate(`/agent?sessionId=${encodeURIComponent(item.id)}`)}
              onRenameDone={onRenameDone}
              renaming={item.id === renamingId}
            />
          ))}
        </div>
      </div>
      {footer}
      <DeleteChatDialog
        item={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={(id) => {
          refresh()
          if (id === activeId) onNavigate('/agent')
        }}
      />
    </nav>
  )
}
