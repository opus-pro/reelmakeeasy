import { ModuleName } from '../wasm/type'

export enum SnapshotImageType {
  Rgb,
  Rgba,
}

type Event = {
  audioDisappear: (moduleName: ModuleName) => void
  /** The engine's audio node is up (sniffed from its log; see audio-ready.ts). */
  audioReady: (moduleName: ModuleName) => void
  audioWav: (moduleName: ModuleName, data: Uint8Array, startMs: number, endMs: number) => void
  canPlayBack: (moduleName: ModuleName) => void
  costTimeParseJson: (moduleName: ModuleName, ms: number) => void
  costTimePreloadData: (moduleName: ModuleName, ms: number) => void
  costTimeRenderFirstFrame: (moduleName: ModuleName, ms: number) => void
  costTimeSeekFirstFrame: (moduleName: ModuleName, ms: number) => void
  coverImageExtract: (
    moduleName: ModuleName,
    rgb: Uint8Array,
    time: number,
    width: number,
    height: number,
  ) => void
  currentImageExtract: (
    moduleName: ModuleName,
    rgb: Uint8Array,
    time: number,
    width: number,
    height: number,
    type: SnapshotImageType,
  ) => void
  currentLayoutInfo: (
    moduleName: ModuleName,
    trackId: string,
    segId: string,
    wPct: number,
    hPct: number,
    xPct: number,
    yPct: number,
    rotation: number,
  ) => void
  dataCacheList: (moduleName: ModuleName, cacheList: string) => void
  decoderFail: (moduleName: ModuleName, json: string) => void
  destroyWindowSync: (moduleName: ModuleName) => void
  firstCaptionFrameEnd: (moduleName: ModuleName) => void
  firstFrameEnd: (moduleName: ModuleName) => void
  loadingEnd: (moduleName: ModuleName) => void
  loadingStart: (moduleName: ModuleName) => void
  playbackEnd: (moduleName: ModuleName) => void
  playStall: (moduleName: ModuleName, json: string) => void
  refreshEnd: (moduleName: ModuleName) => void
  rgbaSnapshot: (
    moduleName: ModuleName,
    data: Uint8Array,
    time: number,
    width: number,
    height: number,
  ) => void
  seekSync: (moduleName: ModuleName) => void
  templateLoaded: (moduleName: ModuleName) => void
  videoLoading: (moduleName: ModuleName) => void
  videoSnapshot: (
    moduleName: ModuleName,
    data: Uint8Array,
    time: number,
    width: number,
    height: number,
  ) => void
  videoTimeUpdate: (moduleName: ModuleName, progress: number) => void
}

const pubSub = {
  events: {} as Record<keyof Event, Array<Event[keyof Event]>>,
  on<T extends keyof Event>(eventName: T, fn: Event[T]) {
    this.events[eventName] = this.events[eventName] || []
    this.events[eventName].push(fn)
  },
  emit<T extends keyof Event>(eventName: T, ...data: Parameters<Event[T]>) {
    if (this.events[eventName]) {
      this.events[eventName].forEach((fn) => {
        // @ts-expect-error general case is not type
        fn(...data)
      })
    }
  },
  off<T extends keyof Event>(eventName: T, fn: Event[T]) {
    const fns = this.events[eventName]
    if (fns) {
      this.events[eventName] = fns.filter((v) => v !== fn)
    }
  },
}

// The wasm glue (AVEditorEngine) emits events by looking up window.pubSub, so the
// singleton is installed there on first access. This is a plain SDK-level event bus
// -- not React -- consumed both by the engine class (RenderMainEngine) and by the
// usePubSub hook; keep it out of any hook module so non-hook callers can use it.
export const getPubSub = () => {
  if (!window.pubSub) {
    window.pubSub = pubSub
  }
  return pubSub
}
