import { PlanDiff, RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Logger } from '@reelmakeeasy/common/utils/logger'

import { getWasmBlob } from '../utils/get-wasm-blob'
import { getMediaDataManager } from '../utils/media-data-manager'
import RenderEngine from '../wasm/AVEditorEngine'
import { Engine, ModuleName } from '../wasm/type'

import { isAudioReadyLine } from './audio-ready'
import { scheduleAudioWorkletWarmup } from './audio-worklet-warmup'
import { ensureCrossOriginIsolated } from './cross-origin-isolation'
import {
  detectHardwareAcceleration,
  HardwareAccelerationStatus,
} from './detect-hardware-acceleration'
import { toEnginePlanJson } from './engine-plan-json'
import { extractCoverImageByTimeline } from './extract-cover-image-by-timeline'
import {
  CurrentImageFrame,
  extractCurrentImageByTimeline,
} from './extract-current-image-by-timeline'
import { ExtractedFrame } from './extract-frames-by-time'
import { extractImageByTime } from './extract-image-by-time'
import { extractRgbaByTime } from './extract-rgba-by-time'
import { CurrentLayoutInfo, fetchCurrentLayoutInfo } from './fetch-current-layout-info'
import { getRenderPlanDiff, isEmptyPlanDiff } from './getRenderPlanDiff'
import { getPubSub } from './pub-sub'

// EM_ASM callbacks compiled into the wasm glue look an engine (and its data
// manager) up by name on the global object - e.g. window[moduleName].HEAPU8 -
// so each instance must register itself there under its own name. Window has no
// index signature, hence this localized cast instead of widening the global type.
const globalRegistry = () => window as unknown as Record<string, unknown>

/** The data manager every engine uses unless given its own (see the constructor). */
const SHARED_DATA_MANAGER_NAME = 'mediaDataManager'

const nsLogger = Logger.get('project.render-engine')
const avLogger = Logger.get('project.render-engine.AVEditorEngine', 'AVEditorEngine')

export type EventCallback = (event: EventType) => void

export interface EventListener {
  callback: EventCallback
  type: EventType
}

export type EventListenerMap = Map<EventType, EventCallback[]>

export type EventType =
  | 'hardwareAccelerationUnavailable'
  | 'templateLoaded'
  | 'timeUpdate'
  | 'wasmLoaded'

export type RenderEngineCallback = (url: string) => void

export type RenderMainEngineParams = {
  videoCanvasId: string
}

class EventManager {
  private listeners: EventListenerMap = new Map()

  constructor(private debugName: string) {
    this.listeners = new Map()
  }

  // Adds a listener
  public add(type: EventType, callback: EventCallback): void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, [])
    }
    this.listeners.get(type)?.push(callback)
  }

  // Fires an event
  public fire(type: EventType): void {
    const eventListeners = this.getListeners(type)
    eventListeners.forEach((cb) => cb(type))
  }

  // Removes a listener
  public remove(type: EventType, callback: EventCallback): void {
    if (this.listeners.has(type)) {
      this.listeners.get(type)?.filter((cb) => cb !== callback)
    }
  }

  /**
   * Clears all listeners of specified type, or every listener if no type is
   * specified
   * @param type the type of listeners to clear, or all listeners if not
   * specified
   */
  public removeAll(type?: EventType) {
    if (type) {
      this.listeners.delete(type)
    } else {
      this.listeners.clear()
    }
  }

  // Gets listeners of specified type
  private getListeners(type: EventType): EventCallback[] {
    return this.listeners.get(type) ?? []
  }
}

export class RenderMainEngine {
  private static prefetchVideoHeaderRange = [0, 2097150]

  // Event management (composition over inheritance)
  public eventManager: EventManager
  get totalTime() {
    return (
      this.renderPlan?.tracks.reduce((result, curr) => {
        if (!curr) {
          return result
        }
        return Math.max(result, curr.segs.at(-1)?.out ?? 0)
      }, 0) ?? 1
    )
  }
  private createPromise: Promise<void> | undefined
  private dataManagerName: string
  // Set by destroy(): an init() still loading the wasm must not register the engine.
  private destroyed = false
  private engine: Engine | undefined

  // Set once the engine has rendered its first frame (signalled per module on the
  // shared pubSub). Before this, the wasm Reload drops any RefreshRenderPlan(Diff),
  // so refreshes are held in pendingRefresh until it flips true. See doCreate.
  private firstFrameReady = false
  private handler: number | undefined

