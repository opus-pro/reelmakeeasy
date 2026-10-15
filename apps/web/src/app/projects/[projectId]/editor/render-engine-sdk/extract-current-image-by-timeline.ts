import { Engine } from '../wasm/type'

import { awaitTimelineResult } from './await-timeline-result'
import { ExtractedFrame } from './extract-frames-by-time'
import { getPubSub, SnapshotImageType } from './pub-sub'

// A current-frame extract plus its channel layout (RGB or RGBA per `type`).
export type CurrentImageFrame = ExtractedFrame & { type: SnapshotImageType }

// Extracts the current-time frame of a single timeline track (identified by its track
// index, as a string) via engine.ExtractCurrentImageByTimeline + the
// 'currentImageExtract' event. `handle` is the timeline pointer. The result is the RAW
// frame of that track's active video/image segment -- NOT the composited timeline output
// (use extractCoverImageByTimeline for the full render). Channel count follows `type`, so
// data.length === width * height * (type === Rgba ? 4 : 3); data is copied out of the wasm
// heap. Resolves on the first 'currentImageExtract' for this module; the event carries no
// track id, so serialize concurrent calls on the same engine. Pass a signal to bound the
// wait -- the wasm emits nothing when the track/timeline is empty or the engine is not
// running.
export function extractCurrentImageByTimeline(
  engine: Engine,
  moduleName: string,
  handle: number,
  index: string,
  signal?: AbortSignal,
): Promise<CurrentImageFrame> {
  const pubSub = getPubSub()
  return awaitTimelineResult<CurrentImageFrame>(
    (resolve) => {
      const onExtract = (
        snapshotModuleName: string,
        data: Uint8Array,
        time: number,
        width: number,
        height: number,
        type: SnapshotImageType,
      ) => {
        if (snapshotModuleName !== moduleName) {
          return
        }
        resolve({ data: data.slice(), height, time, type, width })
      }
      pubSub.on('currentImageExtract', onExtract)
      return () => pubSub.off('currentImageExtract', onExtract)
    },
    () => engine.ExtractCurrentImageByTimeline(handle, index),
    signal,
  )
}
