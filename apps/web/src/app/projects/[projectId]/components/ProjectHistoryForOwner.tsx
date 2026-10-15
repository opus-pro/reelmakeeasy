'use client'
import { ChatBoxMessage } from '@shared/types/chat/message'
import { EmbeddedBlockMessage } from '@shared/types/chat/message-embedded-block'
import { PROJECT_STAGE } from '@shared/types/enums/project'
import { cn } from '@shared/ui'
import { toast } from '@shared/ui'
import { useAtomValue, useSetAtom } from 'jotai'
import React, { useEffect, useMemo, useRef } from 'react'
import { ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

import { isEditorModeAtom, userInteractionAtom } from '@/atom/sceneCanvas'
import { useProjectId } from '@/contexts/ProjectContext'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useProjectAtom } from '@/hooks/useProjects'
import { useIsMobile } from '@/util/browserUtils'

import { usePanelSizeConfig } from '../hooks/usePanelSizeConfig'
import { useLoadHistoryMessages } from '../hooks/useProjectState'

import EmbeddedBlockEntry from './embedded-block/entry'
import { LayerRegistry } from './inline-layer/LayerRegistry'
import ChatBoxHeader from './ChatBoxHeader'
import ChatMessage, { checkChatMessageValid } from './ChatMessage'
import { Placeholder } from './Placeholder'

const DEFAULT_FAILED_MESSAGE =
  'Something went wrong while generating your video. Try again, or start a new project.'

interface MessageListProps {
  msgList: ChatBoxMessage[]
}

/**
 * The owner's read-only view of a project's history: the persisted message list beside the scene
 * canvas.
 */