  private hardwareAccelerationStatus: HardwareAccelerationStatus | undefined

  // Instance identity. Defaults keep the single-instance editor byte-for-byte
  // unchanged; multi-instance callers pass a unique moduleName (and, only when
  // they need an isolated cache/clear lifecycle, a distinct dataManagerName).
  private moduleName: string

  private pendingRefresh: RenderPlan | undefined

  private renderPlan: RenderPlan | undefined

  private videoCanvasId: string
  constructor({
    videoCanvasId,
    moduleName = 'Module',
    dataManagerName = 'mediaDataManager',
  }: {
    dataManagerName?: string
    moduleName?: string
    prefetchAllBeforePlay?: boolean
    prefetchFirstBytes?: number
    videoCanvasId: string
  }) {
    this.videoCanvasId = videoCanvasId
    this.moduleName = moduleName
    this.dataManagerName = dataManagerName
    this.eventManager = new EventManager('RenderMainEngine')
    getPubSub().on('firstFrameEnd', this.handleFirstFrameEnd)
    this.init()
  }

  public async create(
    renderPlan: RenderPlan,
    options: {
      audioDriver: boolean
      enableWebcodec: boolean
    },
  ) {
    // Single-flight: concurrent create() calls coalesce; latest renderPlan becomes
    // pendingRefresh and is flushed once the engine's first frame is ready (see
    // flushPendingRefresh / handleFirstFrameEnd). Two concurrent CreateEditorEngine
    // calls would corrupt wasm memory (RuntimeError: memory access out of bounds).
    if (this.createPromise) {
      this.pendingRefresh = renderPlan
      return this.createPromise
    }
    if (!this.engine || !renderPlan || this.handler || this.destroyed) {
      return
    }

    // Discard pendingRefresh stranded by a prior failed doCreate; this
    // renderPlan is the latest source of truth for the new lifecycle.
    this.pendingRefresh = undefined
    this.createPromise = this.doCreate(renderPlan, options)
    try {
      await this.createPromise
    } finally {
      this.createPromise = undefined
    }
    // A refresh() that arrives after the first frame is ready but before this line
    // clears createPromise still defers (createPromise gate), and handleFirstFrameEnd
    // has already fired, so nothing else would flush it. No-op if the first frame has
    // not rendered yet -- handleFirstFrameEnd will flush then.
    this.flushPendingRefresh()
  }

  /**
   * Cleanup all resources - cancel pending requests and debounced operations.
   */
  public destroy() {
    this.destroyed = true
    if (this.createPromise) {
      // Tearing the engine down while CreateEditorEngine/StartEditorEngine is suspended
      // would corrupt the wasm stack (see create()): finish creating first.
      void this.createPromise.then(
        () => this.destroy(),
        () => this.destroy(),
      )
      return
    }
    // The data manager's destroy() flushes its persist but also aborts every queued
    // request, so the shared default one (other engines on the page may be loading
    // through it) is left alone; a manager of this instance's own is torn down. The
    // moduleName key is unique per instance, so deleting it is safe; the
    // dataManagerName key may be shared, so it is intentionally left in place.
    if (this.dataManagerName !== SHARED_DATA_MANAGER_NAME) {
      getMediaDataManager(this.dataManagerName).destroy()
    }
    getPubSub().off('firstFrameEnd', this.handleFirstFrameEnd)
    this.firstFrameReady = false
    this.eventManager.removeAll()
    this.pendingRefresh = undefined
    if (this.engine && this.handler) {
      try {
        this.engine.DestroyEditorEngine(this.handler)
      } catch (error) {
        nsLogger.error('Failed to destroy engine:', error)
      }
      this.handler = undefined
    }
    // Only after DestroyEditorEngine: its teardown may still call back into the glue,
    // which finds the engine by this name.
    delete globalRegistry()[this.moduleName]
  }

  // Renders the whole composited timeline at `timestamp` (ms) into a low-res RGBA cover
  // thumbnail. Requires a created engine (a live timeline handle). NOTE: the engine seeks
  // to `timestamp` and back, briefly disrupting playback. Pass a signal to bound the wait.
  public extractCoverImageByTimeline(
    timestamp: number,
    signal?: AbortSignal,
  ): Promise<ExtractedFrame> {
    if (!this.engine || this.handler === undefined) {
      return Promise.reject(new Error('Cannot extract cover image: engine not ready'))
    }
    return extractCoverImageByTimeline(
      this.engine,
      this.moduleName,
      this.handler,
      timestamp,
      signal,
    )
  }

