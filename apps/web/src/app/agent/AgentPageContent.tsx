'use client'

import { sessionRowStatus } from '@reelmakeeasy/common/codex-agent/agent-sessions'
import {
  FLOW_CANCELLED_NOTICE,
  type TranscriptEntry,
} from '@reelmakeeasy/common/codex-agent/agent-transcript'
import { Button, cn } from '@shared/ui'
import { useRouter, useSearchParams } from 'next/navigation'
import { type ReactNode, useEffect, useMemo, useState } from 'react'

import { AgentChat } from '@/components/agent/AgentChat'
import { useAgentPicker } from '@/components/agent/AgentPickerDialog'
import { AgentSessionSidebar } from '@/components/agent/AgentSessionSidebar'
import { ProjectProgressProvider } from '@/components/agent/ProjectProgressProvider'
import { useSidebarProjectActions } from '@/components/agent/SidebarProjectActions'
import { START_EASY_PARAM, startsEasy, useStartEasyOnce } from '@/components/agent/start-easy'
import { StoryboardPanel } from '@/components/agent/StoryboardPanel'
import { useAgentSession } from '@/components/agent/useAgentSession'
import { useAgentSessions, useRefreshAgentSessions } from '@/components/agent/useAgentSessions'
import { SidebarMax, SidebarMin } from '@/components/icons/core'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useMutateQuery } from '@/hooks/useMutateQuery'

const COLLAPSED_KEY = 'agent-sidebar-collapsed'

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/**
 * The agent page: the chat list on the left (a drawer below `md`), then the open chat and
 * its storyboard. Without a `sessionId` it shows the list and a "Start a new chat" screen.
 */
export function AgentPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const sessionId = searchParams?.get('sessionId') ?? null
  // The home page's first-video prompt opens a new chat with Easy to be chosen for the user.
  const startEasy = startsEasy(searchParams)
  const actions = useSidebarProjectActions()
  const [collapsed, setCollapsed] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  useEffect(() => setCollapsed(readCollapsed()), [])
  // Covers New chat and deleting the open chat (both change `sessionId` without going
  // through `navigate` below); `navigate` itself covers a row click that re-opens the
  // *same* chat, which doesn't change `sessionId` and so wouldn't otherwise close the drawer.
  useEffect(() => setDrawerOpen(false), [sessionId])

  const toggle = () => {
    if (window.matchMedia('(min-width: 768px)').matches) {
      setCollapsed((c) => {
        try {
          window.localStorage.setItem(COLLAPSED_KEY, c ? '0' : '1')
        } catch {
          // Private mode: the choice lasts until reload.
        }
        return !c
      })
    } else setDrawerOpen((o) => !o)
  }
  const sidebarButton = (
    <Button
      aria-label="Chats"
      className="size-7 shrink-0 rounded-md p-0 text-secondary hover:bg-white/10 hover:text-primary"
      onClick={toggle}
      variant="ghost"
    >
      {collapsed ? <SidebarMax className="size-4.5" /> : <SidebarMin className="size-4.5" />}
    </Button>
  )
  const navigate = (url: string) => {
    setDrawerOpen(false)
    router.push(url)
  }

  return (
    <div className="flex h-screen w-screen bg-background text-primary">
      {drawerOpen && (
        <div
          aria-hidden
          className="fixed inset-0 z-30 bg-black/50 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}
      <aside
        className={cn(
          'z-40 h-full w-[260px] shrink-0 border-r border-white/10 bg-background',
          'max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:transition-transform',
          drawerOpen ? 'max-md:translate-x-0' : 'max-md:-translate-x-full',
          collapsed && 'md:hidden',
        )}
      >
        <SidebarProgress>
          <AgentSessionSidebar
            activeId={sessionId}
            onNavigate={navigate}
            onRenameDone={(name) => void actions.finishRename(name)}
            renamingId={actions.renamingId}
            rowMenu={actions.rowMenu}
          />
        </SidebarProgress>
      </aside>
      <main className="min-w-0 flex-1">
        {/* The page's heading for screen readers (the chat's title is in its header). */}
        <h1 className="sr-only">Agent chat</h1>
        {sessionId ? (
          <AgentWorkspace
            key={sessionId}
            sessionId={sessionId}
            sidebarButton={sidebarButton}
            startEasy={startEasy}
          />
        ) : (
          <EmptyState sidebarButton={sidebarButton} />
        )}
      </main>
      {actions.dialogs}
    </div>
  )
}

function EmptyState({ sidebarButton }: { sidebarButton: ReactNode }) {
  const { openPicker, picker, starting } = useAgentPicker({ hard: false })
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        {sidebarButton}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3">
        <p className="text-sm text-secondary">Pick a chat, or start a new one.</p>
        <Button disabled={starting} onClick={openPicker}>
          {starting ? 'Opening…' : 'Start a new chat'}
        </Button>
        {picker}
      </div>
    </div>
  )
}

