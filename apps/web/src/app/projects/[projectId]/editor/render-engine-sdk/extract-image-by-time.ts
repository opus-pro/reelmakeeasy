import { Engine } from '../wasm/type'

import { ExtractedFrame, extractFramesByTime } from './extract-frames-by-time'

// Extracts frames from a video URL at the given timestamps (ms) as RGB (3 bytes/px) buffers
// via engine.ExtractImageByTime + the 'videoSnapshot' event. NOTE: the engine downscales
// each frame to a quarter of the source dimensions (width/4 x height/4), so the returned
// width/height are those reduced dims and data.length === width * height * 3 -- a low-res
// thumbnail, not a full-resolution frame. (av-engine src/util/MediaParseUtil.cpp
// main_video_loop.) Batching, per-time matching, buffer copy and abort semantics live in
// extractFramesByTime; pass an AbortSignal to bound the wait (the wasm may emit fewer
// snapshots than requested).
export function extractImageByTime(
  engine: Engine,
  moduleName: string,
  url: string,
  times: number[],
  signal?: AbortSignal,
): Array<Promise<ExtractedFrame>> {
  return extractFramesByTime(
    'videoSnapshot',
    moduleName,
    times,
    () => engine.ExtractImageByTime(url, times),
    signal,
  )
}
