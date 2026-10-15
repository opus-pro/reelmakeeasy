'use client'

import { BEAT_LOOP_USE_CASE } from '@shared/types/api/agent'
import { cn } from '@shared/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useAtom } from 'jotai'
import dynamic from 'next/dynamic'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'

import { detectHardwareAcceleration } from '@/app/projects/[projectId]/editor/render-engine-sdk/detect-hardware-acceleration'
import { loopPreviewMedia } from '@/app/story-mode/components/editor/render/loopPreview'
import { Play } from '@/components/icons/core'
import { VideoPlayer } from '@/components/VideoPlayer'
import { useVideoScript, videoScriptQueryKey } from '@/hooks/useVideoScript'
import { useIsMobile } from '@/util/browserUtils'
import { reloadPage } from '@/util/hard-navigation'

import type { EngineUnavailableReason } from './AgentEngineCanvas'
import { AgentVideoPlayer, type AgentVideoPlayerProps } from './AgentVideoPlayer'
import { claimPlayback, liveEnginePlayerAtom } from './exclusivePlayback'
import { useRenderedFileExists } from './renderedFile'
import { Spinner } from './Spinner'
import { useAgentCaptionChoice } from './useAgentCaptionChoice'
import { useAgentProject, useProjectAspectRatio } from './useAgentProject'
import type { ProjectProgress } from './useProjectProgress'
import { VideoActions } from './VideoActions'

// The engine (WASM glue and all) loads only once a player is started.
const AgentEngineCanvas = dynamic(() => import('./AgentEngineCanvas'), { ssr: false })

export type AgentVideoPreviewProps = {
  progress: ProjectProgress
  projectId: string
  /** Size classes for the player (a height): the box the video is fitted into. */
  videoClassName: string
  /** The rendered file, played where the engine can't be. */
  videoUrl: string
}

/** Why the editor's engine doesn't play here: null while still checking, 'ok' when it can. */
type EngineSupport = 'no-isolation' | 'ok' | EngineUnavailableReason | null

const FALLBACK_NOTE: Record<Exclude<EngineSupport, 'ok' | null>, string> = {
  'load-timeout': "This is the downloadable video: the editor's player didn't load.",
  'no-isolation': '',
  'no-plan': "This is the downloadable video: the editor's player couldn't put it together.",
  'no-webgl': "This is the downloadable video: the editor's player needs hardware acceleration.",
}

/** Whether the project is a loop short: made with `createUseCase: 'beat-loop'` (the API's
 *  loop start writes it into the project it creates). The web `Project` type doesn't list
 *  `createUseCase`, though the project read returns the whole row. */
function isBeatLoopProject(project: null | object | undefined): boolean {
  return !!project && 'createUseCase' in project && project.createUseCase === BEAT_LOOP_USE_CASE
}

/**
 * A loop short's rendered file, shown like `AgentVideoPlayer` shows a file (native controls;
 * starting it pauses any other player on the page), but on a loop: the short is made so its
 * last frame runs into its first. Where the editor's player can't play the loop.
 */
function LoopVideoPlayer({
  aspectRatio,
  onPlayingChange,
  src,
  videoClassName,
}: AgentVideoPlayerProps & { onPlayingChange: (playing: boolean) => void }) {
  // Gone mid-play, it isn't playing: its pause, on a detached element, never comes.
  useEffect(() => () => onPlayingChange(false), [onPlayingChange])
  return (
    <VideoPlayer
      ariaLabel="Your video"
      className={cn('max-w-full rounded-lg bg-black object-contain', videoClassName)}
      containerClassName="w-fit max-w-full"
      loop
      preload="metadata"
      primitiveVideoPlayerProps={{
        controls: true,
        onPause: () => onPlayingChange(false),
        onPlay: (event) => {
          claimPlayback({ media: event.currentTarget })
          onPlayingChange(true)
        },
        style: { aspectRatio },
      }}
      // Native controls own play/pause: the wrapper's click-to-toggle would undo them.
      showHoverPlayButton={false}
      src={src}
    />
  )
}

