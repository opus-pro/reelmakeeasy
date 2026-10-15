/**
 * Same as properties in interface Window.
 *
 * The listed literals are the well-known managers; the `string & {}` member keeps
 * their autocomplete while allowing a dynamically generated, per-instance name so
 * multiple engines can each register their own data manager on window.
 */
export type DataManagerInstanceName =
  | 'addSectionMediaDataManager'
  | 'mediaDataManager'
  | (string & {})
export interface Engine {
  CreateEditorEngine(
    _0: ArrayBuffer | Int8Array | string | Uint8Array | Uint8ClampedArray,
    newAudio: boolean,
    moduleName: ModuleName,
    dataManagerInstanceName: DataManagerInstanceName,
  ): Promise<number>
  DestroyEditorEngine(_0: number): void
  DestroyWindow(handle: number): void
  DumpTimeline(handle: number): void
  ExtractCoverImageByTimeline(handle: number, timestamp: number): void
  ExtractCurrentImageByTimeline(handle: number, index: string): void
  ExtractImageByTime(url: string, times: number[]): void
  ExtractRGBAByTime(url: string, times: number[], context: string): void
  // will emit "audioWav" event
  ExtractWavByTime(url: string, times: number[]): void
  FetchCurrentLayoutInfo(handle: number, index: string): void
  PauseEditorEngine(_0: number): void
  PlayEditorEngine(_0: number, loop: boolean): void
  RefreshRenderPlan(handle: number, renderPlan: string)
  RefreshRenderPlanDiff(handle: number, renderPlan: string, diff: string)
  ResetWindow(handle: number, canvasId: string): void
  returnVectorData(): number[] & {
    resize: (length: number, newLength: number) => void
    set: (index: number, item: number) => void
  }
  SeekEditorEngine(_0: number, _1: number): void
  SetLogLevel(handle: number, logLevel: string): void
  SetNeedPrefetch(IsNeedPrefetch: boolean): void
  SetWebcodecStatue(IsEnableWebCodec: boolean): void
  StartEditorEngine(
    _0: number,
    _1: ArrayBuffer | Int8Array | string | Uint8Array | Uint8ClampedArray,
    start: string,
    end: string,
  ): void
  StepBackward(handle: number): void
  StepForward(handle: number): void
  StopEditorEngine(_0: number): void
}

/**
 * Same as properties in interface Window.
 *
 * The listed literals are the well-known engine roles; the `string & {}` member
 * keeps their autocomplete while allowing a dynamically generated unique id so
 * many engine instances can coexist, each routing its events by its own name.
 */
export type ModuleName =
  | 'Module'
  | 'ModuleAddSection'
  | 'ModuleAutoTracking'
  | 'ModuleOriginal'
  | 'ModuleThumbnail'
  | (string & {})
