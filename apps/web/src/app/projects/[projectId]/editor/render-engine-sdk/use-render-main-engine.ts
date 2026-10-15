import { RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'

import { useRenderEngine } from './use-render-engine'

export type RenderMainEngineParams = {
  createOptions?: {
    audioDriver: boolean
    enableWebcodec: boolean
    prefetchAllBeforePlay?: boolean
    prefetchFirstBytes?: number
  }
  onWasmLoaded?: () => void
  renderPlan?: RenderPlan
  videoCanvasId: string
}

export type RenderMainEngineResult = {
  currentTime: number
  hardwareAccelerationUnavailable: boolean
  playbackCompleted: boolean
  readyForPlay: boolean
}

export type UseRenderMainEngineHook = (params: RenderMainEngineParams) => RenderMainEngineResult

// The main editor is just the 'Module' instance of the generalized hook. This
// thin wrapper preserves the existing API/behavior for all current callers while
// the multi-instance logic lives once in useRenderEngine.
export const useRenderMainEngine: UseRenderMainEngineHook = (params) =>
  useRenderEngine({ ...params, moduleName: 'Module' })