export function ProjectHistoryForOwner() {
  const { loaded, msgList } = useLoadHistoryMessages()
  const setUserInteraction = useSetAtom(userInteractionAtom)

  const { projectId } = useProjectId()
  const { projectInfo, isDeleted, error: projectError } = useProjectAtom()

  const backgroundImageUrl = useMemo(() => {
    if (projectInfo?.resultVideoThumbnail) {
      return projectInfo.resultVideoThumbnail
    }
    return undefined
  }, [projectInfo?.resultVideoThumbnail])

  const isMainFocusRef = useRef(false)
  const isMobile = useIsMobile()
  const isEditorMode = useAtomValue(isEditorModeAtom)
  const isFullscreenChatMode = !projectInfo?.scriptConfirmed

  const { maxSize, minSize, handleResizeChange, sidebarWidth } = usePanelSizeConfig()

  // auto scroll to new msg
  const bottomRef = useRef<HTMLDivElement>(null)
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null)
  const mainPanelRef = useRef<ImperativePanelHandle>(null)
  const sidebarWidthRef = useRef(sidebarWidth)
  sidebarWidthRef.current = sidebarWidth
  const lastUpdatedAt = msgList.at(-1)?._feUpdatedAt ?? ''
  const hasMsgUpdated = msgList.length + lastUpdatedAt

  const scrollIfNeeded = useRefCallback(() => {
    if (isMainFocusRef.current) {
      return
    }
    if (bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'smooth', inline: 'nearest' })
    }
  })
  useEffect(() => {
    scrollIfNeeded()
  }, [hasMsgUpdated, scrollIfNeeded])

  useEffect(() => {
    if (projectError) {
      toast.error(projectError.message || 'Failed to fetch project')
    }
  }, [projectError])

  // Monitor project stage changes and show toast when project fails
  useEffect(() => {
    const currentStage = projectInfo?.stage

    if (currentStage === PROJECT_STAGE.FAILED) {
      toast.error(DEFAULT_FAILED_MESSAGE, { duration: 6000 })
    }
  }, [projectInfo?.stage])

  useEffect(() => {
    if (isEditorMode) {
      sidebarPanelRef.current?.resize(0)
    } else {
      sidebarPanelRef.current?.resize(sidebarWidthRef.current)
    }
  }, [isEditorMode])

  useEffect(() => {
    if (isFullscreenChatMode) {
      sidebarPanelRef.current?.resize(100)
      mainPanelRef.current?.resize(0)
      return
    }

    sidebarPanelRef.current?.resize(sidebarWidthRef.current)
    mainPanelRef.current?.resize(100 - sidebarWidthRef.current)
  }, [isFullscreenChatMode])

  const renderMessageList = useMemo(() => {
    if (!projectId) {
      return null
    }
    if (!loaded || msgList.length === 0) {
      return <Placeholder text="Loading..." />
    }
    return <MessageList msgList={msgList} />
  }, [projectId, loaded, msgList])

  if (isDeleted) {
    return (
      <div className="bg-black flex h-screen flex-col items-center justify-center">
        <div className="text-center space-y-2">
          <h1 className="text-xl font-semibold text-white/80">Project Deleted</h1>
          <p className="text-white/60">This project has been deleted or no longer exists.</p>
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative flex h-screen flex-col overflow-hidden"
      onClick={() => setUserInteraction(true)}
    >
      {/* Background image */}
      {backgroundImageUrl && (
        <>
          <div
            className="fixed inset-0 z-0"
            style={{
              backgroundImage: `url(${backgroundImageUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              backgroundRepeat: 'no-repeat',
            }}
          />
          <div className="fixed inset-0 z-0 backdrop-blur-2xl bg-black/90" />
        </>
      )}
      <ChatBoxHeader projectId={projectId} shareMode={false} />
      {isMobile ? (
        <div className="relative flex h-[calc(100dvh-48px)] w-full flex-col">
          <div className="relative flex-1 flex items-center justify-center overflow-hidden px-4 pb-4">
            <div className="size-full max-h-[50vh] flex items-center justify-center">
              <LayerRegistry />
            </div>
          </div>
        </div>
      ) : (
        <PanelGroup className="h-[calc(100vh-48px)] overflow-hidden" direction="horizontal">
          {/* Resizable Sidebar */}
          <Panel
            className={cn(
              'flex h-full flex-col overflow-hidden transition-[flex,opacity] duration-300 ease-out',
              isEditorMode && 'opacity-0',
            )}
            defaultSize={sidebarWidth}
            maxSize={isFullscreenChatMode ? 100 : maxSize}
            minSize={isEditorMode || isFullscreenChatMode ? 0 : minSize}
            onResize={isEditorMode || isFullscreenChatMode ? undefined : handleResizeChange}
            ref={sidebarPanelRef}
          >
            <aside className="relative flex size-full flex-col border-r border-tertiary">
              <main
                className={cn(
                  'scrollbar-thin flex flex-1 flex-col overflow-y-auto',
                  isFullscreenChatMode && 'mx-auto w-full max-w-4xl',
                )}
                onMouseEnter={() => (isMainFocusRef.current = true)}
                onMouseLeave={() => (isMainFocusRef.current = false)}
              >
                <section
                  className={cn(
                    'relative flex flex-1 flex-col content-end pt-6',
                    isFullscreenChatMode ? 'px-3' : 'pl-4 pr-3',
                  )}
                >
                  {renderMessageList}
                  <div className="h-52 w-full" ref={bottomRef} />
                </section>
              </main>
            </aside>
          </Panel>
          {/* Resize Handle - hidden in editor mode or fullscreen */}
          <PanelResizeHandle
            className={cn(
              'w-1 cursor-col-resize bg-transparent transition-all duration-300 hover:bg-gray-500',
              (isEditorMode || isFullscreenChatMode) && 'w-0 opacity-0 pointer-events-none',
            )}
          />

          {/* Main content area with independent scrolling */}
          <Panel
            className={cn('relative overflow-hidden transition-[flex] duration-300 ease-out')}
            collapsible={false}
            defaultSize={100 - sidebarWidth}
            minSize={isFullscreenChatMode ? 0 : undefined}
            ref={mainPanelRef}
          >
            <div className="relative size-full overflow-y-auto">
              <div className="box-border flex h-full items-center justify-center">
                <LayerRegistry />
              </div>
            </div>
          </Panel>
        </PanelGroup>
      )}
    </div>
  )
}

const MessageList: React.FC<MessageListProps> = ({ msgList }) => {
  // Track the last rendered message's role for showLogo logic
  let lastRenderedRole: null | string = null

  const messages = msgList.map((entry, index) => {
    const isLast = index === msgList.length - 1
    // Check if last rendered message was user or embedded-block
    const lastOneIsUser = lastRenderedRole === 'user' || lastRenderedRole === 'embedded-block'
    if (entry.role === 'event') {
      return null
    }
    if (entry.role === 'embedded-block') {
      lastRenderedRole = 'embedded-block'
      return <EmbeddedBlockEntry entry={entry as EmbeddedBlockMessage} key={index} />
    }
    const unquotedText = checkChatMessageValid(entry)
    if (!unquotedText) {
      return null
    }
    // Capture lastRenderedRole before updating for this message
    const prevRole = lastRenderedRole
    // Update lastRenderedRole for the next iteration
    lastRenderedRole = entry.role
    return (
      <ChatMessage
        entry={entry}
        isLast={isLast}
        key={index}
        prevRole={prevRole}
        showLogo={lastOneIsUser}
        unquotedText={unquotedText}
      />
    )
  })

  return <>{messages}</>
}
