import { RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import { useAsyncEffect, useDeepCompareEffect, useMount, useUnmount } from 'ahooks'
import { useAtom, useSetAtom } from 'jotai'
import { useEffect, useRef } from 'react'

import { useRefCallback } from '@/hooks/use-ref-callback'

import { getMediaDataManager } from '../utils/media-data-manager'
import { ModuleName } from '../wasm/type'

import { getPubSub } from './pub-sub'
import { RenderMainEngine } from './render-engine'
import { EngineActions, getRenderEngineStore } from './render-engine.store'

export type RenderEngineParams = {
  createOptions?: {
    audioDriver: boolean
    enableWebcodec: boolean
    prefetchAllBeforePlay?: boolean
    prefetchFirstBytes?: number
  }
  // Pass a distinct dataManagerName only when this instance needs its own
  // cache/clear lifecycle; otherwise instances share the default 'mediaDataManager'.
  dataManagerName?: string
  // Opt-in: destroy the engine (and drop its store) on unmount instead of only pausing
  // it. For callers that mount engines dynamically (the agent page's previews); the
  // editor keeps its engine for the life of the document.
  destroyOnUnmount?: boolean
  // Unique id for this engine instance. window.pubSub is a single global bus, so
  // every event carries its moduleName and each instance only handles its own.
  moduleName: string
  onWasmLoaded?: () => void
  renderPlan?: RenderPlan
  videoCanvasId: string
}

export type RenderEngineResult = {
  audioReady: boolean
  currentTime: number
  hardwareAccelerationUnavailable: boolean
  playbackCompleted: boolean
  readyForPlay: boolean
}

export type UseRenderEngineHook = (params: RenderEngineParams) => RenderEngineResult

interface CacheInfo {
  end: number
  start: number
  url: string
}

export const useRenderEngine: UseRenderEngineHook = ({
  videoCanvasId,
  moduleName,
  dataManagerName = 'mediaDataManager',
  destroyOnUnmount = false,
  createOptions,
  renderPlan,
}) => {
  const store = getRenderEngineStore(moduleName)
  const engineRef = useRef<null | RenderMainEngine>(null)
  const [wasmLoaded, setWasmLoaded] = useAtom(store.wasmLoaded)
  const [hardwareAccelerationUnavailable, setHardwareAccelerationUnavailable] = useAtom(
    store.hardwareAccelerationUnavailable,
  )
  const [firstFrameEnd, setFirstFrameEnd] = useAtom(store.firstFrameEnd)
  const [audioReady, setAudioReady] = useAtom(store.audioReady)
  const [totalTime, setTotalTime] = useAtom(store.totalTime)
  const [playbackCompleted, setPlaybackCompleted] = useAtom(store.playbackCompleted)
  const pubsub = getPubSub()
  const currentTimeRef = useRef(0)
  const setCurrentTime = useSetAtom(store.currentTime)
  const setActions = useSetAtom(store.engineActions)
  const [videoLoading, setVideoLoading] = useAtom(store.videoLoading)
  const { audioDriver = true, enableWebcodec = true } = createOptions ?? {}

  const mountedRef = useRef(false)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useMount(() => {
    if (!engineRef.current) {
      engineRef.current = new RenderMainEngine({
        videoCanvasId,
        moduleName,
        dataManagerName,
        prefetchAllBeforePlay: createOptions?.prefetchAllBeforePlay,
        prefetchFirstBytes: createOptions?.prefetchFirstBytes,
      })
      engineRef.current.eventManager.add('wasmLoaded', () => {
        setWasmLoaded(true)
      })
      engineRef.current.eventManager.add('hardwareAccelerationUnavailable', () => {
        setHardwareAccelerationUnavailable(true)
      })
      // The constructor's fire-and-forget init() may have already fired the event
      // above to zero listeners, so seed the atom from the engine's already-computed
      // status to close that race.
      if (engineRef.current.getHardwareAccelerationStatus()?.supported === false) {
        setHardwareAccelerationUnavailable(true)
      }
    }
  })

  useUnmount(() => {
    engineRef.current?.pause()
    if (destroyOnUnmount) {
      engineRef.current?.destroy()
      engineRef.current = null
    }
    setWasmLoaded(false)
    setHardwareAccelerationUnavailable(false)
    setPlaybackCompleted(false)
    setFirstFrameEnd(false)
    // A kept engine keeps its audio node (the line is logged once), so only a destroyed
    // engine starts over.
    if (destroyOnUnmount) setAudioReady(false)
    setCurrentTime(0)
    setVideoLoading(false)
    if (destroyOnUnmount) {
      // Deferred: a StrictMode re-mount runs right after this cleanup and keeps using
      // the same store, so only drop it when the hook really went away.
      window.setTimeout(() => {
        if (!mountedRef.current) {
          getRenderEngineStore.map.delete(moduleName)
        }
      }, 0)
    }
  })

  useAsyncEffect(async () => {
    if (renderPlan && wasmLoaded) {
      await engineRef.current?.create(renderPlan, {
        audioDriver,
        enableWebcodec,
      })
    }
  }, [renderPlan, wasmLoaded, audioDriver, enableWebcodec])

  const seek = useRefCallback((time: number) => {
    if (!engineRef.current) {
      return
    }
    setPlaybackCompleted(false)
    engineRef.current.seek(time)
    setCurrentTime(time)
  })

  // A pause asked for while the engine is loading is applied once it has loaded, so a
  // player told to stop (another one started) doesn't go on to play.
  const pendingPauseRef = useRef(false)

  const playOrPause = useRefCallback((play: boolean, loop = false) => {
    if (!engineRef.current) {
      return
    }
    if (videoLoading) {
      if (!play) {
        pendingPauseRef.current = true
      }
      return
    }
    pendingPauseRef.current = false
    if (play) {
      setPlaybackCompleted(false)
      engineRef.current.play(loop)
    } else {
      engineRef.current.pause()
    }
  })

  const refresh = useRefCallback((renderPlan: RenderPlan, diff?: boolean) => {
    if (!engineRef.current) {
      return
    }
    setPlaybackCompleted(false)
    if (diff) {
      engineRef.current.refreshDiff(renderPlan)
    } else {
      engineRef.current.refresh(renderPlan)
    }
  })

  useEffect(() => {
    if (!engineRef.current) {
      return
    }
    const actions: EngineActions = {
      seek,
      playOrPause,
      refresh,
    }
    setActions(actions)
    return () => setActions(undefined)
  }, [setActions, seek, playOrPause, refresh])

  useEffect(() => {
    const totalTime =
      renderPlan?.tracks.reduce((result, curr) => {
        if (!curr) {
          return result
        }
        return Math.max(result, curr.segs.at(-1)?.out ?? 0)
      }, 0) ?? 1
    setPlaybackCompleted(false)
    setTotalTime(totalTime)
  }, [renderPlan, setPlaybackCompleted, setTotalTime])

  const handleUpdateTime = useRefCallback((name: ModuleName, progress: number) => {
    if (name !== moduleName) {
      return
    }
    const time = Number(((totalTime * (progress || 0)) / 100).toFixed(0))
    currentTimeRef.current = time
    setCurrentTime(time)
  })

  const handleFirstFrameEnd = useRefCallback((name: ModuleName) => {
    if (name !== moduleName) {
      return
    }
    setFirstFrameEnd(true)
  })

  const handleAudioReady = useRefCallback((name: ModuleName) => {
    if (name === moduleName) setAudioReady(true)
  })

  const handlePlaybackEnd = useRefCallback((name: ModuleName) => {
    if (name !== moduleName) {
      return
    }
    currentTimeRef.current = totalTime
    setCurrentTime(totalTime)
    setPlaybackCompleted(true)
  })

  const handleCacheDataList = useRefCallback(async (name: ModuleName, cache: string) => {
    if (name !== moduleName) {
      return
    }
    const cacheList = JSON.parse(cache)?.dataInfoList as Array<CacheInfo>
    if (!cacheList || cacheList.length === 0) {
      return
    }
    const items = cacheList
      .filter((item) => item.url && item.url.startsWith('http'))
      .map((item, index) => ({
        ...item,
        priority: 500 + index,
        isTimeRange: false,
      }))
    await getMediaDataManager(dataManagerName).enqueue(items)
  })

  const handleVideoLoadingStart = useRefCallback((name: ModuleName) => {
    if (name !== moduleName) {
      return
    }
    setVideoLoading(true)
  })

  const handleVideoLoadingEnd = useRefCallback((name: ModuleName) => {
    if (name !== moduleName) {
      return
    }
    setVideoLoading(false)
    if (pendingPauseRef.current) {
      pendingPauseRef.current = false
      engineRef.current?.pause()
    }
  })

  useEffect(() => {
    pubsub.on('videoTimeUpdate', handleUpdateTime)
    pubsub.on('firstFrameEnd', handleFirstFrameEnd)
    pubsub.on('audioReady', handleAudioReady)
    pubsub.on('playbackEnd', handlePlaybackEnd)
    pubsub.on('dataCacheList', handleCacheDataList)
    pubsub.on('loadingStart', handleVideoLoadingStart)
    pubsub.on('loadingEnd', handleVideoLoadingEnd)

    return () => {
      pubsub.off('videoTimeUpdate', handleUpdateTime)
      pubsub.off('firstFrameEnd', handleFirstFrameEnd)
      pubsub.off('audioReady', handleAudioReady)
      pubsub.off('playbackEnd', handlePlaybackEnd)
      pubsub.off('dataCacheList', handleCacheDataList)
      pubsub.off('loadingStart', handleVideoLoadingStart)
      pubsub.off('loadingEnd', handleVideoLoadingEnd)
    }
  }, [
    pubsub,
    totalTime,
    handleUpdateTime,
    handleFirstFrameEnd,
    handleAudioReady,
    handlePlaybackEnd,
    handleCacheDataList,
    handleVideoLoadingStart,
    handleVideoLoadingEnd,
  ])

  useDeepCompareEffect(() => {
    if (!engineRef.current || !renderPlan) {
      return
    }
    engineRef.current.refreshDiff(renderPlan)
  }, [renderPlan])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        engineRef.current &&
        firstFrameEnd &&
        renderPlan
      ) {
        // Seek to current time to force a redraw of the current frame
        // This fixes the black screen issue caused by WebGL context loss or buffer clearing
        engineRef.current.seek(currentTimeRef.current)
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [firstFrameEnd, renderPlan])

  return {
    /** The engine's audio is up: a play now has sound from its start. */
    audioReady,
    currentTime: currentTimeRef.current,
    hardwareAccelerationUnavailable,
    playbackCompleted,
    readyForPlay: firstFrameEnd,
  }
}
