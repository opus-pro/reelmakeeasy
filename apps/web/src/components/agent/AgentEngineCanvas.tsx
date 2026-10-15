'use client'

import { cn } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  AUDIO_READY_MAX_WAIT_MS,
  getRenderEngineStore,
  shouldAutoPlay,
  useRenderEngine,
} from '@/app/projects/[projectId]/editor/render-engine-sdk'
import { EnginePlayerOverlay } from '@/app/story-mode/components/editor/EnginePlayerOverlay'
import {
  StoryRenderPlanBuilder,
  useCanvasFit,
  useEnginePlayback,
  useStoryPreviewPlan,
} from '@/app/story-mode/components/editor/render'
import {
  type LoopPreviewMedia,
  useLoopSfxBedPlayback,
} from '@/app/story-mode/components/editor/render/loopPreview'
import { useBgmBedPlayback } from '@/app/story-mode/components/editor/render/useBgmBedPlayback'
import { useLiveMusicVolume } from '@/app/story-mode/hook/useMusicToggle'
import { ProgressHalfRing } from '@/components/icons/core'
import { useRefCallback } from '@/hooks/use-ref-callback'

import { claimPlayback, registerEnginePlayer } from './exclusivePlayback'

/** Why the engine can't play: no hardware WebGL, or the wasm never loaded. */
export type AgentEngineCanvasProps = {
  aspectRatio: string
  /** Start playing once the first frame is ready (the user pressed play on the poster). */
  autoPlay?: boolean
  /** The bed's measured bed-to-voice gain (dB): the live level follows the export mix. */
  bgmGainDb?: null | number
  /** The background-music bed, played under the voice-over when `musicEnabled`. */
  bgmUrl?: null | string
  bgmVolume?: null | number
  /** Whether the preview draws captions (the project's caption switch). */
  captionEnabled: boolean
  /** Size classes for the box the video is fitted into (it needs a height). */
  className: string
  /**
   * A loop short's preview media (`loopPreviewMedia`): it plays on a loop, its joined clips
   * muted in the engine and their sound beside it, as the delivered file mixes them.
   */
  loop?: LoopPreviewMedia | null
  musicEnabled?: boolean
  /** The engine can't play here: show the rendered file instead. */
  onUnavailable: (reason: EngineUnavailableReason) => void
  projectId: string
  voiceOverUrl: string
}

export type EngineUnavailableReason = 'load-timeout' | 'no-plan' | 'no-webgl'

/** Past this without the wasm loaded, or then without a first frame, the player gives up
 *  for the rendered file. */
const LOAD_TIMEOUT_MS = 20_000

// Every mount gets its own engine name (and canvas id): the agent page can run more than
// one engine (the chat card and the storyboard), and none may share the editor's 'Module'.
let instanceCount = 0

/**
 * A finished video played live by the Story Mode editor's engine (AVEditorEngine
 * WASM), exactly as the editor previews it: the same plan (`useStoryPreviewPlan`:
 * segments, video script, captions, `StoryRenderPlanBuilder`), canvas fit, playback
 * glue and player controls as `StorySequencerV2`, without the editing chrome. Captions
 * are laid out, animated and drawn by the engine, so they look as in the editor, and
 * turning them off is instant.
 *
 * A loop short plays on a loop: the clips it was delivered from (joined, muted), its
 * voice-over, captions and fact stamps in the engine, and the clips' sound beside it. Should the
 * clips in its state not be them (a render saving new clips), it plays the clips in its state
 * one by one with no clip sound, as the editor does.
 *
 * Its engine is destroyed on unmount, and starting it pauses any other player on the
 * page. Mounted only for the page's one live player (`AgentVideoPreview`). Needs a cross-origin isolated page with WebGL (`AgentVideoPreview` checks both).
 */
