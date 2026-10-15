import { Engine } from '../wasm/type'

import { awaitTimelineResult } from './await-timeline-result'
import { ExtractedFrame } from './extract-frames-by-time'
import { getPubSub } from './pub-sub'

// Renders the whole COMPOSITED timeline (all tracks + effects) at `timestamp` (ms) and
// returns it as a low-res RGBA cover/thumbnail via engine.ExtractCoverImageByTimeline +
// the 'coverImageExtract' event. `handle` is the timeline pointer. The engine downscales
// to ~1/4 of the output resolution, so this is a thumbnail, not a full-res frame;
// data.length === width * height * 4 (the reduced dims), copied out of the wasm heap.
// NOTE: the engine seeks to `timestamp`, renders, then seeks back to the playhead, which
// briefly disrupts in-progress playback. Resolves on the matching 'coverImageExtract'
// (filtered by module and by the echoed time, so cover requests at different timestamps do
// not cross). Pass a signal to bound the wait -- the wasm emits nothing when the timeline
// is empty or the engine is not running.
export function extractCoverImageByTimeline(
  engine: Engine,
  moduleName: string,
  handle: number,
  timestamp: number,
  signal?: AbortSignal,
): Promise<ExtractedFrame> {
  const pubSub = getPubSub()
  return awaitTimelineResult<ExtractedFrame>(
    (resolve) => {
      const onExtract = (
        snapshotModuleName: string,
        data: Uint8Array,
        time: number,
        width: number,
        height: number,
      ) => {
        if (snapshotModuleName !== moduleName || time !== timestamp) {
          return
        }
        resolve({ data: data.slice(), height, time, width })
      }
      pubSub.on('coverImageExtract', onExtract)
      return () => pubSub.off('coverImageExtract', onExtract)
    },
    () => engine.ExtractCoverImageByTimeline(handle, timestamp),
    signal,
  )
}
