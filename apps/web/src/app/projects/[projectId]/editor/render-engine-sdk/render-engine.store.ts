import { RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import { createMapFn } from '@reelmakeeasy/common/utils/memo-fn'
import { atom } from 'jotai'
import { selectAtom } from 'jotai/utils'

export type EngineActions = {
  playOrPause: (play: boolean, loop?: boolean) => void
  refresh: (renderPlan: RenderPlan, diff?: boolean) => void
  seek: (ms: number) => void
}

export type RenderEngineStore = ReturnType<typeof createRenderEngineStore>

// Builds one independent bundle of atoms for a single engine instance. Each
// engine is keyed by its moduleName, so two instances never share state. The
// derived currentTimeWithLowFrequency is constructed per instance too - it just
// binds to that instance's own currentTime, so per-key construction is safe.
const createRenderEngineStore = (moduleName: string) => {
  const wasmLoaded = atom<boolean>(false)
  wasmLoaded.debugLabel = `render_engine.wasm_loaded.${moduleName}`

  const hardwareAccelerationUnavailable = atom<boolean>(false)
  hardwareAccelerationUnavailable.debugLabel = `render_engine.hardware_acceleration_unavailable.${moduleName}`

  const firstFrameEnd = atom<boolean>(false)
  firstFrameEnd.debugLabel = `render_engine.first_frame_end.${moduleName}`

  /** The engine's audio node is up, so a play has sound from its start. */
  const audioReady = atom<boolean>(false)
  audioReady.debugLabel = `render_engine.audio_ready.${moduleName}`

  const currentTime = atom<number>(0)
  currentTime.debugLabel = `render_engine.current_time.${moduleName}`

  const currentTimeWithLowFrequency = selectAtom(
    currentTime,
    (time) => Math.round(time / 1000) * 1000,
  )
  currentTimeWithLowFrequency.debugLabel = `render_engine.current_time_with_low_frequency.${moduleName}`

  const totalTime = atom<number>(0)
  totalTime.debugLabel = `render_engine.total_time.${moduleName}`

  const playbackCompleted = atom<boolean>(false)
  playbackCompleted.debugLabel = `render_engine.playback_completed.${moduleName}`

  const engineActions = atom<EngineActions | undefined>(undefined)
  engineActions.debugLabel = `render_engine.engine_actions.${moduleName}`

  const videoLoading = atom<boolean>(false)
  videoLoading.debugLabel = `render_engine.video_loading.${moduleName}`

  return {
    wasmLoaded,
    hardwareAccelerationUnavailable,
    firstFrameEnd,
    audioReady,
    currentTime,
    currentTimeWithLowFrequency,
    totalTime,
    playbackCompleted,
    engineActions,
    videoLoading,
  }
}

/**
 * Returns the atom bundle for a given engine instance, memoized by moduleName.
 * The same moduleName always yields the same store; a new moduleName lazily
 * creates an isolated one. Drop an entry via `getRenderEngineStore.map.delete`
 * when an engine is destroyed to avoid unbounded growth with dynamic ids.
 */
export const getRenderEngineStore = createMapFn(createRenderEngineStore)
