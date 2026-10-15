import { useAtomValue } from 'jotai'
import { memo, useEffect, useMemo, useRef, useState } from 'react'

import { projectIdAtom } from '@/atom/project'
import { isEditorModeAtom } from '@/atom/sceneCanvas'
import { SceneDataProvider } from '@/contexts/SceneDataContext'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useIsMobile } from '@/util/browserUtils'

import { shouldMountEditorEngine } from '../../editor/editor-mount'
import { useEditorSettings } from '../../editor/hooks/useEditorSettings'
import { renderMainEngineStore } from '../../editor/render-engine-sdk'
import LayerContainer from '../inline-layer/LayerContainer'

import VideoEditor, { VideoEditorRef } from './VideoEditor'
import VideoPreview, { VideoPreviewRef } from './VideoPreview'

const SceneCanvas: React.FC = () => {
  const { enableVideoEditor } = useEditorSettings()
  const isEditMode = useAtomValue(isEditorModeAtom)
  const projectId = useAtomValue(projectIdAtom)
  const isMobile = useIsMobile()
  const isEngineReady = useAtomValue(renderMainEngineStore.firstFrameEnd)
  const videoPreviewRef = useRef<VideoPreviewRef>(null)
  const videoEditorRef = useRef<VideoEditorRef>(null)
  // A shot selected from the preview storyboard before the editor engine is
  // ready; applied once `isEngineReady` flips true (see effect below). The
  // engine is now created only after entering edit mode (see Editor), so on
  // the first edit it is still booting when the selection arrives.
  const pendingEditShotIdRef = useRef<null | string>(null)

  const shouldRenderEditor = useMemo(
    () => enableVideoEditor && !isMobile,
    [enableVideoEditor, isMobile],
  )

  // Keep VideoEditor mounted (so its data init / history banner run),
  // but only activate the audioDriver render engine once the user enters edit
  // mode. While watch-only, the engine would be merely CSS-hidden and its audio
  // would duplicate the result-video player. The latch is scoped to the current
  // project (this page is not remounted on project navigation), so opening a
  // different project starts gated again instead of inheriting a stale "warm".
  const [editedProjectId, setEditedProjectId] = useState<null | string>(null)
  useEffect(() => {
    if (isEditMode) {
      setEditedProjectId(projectId)
    }
  }, [isEditMode, projectId])
  const engineActive = shouldMountEditorEngine({
    hasEnteredEditMode: editedProjectId === projectId,
    isEditMode,
  })

  // Forward a shot selected from the preview storyboard to the editor. On the
  // first edit the engine is still booting, so defer until it is ready rather
  // than dropping the selection (selectShotById no-ops while !isEngineReady).
  const handleEditShot = useRefCallback((shotId: string) => {
    if (isEngineReady) {
      videoEditorRef.current?.selectShotById(shotId)
    } else {
      pendingEditShotIdRef.current = shotId
    }
  })

  useEffect(() => {
    // Guard on videoEditorRef so a queued selection is not cleared before the
    // editor ref is attached on this tick.
    if (isEditMode && isEngineReady && pendingEditShotIdRef.current && videoEditorRef.current) {
      videoEditorRef.current.selectShotById(pendingEditShotIdRef.current)
      pendingEditShotIdRef.current = null
    }
  }, [isEditMode, isEngineReady])

  // Pause when switching tabs
  useEffect(() => {
    if (isEditMode) {
      videoPreviewRef.current?.pause()
    } else {
      videoEditorRef.current?.pause()
    }
  }, [isEditMode])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null
      const tag = active?.tagName
      const isInputFocused = tag === 'INPUT' || tag === 'TEXTAREA' || active?.isContentEditable

      if (e.code === 'Space' || e.key === ' ') {
        if (isInputFocused) {
          return
        }
        e.preventDefault()
        if (isEditMode && shouldRenderEditor) {
          videoEditorRef.current?.togglePlay()
        } else {
          videoPreviewRef.current?.togglePlay()
        }
        return
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (isInputFocused || !isEditMode || !shouldRenderEditor) {
          return
        }
        e.preventDefault()
        videoEditorRef.current?.navigateShot(e.key === 'ArrowUp' ? -1 : 1)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isEditMode, shouldRenderEditor])

  // Pause when page becomes hidden (tab switch, minimize, etc.)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        videoPreviewRef.current?.pause()
        videoEditorRef.current?.pause()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  return (
    <SceneDataProvider>
      <LayerContainer className="flex-col">
        {shouldRenderEditor && (
          <VideoEditor
            className={isEditMode ? undefined : 'hidden'}
            engineActive={engineActive}
            ref={videoEditorRef}
          />
        )}
        <VideoPreview
          className={isEditMode ? 'hidden' : undefined}
          enableEdit={enableVideoEditor}
          onEditShot={handleEditShot}
          ref={videoPreviewRef}
        />
      </LayerContainer>
    </SceneDataProvider>
  )
}

export default memo(SceneCanvas)
