import { Button, cn } from '@shared/ui'
import { useAtomValue, useSetAtom } from 'jotai'
import { memo, useEffect, useMemo, useRef } from 'react'

import LottieCanvas from '@/components/animated/LottieCanvas'
import ShaderGradientBackground from '@/components/animated/ShaderGradientBackground'
import { Pause, Play } from '@/components/icons/core'

import { ProjectBgParams } from '../constants/shader-gradient'

import { EditorCanvas } from './components/EditorCanvas'
import { useDataInitialize } from './hooks/useDataInitialize'
import useRenderPlan from './hooks/useRenderPlan'
import { editorCoreStore } from './stores/editor-core.store'
import { editorUiStore } from './stores/editor-ui.store'
import { extractPrefetchTasksFromRenderPlan } from './utils/extract-prefetch-tasks'
import mediaDataManager from './utils/media-data-manager'

interface EditorProps {
  // Controls whether the audioDriver render engine (EditorCanvas) is
  // mounted. Defaults to true so standalone consumers (e.g. the /editor
  // workbench) keep mounting it immediately. The project page passes false while
  // in watch-only preview, where the engine would otherwise be only CSS-hidden
  // (display:none does not silence audio) and duplicate the result-video sound.
  engineActive?: boolean
  isPlaying: boolean
  onCanvasClick?: () => void
  onPause: () => void
  onTogglePlay: () => void
  projectId?: string
  selected?: boolean
  shotIndex?: number
}

const Editor = ({
  engineActive = true,
  isPlaying,
  selected = false,
  onCanvasClick,
  onTogglePlay,
  onPause,
  projectId,
  shotIndex,
}: EditorProps) => {
  const { isLoading } = useDataInitialize(projectId ?? '')

  const shotNumber = shotIndex !== undefined && shotIndex !== -1 ? shotIndex + 1 : undefined
  const shotLabel =
    shotNumber === undefined ? 'Low resolution' : `Shot${shotNumber} · Low resolution`

  const canvasSize = useAtomValue(editorUiStore.canvasSize)
  const setCanvasScale = useSetAtom(editorUiStore.canvasScale)

  const currentShot = useAtomValue(editorCoreStore.currentShot)
  const generatingShots = useAtomValue(editorUiStore.generatingShots)

  const isGeneratingVideo = useMemo(
    () =>
      Boolean(
        currentShot?.id &&
          generatingShots.some((s) => s.id === currentShot.id && s.phase === 'video'),
      ),
    [currentShot?.id, generatingShots],
  )

  useEffect(() => {
    if (isGeneratingVideo && isPlaying) {
      onPause()
    }
  }, [isGeneratingVideo, isPlaying, onPause])

  const videoScript = useAtomValue(editorCoreStore.videoScript)

  const renderPlan = useRenderPlan(videoScript)

  const prefetchTasks = useMemo(() => {
    if (!renderPlan) {
      return []
    }
    return extractPrefetchTasksFromRenderPlan(renderPlan)
  }, [renderPlan])

  useEffect(() => {
    if (prefetchTasks.length > 0) {
      mediaDataManager.warmup(prefetchTasks)
    }

    return () => {
      mediaDataManager.abortWarmup()
    }
  }, [prefetchTasks])

  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect

        if (width === 0 || height === 0) {
          return
        }

        const scaleByWidth = width / canvasSize.width
        const scaleByHeight = height / canvasSize.height

        const newScale = Math.min(scaleByWidth, scaleByHeight)

        setCanvasScale(newScale)
      }
    })

    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
    }
  }, [canvasSize.width, canvasSize.height, setCanvasScale])

  return (
    <div className="relative flex h-full w-auto flex-col items-center justify-center">
      <div
        className={cn(
          'group relative flex w-auto items-center justify-center rounded-xl aspect-[9/16] h-[calc(100%-16px)] overflow-hidden bg-white/5',
          selected && 'ring-2 ring-accent-green',
        )}
        onClick={onCanvasClick}
        ref={containerRef}
      >
        {renderPlan && !isLoading && engineActive && <EditorCanvas renderPlan={renderPlan} />}
        {/* Generating overlay - only show during video generation phase */}
        {isGeneratingVideo && (
          <div className="relative flex size-full flex-1 flex-col items-center justify-center gap-y-2 px-8 bg-transparent pointer-events-none z-20">
            <LottieCanvas size={20} type="hourglass" />
            <div className="text-sm font-medium w-full break-words text-center text-primary">
              Generating your shot
            </div>
            <div className="text-secondary text-center text-xs">This usually takes 1-2 minutes</div>
          </div>
        )}
        {/* Top gradient overlay with Shot label */}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-black/60 to-transparent">
          <span className="absolute top-2 left-2 text-xs font-medium text-secondary">
            {shotLabel}
          </span>
        </div>
        <div
          className={cn(
            'pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 transition-opacity duration-200',
            isPlaying ? 'group-hover:opacity-100 opacity-0' : 'opacity-100',
            isGeneratingVideo && 'hidden',
          )}
        >
          <Button
            className="text-primary bg-menu/80 pointer-events-auto size-12 cursor-pointer rounded-full backdrop-blur-xl"
            onClick={(e) => {
              e.stopPropagation()
              onTogglePlay()
            }}
          >
            {isPlaying ? <Pause className="size-5" /> : <Play className="size-5" />}
          </Button>
        </div>
        <ShaderGradientBackground
          className={cn(
            'absolute z-10 rounded-xl inset-0 pointer-events-none overflow-hidden',
            isGeneratingVideo ? 'opacity-100' : 'opacity-0',
          )}
          gradientProps={ProjectBgParams}
        />
      </div>
    </div>
  )
}

export default memo(Editor)