export default function AgentEngineCanvas({
  aspectRatio,
  autoPlay = false,
  bgmGainDb,
  bgmUrl,
  bgmVolume,
  captionEnabled,
  className,
  loop = null,
  musicEnabled = false,
  onUnavailable,
  projectId,
  voiceOverUrl,
}: AgentEngineCanvasProps) {
  const [{ canvasId, moduleName }] = useState(() => {
    instanceCount += 1
    return {
      canvasId: `agent-preview-canvas-${instanceCount}`,
      moduleName: `ModuleAgentPreview${instanceCount}`,
    }
  })
  const store = getRenderEngineStore(moduleName)

  const { width: canvasWidth, height: canvasHeight } = useMemo(
    () => StoryRenderPlanBuilder.parseAspectRatio(aspectRatio),
    [aspectRatio],
  )
  const containerRef = useRef<HTMLDivElement>(null)
  const displaySize = useCanvasFit(containerRef, canvasWidth, canvasHeight)

  // The playhead only picks the editor's active shot; the plan doesn't depend on it, so
  // 0 spares a re-render on every frame.
  const { planFailed, playsLoopClips, renderPlan, totalMs } = useStoryPreviewPlan(projectId, {
    aspectRatio,
    captionEnabled,
    currentMs: 0,
    loopClipsUrl: loop?.clipsUrl ?? null,
    voiceOverUrl,
  })

  const { audioReady, hardwareAccelerationUnavailable, playbackCompleted, readyForPlay } =
    useRenderEngine({
      destroyOnUnmount: true,
      moduleName,
      renderPlan: renderPlan ?? undefined,
      videoCanvasId: canvasId,
    })

  useEffect(() => {
    if (hardwareAccelerationUnavailable) {
      onUnavailable('no-webgl')
    }
  }, [hardwareAccelerationUnavailable, onUnavailable])
  useEffect(() => {
    if (planFailed) {
      onUnavailable('no-plan')
    }
  }, [onUnavailable, planFailed])

  // Two stages, each with its own window: the wasm loading, then the engine being
  // created and drawing its first frame.
  const wasmLoaded = useAtomValue(store.wasmLoaded)
  useEffect(() => {
    if (readyForPlay) return
    const timer = window.setTimeout(() => onUnavailable('load-timeout'), LOAD_TIMEOUT_MS)
    return () => window.clearTimeout(timer)
  }, [onUnavailable, readyForPlay, wasmLoaded])

  const engineActions = useAtomValue(store.engineActions)
  const isBuffering = useAtomValue(store.videoLoading)
  const { isPlaying, pause, play, seek } = useEnginePlayback({
    engineActions,
    loop: !!loop,
    playbackCompleted,
  })

  // The music bed plays beside the engine (a DOM audio element on the engine's clock): the
  // shipped engine does not audibly mix a second audio track.
  const engineMs = useAtomValue(store.currentTime)
  // The level the slider is on (the live one while it moves), else the saved one.
  const liveMusicVolume = useLiveMusicVolume(projectId, bgmVolume)
  useBgmBedPlayback({
    bedGainDb: bgmGainDb,
    enabled: musicEnabled,
    engineMs,
    playing: isPlaying && !isBuffering,
    url: musicEnabled ? bgmUrl : null,
    volume: liveMusicVolume,
  })
  // A loop's clip sound, the same way, while the plan plays the clips it was made from.
  useLoopSfxBedPlayback({
    engineMs,
    loop: playsLoopClips ? loop : null,
    playing: isPlaying && !isBuffering,
    totalMs,
  })

  useEffect(() => registerEnginePlayer(moduleName, pause), [moduleName, pause])
  const handlePlay = useRefCallback(() => {
    claimPlayback({ engine: moduleName })
    play()
  })
  const handleSeek = useRefCallback((sec: number) => seek(sec * 1000))

  // Autoplay starts once the first frame is drawn and the engine's audio is up, so the
  // narration plays from the first frame; after a short wait it plays anyway.
  const autoPlayedRef = useRef(false)
  const [audioWaitOver, setAudioWaitOver] = useState(false)
  useEffect(() => {
    if (!autoPlay || !readyForPlay || audioReady) return
    const timer = window.setTimeout(() => setAudioWaitOver(true), AUDIO_READY_MAX_WAIT_MS)
    return () => window.clearTimeout(timer)
  }, [audioReady, autoPlay, readyForPlay])
  useEffect(() => {
    if (autoPlayedRef.current) return
    const waitedMs = audioWaitOver ? AUDIO_READY_MAX_WAIT_MS : 0
    if (!shouldAutoPlay({ audioReady, autoPlay, readyForPlay, waitedMs })) return
    autoPlayedRef.current = true
    handlePlay()
  }, [audioReady, audioWaitOver, autoPlay, handlePlay, readyForPlay])

  return (
    <div className={cn('flex w-full items-center overflow-hidden', className)} ref={containerRef}>
      <div
        className="relative flex-none overflow-hidden rounded-lg bg-black"
        style={displaySize ?? undefined}
      >
        <canvas
          aria-label="Your video"
          className="block"
          height={canvasHeight}
          id={canvasId}
          onContextMenu={(e) => e.preventDefault()}
          style={displaySize ?? undefined}
          width={canvasWidth}
        />
        {(isBuffering || !readyForPlay) && (
          <div className="absolute inset-0 z-30 grid place-content-center">
            <ProgressHalfRing className="size-8 animate-spin" />
          </div>
        )}
        {readyForPlay && (
          <EnginePlayerOverlay
            currentTimeAtom={store.currentTime}
            isPlaying={isPlaying}
            onPause={pause}
            onPlay={handlePlay}
            onSeek={handleSeek}
            showPlayButton={!isBuffering}
            totalSec={totalMs / 1000}
          />
        )}
      </div>
    </div>
  )
}