/**
 * A finished agent video (the chat card's and the storyboard's), played like the Story
 * Mode editor plays it: live by the editor's engine (`AgentEngineCanvas`), so captions
 * look exactly as in the editor, with the editor's caption switch, Download and the
 * editor link under it (`VideoActions`).
 *
 * The engine is started on demand: the player shows the first shot with a play button,
 * and pressing it makes this the page's one live engine player (`liveEnginePlayerAtom`);
 * whichever player had the engine goes back to its poster, its engine destroyed.
 *
 * Where the editor wouldn't use its engine either (a phone, no voiceover to build the
 * plan from) or can't (the page isn't cross-origin isolated, no hardware-accelerated
 * WebGL, the engine didn't load, its plan couldn't be built), it plays the rendered file
 * instead, the one Download saves, or says it isn't rendered yet.
 *
 * A loop short plays live too, on a loop: its joined clips muted, with its voice-over,
 * captions and fact stamps in the engine and its clip sound beside it (`loopPreviewMedia`).
 * It needs both of what make the preview sound and look like the delivered file: the clip
 * sound bed (the status has it once built, after delivery for an older loop) and the facts
 * track a render saves in the video script (a loop not rendered since stamps were a track
 * has none). Without either it plays its rendered file on a loop, and goes live once the
 * bed is there, but not while that file is playing.
 */