  // Extracts the current-time raw frame of a single timeline track (by track index). This
  // is that track's segment frame, NOT the composited output. Requires a created engine.
  // Pass a signal to bound the wait.
  public extractCurrentImageByTimeline(
    index: string,
    signal?: AbortSignal,
  ): Promise<CurrentImageFrame> {
    if (!this.engine || this.handler === undefined) {
      return Promise.reject(new Error('Cannot extract current image: engine not ready'))
    }
    return extractCurrentImageByTimeline(this.engine, this.moduleName, this.handler, index, signal)
  }

  // Extracts frames from a video URL at the given timestamps (ms), returning one
  // promise per requested time. Rejects everything when the engine is not ready yet;
  // otherwise delegates to extract-image-by-time.ts, which owns the pubSub matching,
  // per-time queueing, and buffer-copy details. Pass an optional AbortSignal to bound
  // the wait (there is no built-in timeout); on abort the pending promises reject.
  public extractImageByTime(
    url: string,
    times: number[],
    signal?: AbortSignal,
  ): Array<Promise<ExtractedFrame>> {
    if (!this.engine) {
      return times.map(() => Promise.reject(new Error('Cannot extract image: engine not ready')))
    }
    return extractImageByTime(this.engine, this.moduleName, url, times, signal)
  }

  // RGBA sibling of extractImageByTime (keeps alpha, 4 bytes/px). `context` is forwarded
  // to the engine to route the decode; results stream back as 'rgbaSnapshot' events.
  // Rejects everything when the engine is not ready; otherwise delegates to
  // extract-rgba-by-time.ts. Pass an optional AbortSignal to bound the wait.
  public extractRgbaByTime(
    url: string,
    times: number[],
    context: string,
    signal?: AbortSignal,
  ): Array<Promise<ExtractedFrame>> {
    if (!this.engine) {
      return times.map(() => Promise.reject(new Error('Cannot extract RGBA: engine not ready')))
    }
    return extractRgbaByTime(this.engine, this.moduleName, url, times, context, signal)
  }

  // Fetches the geometry (size/position as canvas percentages + rotation) of a track's
  // current-time segment, for UI overlays. Requires a created engine. Pass a signal to
  // bound the wait.
  public fetchCurrentLayoutInfo(index: string, signal?: AbortSignal): Promise<CurrentLayoutInfo> {
    if (!this.engine || this.handler === undefined) {
      return Promise.reject(new Error('Cannot fetch layout info: engine not ready'))
    }
    return fetchCurrentLayoutInfo(this.engine, this.moduleName, this.handler, index, signal)
  }

  public getHardwareAccelerationStatus(): HardwareAccelerationStatus | undefined {
    return this.hardwareAccelerationStatus
  }

  public async init() {
    if (!ensureCrossOriginIsolated()) {
      return
    }

    this.hardwareAccelerationStatus = detectHardwareAcceleration()
    if (!this.hardwareAccelerationStatus.supported) {
      nsLogger.warn(
        'Hardware acceleration unavailable, skipping wasm init:',
        this.hardwareAccelerationStatus.renderer,
      )
      this.eventManager.fire('hardwareAccelerationUnavailable')
      return
    }

    try {
      const url = await RuntimeLoader.awaitResource()
      const dataManager = getMediaDataManager(this.dataManagerName)
      const [engine] = await Promise.all([
        (async () => {
          return await RenderEngine({
            print: (...args: unknown[]) => {
              avLogger.log(...args)
              // Autoplay waits for this: a play before it has no sound (audio-ready.ts).
              if (isAudioReadyLine(args[0])) {
                getPubSub().emit('audioReady', this.moduleName as ModuleName)
              }
            },
            printErr: avLogger.warn.bind(avLogger),
            locateFile: (filename: string) => {
              if (filename.includes('.worker.')) {
                return
              }
              return url
            },
          })
        })(),
        dataManager.init([]),
        // Uses up AudioWorklet threads that never load a module on some Chrome builds,
        // before the engine makes its own audio context (see audio-worklet-warmup.ts).
        scheduleAudioWorkletWarmup(),
      ])
      if (this.destroyed) {
        return
      }
      this.engine = engine
      globalRegistry()[this.moduleName] = engine
      globalRegistry()[this.dataManagerName] = dataManager
      nsLogger.info('RenderMainEngine initialized successfully')
      this.eventManager.fire('wasmLoaded')
    } catch (error) {
      const err = ensureError(error)
      nsLogger.error('Failed to initialize RenderMainEngine:', err)
      throw err
    }
  }

