import { cn } from '@shared/ui'
import { useAtomValue, useSetAtom } from 'jotai'
import { forwardRef, memo, useEffect, useImperativeHandle } from 'react'

import { isEditorModeAtom } from '@/atom/sceneCanvas'
import { useSceneData } from '@/contexts/SceneDataContext'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useProjectAtom } from '@/hooks/useProjects'

import Editor from '../../editor'
import { EditShotPanel } from '../../editor/components/EditShotPanel'
import { renderMainEngineStore } from '../../editor/render-engine-sdk'
import { editorUiStore } from '../../editor/stores/editor-ui.store'
import { ShotListItem, useShotItems } from '../../hooks/useShotItems'
import { useVideoPlayback } from '../../hooks/useVideoPlayback'

import EditorEngineLoading from './EditorEngineLoading'
import ShotNavigationPanel from './ShotNavigationPanel'

export interface VideoEditorRef {
  navigateShot: (direction: -1 | 1) => void
  pause: () => void
  selectShotById: (shotId: string) => void
  togglePlay: () => void
}

interface VideoEditorProps {
  className?: string
  // Forwarded to Editor; when false the audioDriver render engine is
  // not mounted (watch-only preview). Defaults true for standalone consumers.
  engineActive?: boolean
}

const VideoEditor = forwardRef<VideoEditorRef, VideoEditorProps>((props, ref) => {
  const { className, engineActive = true } = props
  const { sceneList, isLoading } = useSceneData()
  const isEngineReady = useAtomValue(renderMainEngineStore.firstFrameEnd)
  const isEditorMode = useAtomValue(isEditorModeAtom)
  const setSelectedShotId = useSetAtom(editorUiStore.selectedShotId)

  const { projectInfo } = useProjectAtom()

  const {
    activeShotIndex,
    activeShotItem,
    navigateShot: getNextShot,
    shotItems,
  } = useShotItems({
    isLoading,
    projectId: projectInfo?.id,
    sceneList,
  })

  const {
    isPlaying,
    pause,
    play,
    playGlobal,
    playShot,
    selectedShotId,
    currentTime,
    duration,
    seekToCurrentTime,
  } = useVideoPlayback({ shotItems })

  useEffect(() => {
    if (isEditorMode && isEngineReady) {
      seekToCurrentTime()
    }
  }, [isEditorMode, isEngineReady])

  const handlePlay = useRefCallback(() => {
    play()
  })

  const handlePause = useRefCallback(() => {
    pause()
  })

  const handleShotSelect = useRefCallback((shot: ShotListItem) => {
    if (!isEngineReady) {
      return
    }
    playShot(shot.id)
  })

  const handleNavigateShot = useRefCallback((direction: -1 | 1) => {
    if (!isEngineReady || shotItems.length === 0) {
      return
    }
    const targetShot = getNextShot(shotItems, direction)
    if (targetShot) {
      handleShotSelect(targetShot)
    }
  })

  const handleSelectShotById = useRefCallback((shotId: string) => {
    if (!isEngineReady || shotItems.length === 0) {
      return
    }
    if (selectedShotId === shotId) {
      return
    }
    const targetShot = shotItems.find((s) => s.id === shotId)
    if (targetShot) {
      handleShotSelect(targetShot)
    }
  })

  const handleEditShotPanelInteract = useRefCallback(() => {
    if (!isEngineReady || !activeShotItem) {
      return
    }
    if (!selectedShotId) {
      setSelectedShotId(activeShotItem.id)
    }
    if (isPlaying) {
      handlePause()
    }
  })

  const handleTogglePlay = useRefCallback(() => {
    if (isPlaying) {
      handlePause()
    } else {
      handlePlay()
    }
  })

  const handleTogglePlayGlobal = useRefCallback(() => {
    if (isPlaying) {
      handlePause()
    } else {
      playGlobal()
    }
  })

  useImperativeHandle(ref, () => ({
    navigateShot: handleNavigateShot,
    pause: () => {
      if (isPlaying) {
        handlePause()
      }
    },
    selectShotById: handleSelectShotById,
    togglePlay: handleTogglePlay,
  }))

  return (
    <main className={cn('flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden', className)}>
      <div className="flex min-h-0 flex-1 flex-row gap-4 overflow-hidden">
        <aside className="w-[400px] border-r border-tertiary">
          <ShotNavigationPanel
            activeShotId={selectedShotId ?? activeShotItem?.id}
            currentTime={currentTime}
            disabled={!isEngineReady}
            duration={duration}
            isPlaying={isPlaying}
            loading={!isEngineReady}
            onShotSelect={(shot) => {
              const matchedShot = shotItems.find((s) => s.id === shot.id)
              if (matchedShot) {
                handleShotSelect(matchedShot)
              }
            }}
            onTogglePlay={handleTogglePlayGlobal}
            shots={shotItems.map((shot) => ({
              id: shot.id,
              script: shot.script,
              thumbnailUrl: shot.thumbnailUrl || shot.sceneThumbnailUrl,
            }))}
          />
        </aside>
        <section
          className={cn(
            'relative flex min-h-0 min-w-0 flex-1 flex-col items-center overflow-hidden',
            // On large screens, shift left by half of shot nav width (400px/2 = 200px) to achieve true page center
            'min-[1920px]:-translate-x-[200px]',
          )}
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setSelectedShotId(null)
            }
          }}
        >
          <div
            className="relative flex min-h-0 flex-1 flex-col items-center w-full"
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                setSelectedShotId(null)
                e.stopPropagation()
              }
            }}
          >
            {/* Video area - dynamic height */}
            <div className="flex-1 min-h-0 flex flex-col items-center justify-center pt-5 relative">
              {/* Editor - fades in when ready */}
              <div
                className={cn(
                  'relative flex h-full w-auto flex-col items-center justify-center transition-opacity duration-300',
                  isEngineReady ? 'opacity-100' : 'opacity-0 pointer-events-none',
                )}
              >
                <Editor
                  engineActive={engineActive}
                  isPlaying={isPlaying}
                  onCanvasClick={() => handleSelectShotById(activeShotItem?.id ?? '')}
                  onPause={pause}
                  onTogglePlay={handleTogglePlay}
                  projectId={projectInfo?.id}
                  selected={!!selectedShotId}
                  shotIndex={activeShotIndex}
                />
              </div>
              {/* Loading state - fades out when ready */}
              <div
                className={cn(
                  'absolute inset-0 pt-5 flex items-center justify-center transition-opacity duration-300',
                  isEngineReady ? 'opacity-0 pointer-events-none' : 'opacity-100',
                )}
              >
                <EditorEngineLoading
                  className="h-[calc(100%-16px)] bg-black"
                  showBackground={false}
                />
              </div>
            </div>
            {/* Bottom action buttons */}
            <div className="shrink-0 pt-2 pb-6">
              <EditShotPanel
                disabled={!isEngineReady}
                onUserInteract={handleEditShotPanelInteract}
              />
            </div>
          </div>
        </section>
      </div>
    </main>
  )
})

VideoEditor.displayName = 'VideoEditor'

export default memo(VideoEditor)
