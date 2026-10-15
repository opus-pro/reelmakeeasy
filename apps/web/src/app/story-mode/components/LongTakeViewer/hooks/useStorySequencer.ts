'use client'

import type { LongTakeEditorState, LongTakeEditorStateResponse } from '@shared/types/api/long-take'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import type { RefObject } from 'react'
import { createRef, useEffect, useMemo, useRef, useState } from 'react'

import { useDraftSaveConflictToast } from '@/app/story-mode/hook/useDraftSaveConflictToast'
import type { StoryKeyframeSegment, StoryTransitionSegment } from '@/app/story-mode/long-take.types'
import { longtakeHistoryStore } from '@/atom/longtake-history.store'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useApi } from '@/hooks/useApi'

import { buildSegments, getSegmentAt } from '../StorySequencer/engine'
import { computePreloadedTransitionIds } from '../StorySequencer/preloadedTransitionIds'

const MOUNT_WINDOW = 1
const READY_STATE_FUTURE_DATA = 3
const NETWORK_EMPTY = 0

export interface UseStorySequencerResult {
  activeKeyframeIndex: number
  activeKeyframeSegment: null | StoryKeyframeSegment
  activeTransitionSegment: null | StoryTransitionSegment
  audioRef: RefObject<HTMLAudioElement | null>
  currentMs: number
  currentState: LongTakeEditorState | undefined
  hasInitializedStartPosition: boolean
  isActiveTransitionReady: boolean
  isBuffering: boolean
  isPlaying: boolean
  keyframeSegments: StoryKeyframeSegment[]
  mountedTransitionIds: Set<string>
  pause(): void
  play(): void
  preloadedTransitionIds: Set<string>
  seek(ms: number): void
  totalMs: number
  transitionSegments: StoryTransitionSegment[]
  videoRefs: Map<string, RefObject<HTMLVideoElement | null>>
}

interface UseStorySequencerOptions {
  lipSyncPreviewOverrides?: Record<string, boolean>
  projectId: string
}