  public pause() {
    if (!this.engine || !this.handler) {
      nsLogger.warn('Cannot pause: engine or handler not ready')
      return
    }
    try {
      this.engine.PauseEditorEngine(this.handler)
    } catch (error) {
      const err = ensureError(error)
      nsLogger.error('Failed to pause playback:', err)
    }
  }

  public play(loop = false) {
    if (!this.engine || !this.handler) {
      nsLogger.warn('Cannot play: engine or handler not ready')
      return
    }
    try {
      this.engine.PlayEditorEngine(this.handler, loop)
    } catch (error) {
      const err = ensureError(error)
      nsLogger.error('Failed to start playback:', err)
    }
  }

  public refresh(renderPlan: RenderPlan) {
    // Defer to pendingRefresh while create() is in flight (mutating engine state
    // during Asyncify-suspended CreateEditorEngine/StartEditorEngine corrupts the
    // wasm stack) or before the first frame (the wasm Reload silently drops any
    // pre-first-frame refresh). pendingRefresh is flushed once firstFrameReady flips.
    if (this.createPromise || !this.firstFrameReady) {
      this.pendingRefresh = renderPlan
      return
    }
    if (!this.engine || !this.handler) {
      return
    }
    try {
      this.renderPlan = renderPlan
      this.engine.RefreshRenderPlan(this.handler, toEnginePlanJson(renderPlan))
      nsLogger.info('RenderPlan refreshed successfully')
    } catch (error) {
      const err = ensureError(error)
      nsLogger.error('Failed to refresh RenderPlan:', err)
      throw err
    }
  }

  // Like refresh(), but sends only the delta between the last applied plan and
  // renderPlan via RefreshRenderPlanDiff, so the engine skips re-parsing the whole
  // plan. Falls back to a full RefreshRenderPlan when there is no previous plan (or
  // no computable diff). Uses the same deferral as refresh() (create in flight or
  // first frame not yet ready); the deferred plan is flushed via flushPendingRefresh.
  public refreshDiff(renderPlan: RenderPlan) {
    if (this.createPromise || !this.firstFrameReady) {
      this.pendingRefresh = renderPlan
      return
    }
    if (!this.engine || !this.handler) {
      return
    }
    try {
      const diff = getRenderPlanDiff(this.renderPlan, renderPlan)
      this.renderPlan = renderPlan
      this.applyPlanDiff(renderPlan, diff)
    } catch (error) {
      const err = ensureError(error)
      nsLogger.error('Failed to diff-refresh RenderPlan:', err)
      throw err
    }
  }

  public seek(time: number) {
    if (!this.engine || !this.handler) {
      nsLogger.warn('Cannot seek: engine or handler not ready')
      return
    }
    try {
      this.engine.SeekEditorEngine(this.handler, time)
    } catch (error) {
      const err = ensureError(error)
      nsLogger.error('Failed to seek playback:', err)
    }
  }

  // Applies plan to the engine from its precomputed diff against the current plan
  // (the caller is expected to have already set this.renderPlan = plan): an empty
  // diff is a no-op (nothing changed), a non-empty diff refreshes just the delta, and
  // a missing diff (no prior plan) does a full refresh.
  private applyPlanDiff(plan: RenderPlan, diff: PlanDiff | undefined) {
    if (!this.engine || !this.handler) {
      return
    }
    if (diff) {
      if (isEmptyPlanDiff(diff)) {
        // Nothing changed: skip the engine round-trip (the engine already shows it).
        nsLogger.info('RenderPlan unchanged, skipping refresh')
      } else {
        this.engine.RefreshRenderPlanDiff(
          this.handler,
          toEnginePlanJson(plan),
          toEnginePlanJson(diff),
        )
        nsLogger.info('RenderPlan diff-refreshed successfully')
      }
    } else {
      this.engine.RefreshRenderPlan(this.handler, toEnginePlanJson(plan))
      nsLogger.info('RenderPlan refreshed successfully')
    }
  }

