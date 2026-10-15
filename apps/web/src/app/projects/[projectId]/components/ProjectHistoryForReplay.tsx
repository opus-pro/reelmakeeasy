'use client'

import { EmbeddedBlockMessage } from '@shared/types/chat/message-embedded-block'
import { useAtomValue, useSetAtom } from 'jotai'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

import { SceneStageLayerTypeAtom, userInteractionAtom } from '@/atom/sceneCanvas'
import ReplayController from '@/components/replay-controller'
import { useProjectId } from '@/contexts/ProjectContext'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useIsMobile } from '@/util/browserUtils'

import { usePanelSizeConfig } from '../hooks/usePanelSizeConfig'
import { useLoadReplayMessage } from '../hooks/useProjectState'

import EmbeddedBlockEntry from './embedded-block/entry'
import { LayerRegistry } from './inline-layer/LayerRegistry'
import ChatBoxHeader from './ChatBoxHeader'
import ChatMessage, { checkChatMessageValid } from './ChatMessage'
import { Placeholder } from './Placeholder'

export function ProjectHistoryForReplay({ topOverlay }: { topOverlay?: ReactNode }) {
  const { projectId } = useProjectId()
  const { msgList, loaded } = useLoadReplayMessage()
  const setUserInteraction = useSetAtom(userInteractionAtom)
  const layerType = useAtomValue(SceneStageLayerTypeAtom)
  const isMobile = useIsMobile()
  const [showPreview, setShowPreview] = useState(false)

  const isMainScrolledRef = useRef(false)

  const { maxSize, minSize, handleResizeChange, sidebarWidth } = usePanelSizeConfig()

  // auto scroll to new msg
  const bottomRef = useRef<HTMLDivElement>(null)
  const lastUpdatedAt = msgList.at(-1)?._feUpdatedAt ?? ''
  const hasMsgUpdated = msgList.length + lastUpdatedAt
  const scrollIfNeeded = useRefCallback(() => {
    if (isMainScrolledRef.current) {
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
    if (isMobile) {
      if (layerType === 'default') {
        setShowPreview(false)
      } else {
        setShowPreview(true)
      }
    }
  }, [isMobile, layerType])

  const renderMessageList = () => {
    if (!projectId) {
      return null
    }
    if (!loaded || msgList.length === 0) {
      return <Placeholder text="Loading..." />
    }

    return (
      <>
        {msgList.map((entry, index, list) => {
          const lastOne = list.at(index - 1)
          const lastOneIsUser = lastOne?.role === 'user' || lastOne?.role === 'embedded-block'

          if (entry.role === 'event') {
            return null
          }
          if (entry.role === 'embedded-block') {
            return <EmbeddedBlockEntry entry={entry as EmbeddedBlockMessage} key={index} />
          }
          const unquotedText = checkChatMessageValid(entry)
          if (!unquotedText) {
            return null
          }
          return (
            <ChatMessage
              entry={entry}
              key={index}
              showLogo={lastOneIsUser}
              unquotedText={unquotedText}
            />
          )
        })}
      </>
    )
  }

  const renderChatBoxContent = () => {
    return (
      <main
        className="scrollbar-thin flex flex-1 flex-col overflow-y-auto"
        onMouseLeave={() => (isMainScrolledRef.current = false)}
        onWheel={() => (isMainScrolledRef.current = true)}
      >
        {/* with a 4px scrollbar on the right side, so pr = pl - 1 */}
        <section className="flex flex-1 flex-col content-end px-5 pr-3">
          <div className="space-y-4">
            {renderMessageList()}
            <div className="h-20 w-full" ref={bottomRef} />
          </div>
          <div className="bg-blur pointer-events-none sticky bottom-0 left-0 z-10 size-full" />
        </section>
      </main>
    )
  }

  const renderChatBoxFooter = () => {
    return (
      <footer className="relative shrink-0 p-4">
        {projectId && (
          <ReplayController
            autoPlay
            mode={showPreview ? 'preview' : 'chat'}
            onModeChange={(m) => setShowPreview(m === 'preview')}
          />
        )}
      </footer>
    )
  }

  const topOverlayNode = topOverlay && (
    <div className="pointer-events-none absolute inset-x-0 top-3 z-[80]">{topOverlay}</div>
  )

  return (
    <div className="bg-black flex h-screen flex-col" onClick={() => setUserInteraction(true)}>
      <ChatBoxHeader projectId={projectId} shareMode={true} />
      {isMobile ? (
        <div className="relative flex h-[calc(100dvh-48px)] w-full flex-col">
          {topOverlayNode}
          <div className="relative flex-1 flex items-center justify-center overflow-hidden px-4 pb-4">
            {projectId && <LayerRegistry />}
          </div>
        </div>
      ) : (
        <PanelGroup className="h-[calc(100vh-48px)] px-2 pb-2" direction="horizontal">
          {/* Resizable Sidebar */}
          <Panel
            className="flex h-full min-w-[400px] flex-col"
            collapsible={false}
            defaultSize={sidebarWidth}
            maxSize={maxSize}
            minSize={minSize}
            onResize={handleResizeChange}
          >
            <aside className="relative flex size-full flex-col">
              {renderChatBoxContent()}
              {renderChatBoxFooter()}
            </aside>
          </Panel>
          {/* Resize Handle - always visible for dragging */}
          <PanelResizeHandle className="w-1 cursor-col-resize bg-transparent transition-colors duration-200 hover:bg-gray-500" />

          {/* Main content area with independent scrolling */}
          <Panel
            className="h-[calc(100dvh - 80px)] relative overflow-hidden"
            collapsible={false}
            defaultSize={100 - sidebarWidth}
          >
            <div className="relative h-full overflow-y-auto pb-4">
              {topOverlayNode}
              <div className="bg-uiBlack mr-4 box-border flex h-full items-center justify-center overflow-hidden rounded-2xl border border-transparent">
                {projectId && <LayerRegistry />}
              </div>
            </div>
          </Panel>
        </PanelGroup>
      )}
    </div>
  )
}