export function useStorySequencer({
  lipSyncPreviewOverrides,
  projectId,
}: UseStorySequencerOptions): UseStorySequencerResult {
  const { fetchApiDomain } = useApi()

  const { data: serverState } = useQuery<LongTakeEditorState>({
    queryKey: ['long-take-state', projectId],
    queryFn: async () => {
      const res = await fetchApiDomain<LongTakeEditorStateResponse>(
        `/api/long-take-videos/${projectId}/state`,
      )
      if (!res.ok) {
        throw new Error(res.error || 'Failed to fetch state')
      }
      return res.data.data
    },
  })

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [audioDurationMs, setAudioDurationMs] = useState(0)
  const [currentMs, setCurrentMs] = useState(0)
  const currentMsRef = useRef(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackIntent, setPlaybackIntent] = useState(false)
  const [readySet, setReadySet] = useState<Set<string>>(new Set())
  const [hasInitializedStartPosition, setHasInitializedStartPosition] = useState(false)

  const atomState = useAtomValue(longtakeHistoryStore.currentStateAtom)

  // The store owns the working state; before it initializes, fall back to the latest server state.
  const currentState = atomState ?? serverState

  const keyframeMap = useMemo(() => {
    const map: Record<string, { keyframeUrl: string; thumbnailUrl?: string }> = {}
    for (const kf of currentState?.keyframes ?? []) {
      map[kf.shotId] = { keyframeUrl: kf.keyframeUrl, thumbnailUrl: kf.thumbnailUrl ?? undefined }
    }
    return map
  }, [currentState?.keyframes])

  const segments = useMemo(
    () =>
      buildSegments(currentState?.transitions ?? [], keyframeMap, audioDurationMs, {
        lipSyncPreviewOverrides,
      }),
    [currentState?.transitions, keyframeMap, audioDurationMs, lipSyncPreviewOverrides],
  )

  const totalMs = audioDurationMs || (segments.length > 0 ? segments[segments.length - 1].endMs : 0)

  const transitionSegments = useMemo(
    () => segments.filter((s): s is StoryTransitionSegment => s.kind === 'transition'),
    [segments],
  )

  const keyframeSegments = useMemo(
    () => segments.filter((s): s is StoryKeyframeSegment => s.kind === 'keyframe'),
    [segments],
  )

  const [activeTransitionSegment, activeTransitionIndex] = useMemo(() => {
    return getSegmentAt(transitionSegments, currentMs)
  }, [transitionSegments, currentMs])

  const [activeKeyframeSegment, activeKeyframeIndex] = useMemo(() => {
    return getSegmentAt(keyframeSegments, currentMs)
  }, [keyframeSegments, currentMs])

  const videoRefsRef = useRef<Map<string, RefObject<HTMLVideoElement | null>>>(new Map())

  // Sync videoRefs entries with current transition segments during render
  // so refs are available for the first render pass
  const ids = new Set(transitionSegments.map((s) => s.transitionId))
  for (const id of videoRefsRef.current.keys()) {
    if (!ids.has(id)) {
      videoRefsRef.current.delete(id)
    }
  }
  for (const id of ids) {
    if (!videoRefsRef.current.has(id)) {
      videoRefsRef.current.set(id, createRef<HTMLVideoElement | null>())
    }
  }

  // Stable reference to the map
  const videoRefs = videoRefsRef.current

  const activeWindow = useMemo(() => {
    const center = Math.max(0, activeTransitionIndex)
    const lo = Math.max(0, center - MOUNT_WINDOW)
    const hi = Math.min(transitionSegments.length - 1, center + MOUNT_WINDOW)
    const mountedTransitionIds = new Set<string>()
    for (let i = lo; i <= hi; i++) {
      mountedTransitionIds.add(transitionSegments[i].transitionId)
    }
    return {
      mountedTransitionIds,
      preloadedTransitionIds: computePreloadedTransitionIds(
        transitionSegments.map((s) => s.transitionId),
        activeTransitionIndex,
      ),
      primeTargets: getActivePreloadTargets(
        transitionSegments,
        activeTransitionIndex,
        activeTransitionSegment,
      ),
    }
  }, [activeTransitionIndex, activeTransitionSegment, transitionSegments])

  useDraftSaveConflictToast()

  const initializeHistory = useSetAtom(longtakeHistoryStore.initializeHistoryAtom)
  const primedTransitionUrisRef = useRef<Record<string, string>>({})

  // Initialize on first load - ref guard prevents re-init on cache invalidation
  const historyInitializedRef = useRef(false)
  useEffect(() => {
    if (!serverState || historyInitializedRef.current) {
      return
    }
    historyInitializedRef.current = true
    initializeHistory({ currentState: serverState, fetchApiDomain, projectId })
  }, [serverState, projectId, initializeHistory, fetchApiDomain])

  // Flush any debounced draft save on unmount so the trailing edit is not lost.
  useEffect(() => () => longtakeHistoryStore.flushPendingDraftSave(), [])

  useEffect(() => {
    if (hasInitializedStartPosition || transitionSegments.length === 0) {
      return
    }

    const firstTransition = transitionSegments[0]
    seekAudioToMs(audioRef, firstTransition.startMs)
    setCurrentMs(firstTransition.startMs)
    setHasInitializedStartPosition(true)
  }, [hasInitializedStartPosition, transitionSegments])

  // Remove stale readySet entries when transitions leave the mount window,
  // so re-mounted elements aren't mistakenly shown as buffered.
  const prevMountedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    const prev = prevMountedRef.current
    const removed = [...prev].filter((id) => !activeWindow.mountedTransitionIds.has(id))
    if (removed.length > 0) {
      setReadySet((r) => {
        const next = new Set(r)
        for (const id of removed) {
          next.delete(id)
        }
        return next
      })
    }
    prevMountedRef.current = activeWindow.mountedTransitionIds
  }, [activeWindow.mountedTransitionIds])

  const isWaitingForTransition =
    !!activeTransitionSegment && !readySet.has(activeTransitionSegment.transitionId)
  const isActiveTransitionReady =
    !!activeTransitionSegment && readySet.has(activeTransitionSegment.transitionId)
  const isBuffering = playbackIntent && isWaitingForTransition

  // Pause the audio clock while a transition video buffers; resume when ready.
  const pausedForBufferRef = useRef(false)
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }
    if (isBuffering && !audio.paused) {
      audio.pause()
      pausedForBufferRef.current = true
    } else if (!isBuffering && pausedForBufferRef.current) {
      pausedForBufferRef.current = false
      audio.play().catch(() => void 0)
    }
  }, [isBuffering])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }
    const onTimeUpdate = () => {
      const ms = audio.currentTime * 1000
      currentMsRef.current = ms
      setCurrentMs(ms)
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onLoadedMetadata = () => setAudioDurationMs(audio.duration * 1000)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)
    return () => {
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
    }
  }, [])

  const markReady = useRefCallback((transitionId: string) => {
    setReadySet((r) => (r.has(transitionId) ? r : new Set(r).add(transitionId)))
  })

  useEffect(() => {
    const cleanups: Array<() => void> = []
    for (const [id, ref] of videoRefs) {
      if (!activeWindow.mountedTransitionIds.has(id)) {
        continue
      }
      const el = ref.current
      if (!el) {
        continue
      }
      const onReady = () => markReady(id)
      el.addEventListener('canplay', onReady)
      if (el.readyState >= READY_STATE_FUTURE_DATA) {
        markReady(id)
      }
      cleanups.push(() => el.removeEventListener('canplay', onReady))
    }
    return () => cleanups.forEach((fn) => fn())
  }, [activeWindow.mountedTransitionIds, markReady, videoRefs])

  useEffect(() => {
    if (activeTransitionSegment?.kind !== 'transition') {
      return
    }
    const video = videoRefs.get(activeTransitionSegment.transitionId)?.current
    if (!video) {
      return
    }
    syncActiveTransitionVideo(video, activeTransitionSegment, currentMsRef.current, isPlaying)
  }, [activeTransitionSegment, isPlaying, videoRefs])

  useEffect(() => {
    for (const segment of activeWindow.primeTargets) {
      const video = videoRefs.get(segment.transitionId)?.current
      if (!video) {
        continue
      }
      const prevUri = primedTransitionUrisRef.current[segment.transitionId]
      primeTransitionVideo(video, segment.videoUri, prevUri)
      primedTransitionUrisRef.current[segment.transitionId] = segment.videoUri
      if (video.readyState >= READY_STATE_FUTURE_DATA) {
        markReady(segment.transitionId)
      }
    }
  }, [activeWindow.primeTargets, markReady, videoRefs])

  useEffect(() => {
    for (const [id, ref] of videoRefs) {
      if (
        activeTransitionSegment?.kind === 'transition' &&
        activeTransitionSegment.transitionId === id
      ) {
        continue
      }
      ref.current?.pause()
    }
  }, [activeTransitionSegment, videoRefs])

  // Detect transition output changes directly from working-state videoUris,
  // then clear readiness and jump to the first changed transition.
  const prevTransitionUrisRef = useRef<null | Record<string, string>>(null)
  useEffect(() => {
    const nextUris = Object.fromEntries(
      transitionSegments.map((segment) => [segment.transitionId, segment.videoUri]),
    )
    const prevUris = prevTransitionUrisRef.current

    if (!prevUris) {
      prevTransitionUrisRef.current = nextUris
      return
    }

    const changedIds = transitionSegments
      .filter((segment) => prevUris[segment.transitionId] !== segment.videoUri)
      .map((segment) => segment.transitionId)

    if (changedIds.length === 0) {
      prevTransitionUrisRef.current = nextUris
      return
    }

    setReadySet((r) => {
      const next = new Set(r)
      for (const id of changedIds) {
        next.delete(id)
      }
      return next
    })

    const firstChangedSegment = transitionSegments.find((segment) =>
      changedIds.includes(segment.transitionId),
    )
    if (firstChangedSegment) {
      seekAudioToMs(audioRef, firstChangedSegment.startMs)
      setCurrentMs(firstChangedSegment.startMs)
    }

    prevTransitionUrisRef.current = nextUris
  }, [transitionSegments])

  const play = useRefCallback(() => {
    setPlaybackIntent(true)
    audioRef.current?.play().catch(() => void 0)
  })

  const pause = useRefCallback(() => {
    pausedForBufferRef.current = false
    setPlaybackIntent(false)
    audioRef.current?.pause()
  })

  const seek = useRefCallback((ms: number) => {
    seekAudioToMs(audioRef, ms)
    currentMsRef.current = ms
    setCurrentMs(ms)
    // Effect won't fire if segment hasn't changed; sync the video directly here.
    if (activeTransitionSegment) {
      const video = videoRefs.get(activeTransitionSegment.transitionId)?.current
      if (video) {
        syncActiveTransitionVideo(video, activeTransitionSegment, ms, isPlaying)
      }
    }
  })

  return {
    activeKeyframeIndex,
    activeTransitionSegment,
    activeKeyframeSegment,
    transitionSegments,
    keyframeSegments,
    audioRef,
    currentMs,
    currentState,
    hasInitializedStartPosition,
    isActiveTransitionReady,
    isBuffering,
    isPlaying,
    mountedTransitionIds: activeWindow.mountedTransitionIds,
    pause,
    play,
    preloadedTransitionIds: activeWindow.preloadedTransitionIds,
    seek,
    totalMs,
    videoRefs,
  }
}