  private async doCreate(
    renderPlan: RenderPlan,
    options: {
      audioDriver: boolean
      enableWebcodec: boolean
    },
  ) {
    if (!this.engine) {
      return
    }
    const { audioDriver, enableWebcodec } = options
    this.renderPlan = renderPlan

    try {
      nsLogger.info('create handler')

      const handler = await this.engine.CreateEditorEngine(
        toEnginePlanJson(renderPlan),
        audioDriver,
        this.moduleName,
        this.dataManagerName,
      )
      if (handler === 0) {
        throw new Error('create handle 0')
      }
      this.engine.SetWebcodecStatue(enableWebcodec)
      this.engine.SetNeedPrefetch(false)
      this.handler = handler

      nsLogger.info('start editor engine')

      try {
        await this.engine.StartEditorEngine(
          handler,
          `#${this.videoCanvasId}`,
          RenderMainEngine.prefetchVideoHeaderRange[0].toString(),
          RenderMainEngine.prefetchVideoHeaderRange[1].toString(),
        )
      } catch (e) {
        if (String(e).includes('unwind')) {
          nsLogger.warn(
            'Wasm unwind error ignored during StartEditorEngine. This usually indicates a non-fatal internal Wasm state change.',
          )
        } else {
          throw e
        }
      }

      nsLogger.info('start editor engine done', Date.now())

      // Any refresh received during create was held in pendingRefresh; do NOT flush
      // it here. StartEditorEngine resolving does NOT mean the engine can accept a
      // refresh yet: the wasm Reload (av-engine WebPreview::Reload) hard-guards
      //
      //   if (!m_isRunning || m_bFirstFrame) { onStatusUpdate(RefreshEnd); return; }
      //
      // and m_bFirstFrame stays true until OnInit renders the first frame (OnInit
      // runs asynchronously on the video thread, after StartEditorEngine returns).
      // So a refresh flushed now would be silently dropped -- which is exactly the
      // bug the old setTimeout(100ms) tried to paper over. Instead OnInit emits
      // firstFrameEnd (PLAY_STATUS_FirstFrameEnd) when done, and handleFirstFrameEnd
      // flushes pendingRefresh then. flushPendingRefresh() is also called after
      // create() resolves to cover the race where firstFrameEnd already fired while
      // createPromise (and thus the refresh deferral) was still in effect.
      this.flushPendingRefresh()
    } catch (error) {
      nsLogger.error('create engine error:', error)
    }
  }

  // Applies the latest deferred plan once the engine can accept it. No-op until the
  // first frame has rendered: before that the wasm Reload drops any refresh (see
  // doCreate), so this is re-invoked from handleFirstFrameEnd when firstFrameReady
  // flips true, and from create() after createPromise clears. The while-loop closes
  // the window where a late refresh() lands between reads.
  private flushPendingRefresh() {
    if (!this.firstFrameReady) {
      return
    }
    while (this.pendingRefresh && this.handler) {
      const pending = this.pendingRefresh
      this.pendingRefresh = undefined
      try {
        const diff = getRenderPlanDiff(this.renderPlan, pending)
        this.renderPlan = pending
        this.applyPlanDiff(pending, diff)
      } catch (error) {
        const err = ensureError(error)
        nsLogger.error('Failed to flush pendingRefresh:', err)
        break
      }
    }
  }

  // Stable listener so on/off pair up. Marks the first frame ready and flushes any
  // refresh deferred while the engine was still initializing.
  private readonly handleFirstFrameEnd = (moduleName: string) => {
    if (moduleName !== this.moduleName) {
      return
    }
    this.firstFrameReady = true
    this.flushPendingRefresh()
  }
}

export class RuntimeLoader {
  private static callBackQueue: RenderEngineCallback[] = []
  private static isWasmLoading = false
  private static wasmBlob: null | string = null

  public static awaitResource(): Promise<string> {
    return new Promise((resolve) => {
      RuntimeLoader.getResource((url) => {
        resolve(url)
      })
    })
  }

  public static getResource(callback: RenderEngineCallback) {
    if (!RuntimeLoader.isWasmLoading) {
      RuntimeLoader.isWasmLoading = true
      RuntimeLoader.loadWasmBlob()
    }
    if (RuntimeLoader.wasmBlob) {
      callback(RuntimeLoader.wasmBlob)
    } else {
      RuntimeLoader.callBackQueue.push(callback)
    }
  }

  private static async loadWasmBlob() {
    try {
      const url = await getWasmBlob()
      RuntimeLoader.wasmBlob = url
      while (RuntimeLoader.callBackQueue.length > 0) {
        RuntimeLoader.callBackQueue.shift()?.(url)
      }
      RuntimeLoader.isWasmLoading = false
    } catch (error) {
      // TODO: we may need to add a fallback wasm blob here
      nsLogger.error('loadWasmBlob error:', error)
    }
  }
}