/** Polls progress for the list's generating rows (their status pill's %). */
function SidebarProgress({ children }: { children: ReactNode }) {
  const { data } = useAgentSessions()
  const key = (data ?? [])
    .filter((i) => sessionRowStatus(i).kind === 'generating')
    .map((i) => i.project!.id)
    .join('\n')
  const ids = useMemo(() => (key ? key.split('\n') : []), [key])
  return <ProjectProgressProvider projectIds={ids}>{children}</ProjectProgressProvider>
}

/**
 * One chat: the chat on the left, the live storyboard on the right (stacked, chat first, on
 * narrow screens). Both read one `useAgentSession` (one SSE connection) and one poll per
 * started video (`ProjectProgressProvider`). Tells the chat list to reload when this chat
 * picks a mode, gets its brief, starts a video or gets its first message (its row changes).
 * `startEasy` (the URL's marker): chooses Easy once the chat has loaded, then drops the marker.
 */
function AgentWorkspace({
  sessionId,
  sidebarButton,
  startEasy,
}: {
  sessionId: string
  sidebarButton: ReactNode
  startEasy: boolean
}) {
  const agent = useAgentSession(sessionId)
  const { removeQuery } = useMutateQuery()
  const refreshList = useRefreshAgentSessions()
  const { data: sessions } = useAgentSessions()
  const rowTitle = sessions?.find((s) => s.id === sessionId)?.title
  const { entries } = agent.transcript
  const projectIdsKey = entries
    .filter((e): e is Extract<TranscriptEntry, { kind: 'video' }> => e.kind === 'video')
    .map((e) => e.projectId)
    .join('\n')
  // Stable while the set of videos is: the transcript changes identity on every event.
  const projectIds = useMemo(
    () => (projectIdsKey ? [...new Set(projectIdsKey.split('\n'))] : []),
    [projectIdsKey],
  )
  const mode = agent.transcript.mode ?? agent.session?.mode ?? null
  // Dropped with replace, so a reload or Back doesn't choose again.
  const dropStartEasy = useRefCallback(() => removeQuery([START_EASY_PARAM], { mode: 'replace' }))
  const startingMode = useStartEasyOnce({
    chooseMode: agent.chooseMode,
    marked: startEasy,
    mode,
    onConsumed: dropStartEasy,
    session: agent.session,
  })
  const hasUserMessage = entries.some((e) => e.kind === 'user')
  const pickedIdea = entries.some(
    (e) => e.kind === 'question' && e.state === 'answered' && e.questions[0]?.header === 'Idea',
  )
  // `working` toggling (busy <-> idle) and the count of flow-cancelled notices (a stopped
  // autonomous flow, which doesn't otherwise touch `working`) both mean the row's stale
  // `flowActive`/`status` needs a refetch -- without them the open chat's own row never
  // updates once it stops being busy (it only reloads on the *next* chat-state change).
  const flowCancelledCount = entries.filter(
    (e) => e.kind === 'notice' && e.text === FLOW_CANCELLED_NOTICE,
  ).length
  const rowKey = [
    projectIdsKey,
    mode ?? '',
    hasUserMessage,
    pickedIdea,
    agent.transcript.working,
    flowCancelledCount,
  ].join('|')
  useEffect(() => refreshList(), [rowKey, refreshList])

  if (agent.notFound) {
    return (
      <div className="size-full">
        <AgentChat
          agent={agent}
          headerStart={sidebarButton}
          sessionId={sessionId}
          startingMode={startingMode}
          title={rowTitle}
        />
      </div>
    )
  }

  return (
    <ProjectProgressProvider projectIds={projectIds}>
      <div className="flex size-full flex-col md:flex-row">
        <div className="min-h-0 min-w-0 flex-1 border-b border-white/10 md:border-r md:border-b-0">
          <AgentChat
            agent={agent}
            headerStart={sidebarButton}
            sessionId={sessionId}
            startingMode={startingMode}
            title={rowTitle}
          />
        </div>
        <div className="min-h-0 min-w-0 flex-1">
          <StoryboardPanel mode={mode} sessionId={sessionId} transcript={agent.transcript} />
        </div>
      </div>
    </ProjectProgressProvider>
  )
}
