import { Engine } from '../wasm/type'

import { ExtractedFrame, extractFramesByTime } from './extract-frames-by-time'

// RGBA sibling of extractImageByTime: keeps the alpha channel (4 bytes/px) via
// engine.ExtractRGBAByTime + the 'rgbaSnapshot' event, so data.length === width * height * 4.
// `context` is forwarded to the engine (it routes the decode to that canvas/context) but is
// NOT echoed back, so results are matched by moduleName + requested time. Batching, matching,
// buffer copy and abort semantics live in extractFramesByTime; pass an AbortSignal to bound
// the wait, and serialize concurrent calls on the same engine (the event carries no url).
export function extractRgbaByTime(
  engine: Engine,
  moduleName: string,
  url: string,
  times: number[],
  context: string,
  signal?: AbortSignal,
): Array<Promise<ExtractedFrame>> {
  return extractFramesByTime(
    'rgbaSnapshot',
    moduleName,
    times,
    () => engine.ExtractRGBAByTime(url, times, context),
    signal,
  )
}
