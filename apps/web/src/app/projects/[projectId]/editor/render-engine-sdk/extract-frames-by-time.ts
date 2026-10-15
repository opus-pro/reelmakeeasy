import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

import { getPubSub } from './pub-sub'

// One extracted frame: a pixel buffer (copied out of the wasm heap) plus its timestamp
// (ms) and dimensions. Channel count and resolution depend on the extractor -- see
// extractImageByTime (RGB, quarter-res) and extractRgbaByTime (RGBA, alpha kept).
export type ExtractedFrame = {
  data: Uint8Array
  height: number
  time: number
  width: number
}

// Shared batch core for the URL-based frame extractors. The engine streams results back as
// pubSub snapshot events -- 'videoSnapshot' (RGB) or 'rgbaSnapshot' (RGBA) -- which share
// the identical (moduleName, buffer, time, width, height) shape. Returns one promise per
// requested time (aligned to the input array), resolved as its frame arrives. `trigger`
// invokes the engine call (capturing the url and any extra args) after the listener is
// attached.
//
// All engine instances share the one global pubSub, so snapshots are first filtered to
// moduleName, then matched to their requested time by the emitted time value; the C++ echoes
// the requested time back verbatim, so the match is exact by construction and independent of
// emission order. A per-time FIFO queue handles duplicate requested times, and a snapshot for
// an unrequested time is ignored. The emitted buffer is a live view into
// window[moduleName].HEAPU8 (reused on the next emit), so it is copied synchronously here.
//
// A signal is effectively REQUIRED, not just defensive: the C++ can emit FEWER snapshots than
// requested (a decoder-init failure emits none; an EOF/decode error mid-batch stops the loop
// so every later time gets none), leaving those promises pending and the listener attached
// forever. Pass a signal to bound it -- e.g. AbortSignal.timeout(30_000), or
// AbortSignal.any([owner, AbortSignal.timeout(ms)]). On abort the still-pending promises
// reject with the signal's reason and the listener is removed. CAVEAT: abort is JS-side only
// -- it stops us waiting but does NOT cancel the wasm decode, which always runs the batch to
// completion/EOF on its render thread. The events carry no url, so concurrent calls on the
// SAME engine interleave; serialize them.
export function extractFramesByTime(
  event: 'rgbaSnapshot' | 'videoSnapshot',
  moduleName: string,
  times: number[],
  trigger: () => void,
  signal?: AbortSignal,
): Array<Promise<ExtractedFrame>> {
  if (times.length === 0) {
    return []
  }
  const pubSub = getPubSub()
  // Queue of waiting resolvers per requested time (FIFO handles duplicate times).
  const waitersByTime = new Map<number, Array<(frame: ExtractedFrame) => void>>()
  const rejecters: Array<(reason: unknown) => void> = []
  const promises = times.map(
    (time) =>
      new Promise<ExtractedFrame>((resolve, reject) => {
        const queue = waitersByTime.get(time)
        if (queue) {
          queue.push(resolve)
        } else {
          waitersByTime.set(time, [resolve])
        }
        rejecters.push(reject)
      }),
  )

  let remaining = times.length
  const onSnapshot = (
    snapshotModuleName: string,
    data: Uint8Array,
    time: number,
    width: number,
    height: number,
  ) => {
    // Ignore snapshots produced by other engine instances on the shared pubSub.
    if (snapshotModuleName !== moduleName) {
      return
    }
    const queue = waitersByTime.get(time)
    const resolve = queue?.shift()
    // Snapshot for a time we did not request (or already fulfilled): ignore it.
    if (!resolve) {
      return
    }
    if (queue?.length === 0) {
      waitersByTime.delete(time)
    }
    // data views wasm HEAPU8 and is reused on the next emit; copy it now.
    resolve({ data: data.slice(), height, time, width })
    remaining -= 1
    if (remaining <= 0) {
      cleanup()
    }
  }
  const onAbort = () => {
    cleanup()
    rejectAll(signal?.reason)
  }
  const cleanup = () => {
    pubSub.off(event, onSnapshot)
    signal?.removeEventListener('abort', onAbort)
  }
  // Reject every deferred; already-resolved ones ignore it (settle-once).
  const rejectAll = (reason: unknown) => {
    for (const reject of rejecters) {
      reject(reason)
    }
  }

  // Already aborted before we start: reject everything, never touch the engine.
  if (signal?.aborted) {
    rejectAll(signal.reason)
    return promises
  }

  signal?.addEventListener('abort', onAbort)
  pubSub.on(event, onSnapshot)
  try {
    trigger()
  } catch (error) {
    cleanup()
    rejectAll(ensureError(error))
  }
  return promises
}