export function AgentVideoPreview({
  progress,
  projectId,
  videoClassName,
  videoUrl,
}: AgentVideoPreviewProps) {
  const playerId = useId()
  const isMobile = useIsMobile()
  const [support, setSupport] = useState<EngineSupport>(null)
  useEffect(() => {
    // Checked here rather than left to the engine: its own check reloads a page that
    // isn't isolated, which would drop the chat mid-conversation.
    if (window.crossOriginIsolated) {
      setSupport(detectHardwareAcceleration().supported ? 'ok' : 'no-webgl')
    } else {
      setSupport('no-isolation')
    }
  }, [])
  const handleUnavailable = useCallback((reason: EngineUnavailableReason) => setSupport(reason), [])

  const aspectRatio = useProjectAspectRatio(projectId)
  const project = useAgentProject(projectId)
  const { captionsOn } = useAgentCaptionChoice(projectId, progress.captionsInVideo)
  const voiceOverUrl = progress.audioPreviewUrl
  const beatLoop = isBeatLoopProject(project)
  const { loopClipsUrl, loopSfxBedUrl, loopSfxBedVolume } = progress
  const loop = useMemo(
    () => (beatLoop ? loopPreviewMedia({ loopClipsUrl, loopSfxBedUrl, loopSfxBedVolume }) : null),
    [beatLoop, loopClipsUrl, loopSfxBedUrl, loopSfxBedVolume],
  )
  // The video script the engine would draw a loop's stamps from (the plan's own read, shared).
  const { data: videoScript, isLoading: scriptLoading } = useVideoScript(loop ? projectId : '')
  const loopStamped = !!videoScript?.tracks.some((track) => track.type === 'facts')
  // Where the editor would use its engine; a loop short once it can sound and look like its file.
  const engineWanted = !isMobile && !!voiceOverUrl && (!beatLoop || (!!loop && loopStamped))
  // A loop's file being watched stays on screen when its bed arrives, until it is paused.
  const [loopFilePlaying, setLoopFilePlaying] = useState(false)
  const livePreview = support === 'ok' && engineWanted && !!voiceOverUrl && !loopFilePlaying
  // The status names the delivered file even once it is gone: the fallback checks it.
  const fileExists = useRenderedFileExists(support !== null && !livePreview ? videoUrl : null)

  const [liveEnginePlayer, setLiveEnginePlayer] = useAtom(liveEnginePlayerAtom)
  const isLive = livePreview && liveEnginePlayer === playerId
  // Give the engine back when this player goes away (or stops using it).
  useEffect(() => {
    if (!isLive) return undefined
    return () => setLiveEnginePlayer((current) => (current === playerId ? null : current))
  }, [isLive, playerId, setLiveEnginePlayer])

  // A new render (a new file URL) saved a new video script: read it again, so the preview
  // draws its captions and a loop's stamps (a loop rendered before stamps were a track gets
  // them now) rather than the cached one.
  const queryClient = useQueryClient()
  const seenVideoUrl = useRef(videoUrl)
  useEffect(() => {
    if (seenVideoUrl.current === videoUrl) return
    seenVideoUrl.current = videoUrl
    void queryClient.invalidateQueries({ queryKey: videoScriptQueryKey(projectId) })
  }, [projectId, queryClient, videoUrl])

  // Until a loop with a bed knows whether its stamps are there, so its file doesn't flash first
  // (a file being watched stays).
  if (support === null || (loop && scriptLoading && !loopFilePlaying)) {
    // A placeholder the player's size, so the file doesn't start loading first.
    return (
      <div
        aria-busy
        className={cn('flex max-w-full items-center', videoClassName)}
        style={{ aspectRatio }}
      >
        <Spinner className="text-secondary" />
      </div>
    )
  }

  const poster = progress.keyframes[0]?.url || project?.resultVideoThumbnail || undefined
  let player: React.ReactNode
  if (isLive && voiceOverUrl) {
    player = (
      <AgentEngineCanvas
        aspectRatio={aspectRatio}
        autoPlay
        bgmGainDb={progress.bgmBedGainDb}
        bgmUrl={progress.bgmBedUrl}
        bgmVolume={progress.bgmVolume}
        // Until the status is read, as the delivered video has them (the default).
        captionEnabled={captionsOn ?? true}
        className={videoClassName}
        // A rebuilt video (a new URL): a fresh engine, with the plan read from the new state.
        key={videoUrl}
        loop={loop}
        musicEnabled={progress.bgmEnabled ?? false}
        onUnavailable={handleUnavailable}
        projectId={projectId}
        voiceOverUrl={voiceOverUrl}
      />
    )
  } else if (livePreview) {
    player = (
      <button
        aria-label="Play your video"
        className={cn(
          'group relative flex max-w-full items-center justify-center overflow-hidden rounded-lg bg-black',
          videoClassName,
        )}
        onClick={() => setLiveEnginePlayer(playerId)}
        style={{ aspectRatio }}
        type="button"
      >
        {poster && (
          <img alt="" className="absolute inset-0 size-full object-cover opacity-80" src={poster} />
        )}
        <span className="relative grid size-14 place-content-center rounded-full bg-black/60 text-white transition-transform group-hover:scale-105">
          <Play className="size-7" />
        </span>
      </button>
    )
  } else {
    player = (
      <div className="flex flex-col gap-1.5">
        {fileExists === false ? (
          <div
            className={cn(
              'flex max-w-full flex-col items-center justify-center gap-1 rounded-lg bg-fill-secondary p-4 text-center',
              videoClassName,
            )}
            role="status"
            style={{ aspectRatio }}
          >
            <p className="text-sm text-primary">Video not rendered yet</p>
            <p className="text-xs text-secondary">Download renders it.</p>
          </div>
        ) : beatLoop ? (
          <LoopVideoPlayer
            aspectRatio={aspectRatio}
            onPlayingChange={setLoopFilePlaying}
            src={videoUrl}
            videoClassName={videoClassName}
          />
        ) : (
          <AgentVideoPlayer
            aspectRatio={aspectRatio}
            src={videoUrl}
            videoClassName={videoClassName}
          />
        )}
        {engineWanted && support === 'no-isolation' && (
          <p className="text-xs text-secondary">
            This is the downloadable video.{' '}
            <button
              className="text-primary underline underline-offset-2 hover:text-secondary"
              onClick={reloadPage}
              type="button"
            >
              Reload the page
            </button>{' '}
            to preview it with the editor&apos;s player.
          </p>
        )}
        {engineWanted && support !== 'ok' && support !== 'no-isolation' && (
          <p className="text-xs text-secondary">{FALLBACK_NOTE[support]}</p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      {player}
      <VideoActions livePreview={livePreview} progress={progress} projectId={projectId} />
    </div>
  )
}