function getActivePreloadTargets(
  transitionSegments: StoryTransitionSegment[],
  activeTransitionIndex: number,
  activeTransitionSegment: null | StoryTransitionSegment,
): StoryTransitionSegment[] {
  return [
    activeTransitionSegment,
    activeTransitionIndex >= 0 ? transitionSegments[activeTransitionIndex + 1] : undefined,
  ].filter((segment): segment is StoryTransitionSegment => Boolean(segment))
}

function primeTransitionVideo(
  video: HTMLVideoElement,
  videoUri: string,
  previousVideoUri: string | undefined,
) {
  video.preload = 'auto'
  if (previousVideoUri !== videoUri || video.networkState === NETWORK_EMPTY) {
    video.load()
  }
}

function seekAudioToMs(audioRef: RefObject<HTMLAudioElement | null>, ms: number) {
  if (audioRef.current) {
    audioRef.current.currentTime = ms / 1000
  }
}

function syncActiveTransitionVideo(
  video: HTMLVideoElement,
  segment: StoryTransitionSegment,
  currentMs: number,
  isPlaying: boolean,
) {
  const offsetSec = Math.max(0, (currentMs - segment.startMs) / 1000)
  if (Math.abs(video.currentTime - offsetSec) > 0.15) {
    video.currentTime = offsetSec
  }
  if (isPlaying && video.paused) {
    video.play().catch(() => void 0)
  } else if (!isPlaying && !video.paused) {
    video.pause()
  }
}
