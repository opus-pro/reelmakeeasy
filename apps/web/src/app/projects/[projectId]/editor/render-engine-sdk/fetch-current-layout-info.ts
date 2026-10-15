import { Engine } from '../wasm/type'

import { awaitTimelineResult } from './await-timeline-result'
import { getPubSub } from './pub-sub'

// Geometry of a track's current segment: size/position as percentages of the canvas plus
// rotation. Used to place UI overlays (drag/resize/rotate handles) -- NOT pixel data.
export type CurrentLayoutInfo = {
  hPct: number
  rotation: number
  segId: string
  trackId: string
  wPct: number
  xPct: number
  yPct: number
}

// Fetches the layout of the current-time segment on a timeline track (identified by its
// track index, as a string) via engine.FetchCurrentLayoutInfo + the 'currentLayoutInfo'
// event. `handle` is the timeline pointer. Resolves on the first 'currentLayoutInfo' for
// this module; the event carries no request id, so serialize concurrent calls on the same
// engine. Pass a signal to bound the wait -- the wasm emits nothing when the timeline is
// empty or the engine is not running.
export function fetchCurrentLayoutInfo(
  engine: Engine,
  moduleName: string,
  handle: number,
  index: string,
  signal?: AbortSignal,
): Promise<CurrentLayoutInfo> {
  const pubSub = getPubSub()
  return awaitTimelineResult<CurrentLayoutInfo>(
    (resolve) => {
      const onInfo = (
        infoModuleName: string,
        trackId: string,
        segId: string,
        wPct: number,
        hPct: number,
        xPct: number,
        yPct: number,
        rotation: number,
      ) => {
        if (infoModuleName !== moduleName) {
          return
        }
        resolve({ hPct, rotation, segId, trackId, wPct, xPct, yPct })
      }
      pubSub.on('currentLayoutInfo', onInfo)
      return () => pubSub.off('currentLayoutInfo', onInfo)
    },
    () => engine.FetchCurrentLayoutInfo(handle, index),
    signal,
  )
}
