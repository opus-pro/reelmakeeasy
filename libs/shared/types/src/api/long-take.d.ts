import type { TranscriptData } from '../agent/transcript'

import type { CaptionStyleSettings } from './caption-style'

export type LongTakeAudioScriptPreviewResponse = {
  script: string
}

export interface LongTakeBgmSettingsRequest {
  bgmEnabled?: boolean
  /** Panel slider value, integer 0-100. */
  bgmVolume?: number
}

export interface LongTakeBgmSettingsResponse {
  data: {
    /**
     * 'started' when a delivery remux workflow was launched; skipped states
     * mean the settings persisted but there is nothing to rebuild (no
     * generated bed / video not delivered yet).
     */
    remux: 'skipped_no_bed' | 'skipped_not_delivered' | 'started'
    workflowId?: string
  }
}

/**
 * Authoritative status of the LATEST run of a BGM workflow (the settings
 * re-mux, and the regeneration), from a workflow
 * describe() of the shared per-project workflow id (always the newest run).
 * 'not_started' is the definite no-such-workflow answer; 'unknown' means the
 * probe failed -- clients must not treat it as settled (a queued download
 * waits; a fresh click queues; a pending regenerate keeps spinning).
 */
export type BgmRemuxOutcome =
  | 'completed'
  | 'failed'
  | 'not_started'
  | 'running'
  | 'terminated'
  | 'unknown'

/**
 * Owner-only music panel state. Unlike the long-take status (which
 * share-link viewers can read), this surfaces bgmPrompt so the panel can
 * prefill the editable regenerate prompt.
 */
export interface LongTakeBgmSettingsReadResponse {
  data: {
    /**
     * Whether the settings re-mux workflow (started by a PATCH to apply a
     * volume / on-off change to the delivered video) is currently running,
     * read from the workflow engine. Lets the client hold exports until the delivered
     * file matches the panel. Always equal to `remuxOutcome === 'running'`;
     * kept for existing consumers.
     */
    applying: boolean
    bgmEnabled: boolean | null
    bgmPrompt: null | string
    /** 'generated' | 'library' | 'upload'; null before any bed. */
    bgmSource: null | string
    bgmTrackId: null | string
    bgmTrackName: null | string
    bgmVolume: null | number
    /**
     * Whether a BGM (re)generation workflow is currently running for this
     * project, read from the workflow engine. Lets the panel restore its pending state
     * after a remount (navigating away and back) instead of trusting
     * client-local capture state.
     */
    generating: boolean
    /**
     * Authoritative status of the latest (re)generation workflow.
     * `generating` is always `regenOutcome === 'running'`; kept for existing
     * consumers. describe() reports the newest run of the shared workflow id,
     * so a terminal value here may belong to a HISTORICAL run -- clients must
     * only settle an ACTIVE pending from it (or dedupe by regenRunId).
     */
    regenOutcome: BgmRemuxOutcome
    /**
     * Workflow runId of that latest regeneration run; null when none exists
     * or the probe failed. Stable per run: lets a client fire a return-visit
     * failure notice exactly once per failed run.
     */
    regenRunId: null | string
    /** Authoritative status of the latest settings re-mux workflow. */
    remuxOutcome: BgmRemuxOutcome
  }
}

/** Create a new BGM version = regenerate the bed. */
/**
 * One switchable BGM bed on a project. The array order in
 * LongTakeBgmVersionsResponse IS the back/forward order: oldest first, the
 * newest generation last.
 */
export interface LongTakeBgmVersion {
  /**
   * Bed->voice parity gain in dB measured when this bed was generated; drives
   * the live preview's loudness parity once the version is applied. null on
   * beds generated before the measurement was recorded per version -- the
   * preview then falls back to the legacy linear volume curve. The baked
   * export is unaffected either way: the re-mux measures the gain itself.
   */
  bedToVoiceGainDb: null | number
  /** Playable https URL for previewing this bed. */
  cdnUrl: null | string
  /** null when the bed was persisted without a recorded generation time. */
  createdAt: null | string
  /** Stable handle to pass back to the apply operation. */
  id: string
  /** Lyria model that produced this bed. */
  model: null | string
  /** Prompt this bed was generated from; owner-only, like the settings read. */
  prompt: null | string
  /** 'generated' | 'library' | 'upload'; null on entries from before the library. */
  source: null | string
  /** The library track id or the user's track id it was fitted from. */
  trackId: null | string
  /** Short human-readable track name from the director, or the track's title. */
  trackName: null | string
}

export interface LongTakeBgmVersionApplyResponse {
  data: {
    /**
     * 'started' when the delivered video is being rebuilt at the newly applied
     * bed. The skipped states all mean the bed swapped on the project (the
     * editor preview follows immediately) but there was nothing to rebuild:
     * it was already the current bed, the video is not delivered yet, or music
     * is off / muted so the delivery is voiceover-only either way.
     */
    remux: 'skipped_muted' | 'skipped_not_delivered' | 'skipped_unchanged' | 'started'
    workflowId?: string
  }
}

export interface LongTakeBgmVersionCreateRequest {
  /** A wish for a director take (stored as the project's bgmNote); null lets the director pick. */
  note?: null | string
  /**
   * User-edited Lyria prompt used verbatim; omit for a fresh director take
   * from the project's report fields.
   */
  prompt?: string
  /** A library track or one of the user's tracks, fitted to the video (no generation). */
  track?: { id: string; source: 'library' | 'upload' }
}

export interface LongTakeBgmVersionCreateResponse {
  data: {
    workflowId: string
  }
}

export interface LongTakeBgmVersionRenameRequest {
  /** The user-chosen track name; trimmed server-side, must be non-empty. */
  trackName: string
}

export interface LongTakeBgmVersionRenameResponse {
  data: {
    /** The name as persisted (post-trim). */
    trackName: string
  }
}

export interface LongTakeBgmVersionsResponse {
  data: {
    /**
     * The version the project is on: playing in the editor and baked into the
     * delivered video. Always one of `versions` when non-null; null only when
     * the project has no bed at all.
     */
    currentVersionId: null | string
    versions: LongTakeBgmVersion[]
  }
}

/**
 * PUT /long-take-videos/:id/caption-settings: the caption fields to change. Fields
 * left out keep their saved value; null puts one back to its default.
 */
export type LongTakeCaptionSettingsRequest = CaptionStyleSettings

export interface LongTakeCaptionSettingsResponse {
  data: {
    /** The project's caption settings after the save (`Project.captionStyle`). */
    captionStyle: CaptionStyleSettings
  }
}

export interface LongTakeEditorDraft {
  /** Editor revision the snapshot stack was built on, per buildLongTakeEditorRevision. */
  baseRevision: string
  /** Client snapshot stack (LongTakeSnapshot[]), stored verbatim; server does not interpret it. */
  snapshots: unknown[]
  /** Server-stamped last-write time, ms epoch. */
  updatedAt: number
  /** Full working editor state at save time. Authoritative on load; snapshots stay a bounded undo stack. Optional for back-compat with pre-workingState drafts. */
  workingState?: LongTakeEditorState
}

export interface LongTakeEditorDraftResponse {
  data: LongTakeEditorDraft | null
}

export interface LongTakeEditorState {
  keyframes: LongTakeKeyframe[]
  transcript?: TranscriptData
  transitions: LongTakeTransition[]
}

export interface LongTakeEditorStateResponse {
  data: LongTakeEditorState
  hasUnrenderedChanges: boolean
  /** Inpaint generations still in flight. Lets a client without the inpaint editor mounted (mobile) hold actions that a running generation would invalidate. 0 when the state cannot be read. */
  runningInpaintGenerationCount: number
}

/**
 * One inpaint editing action, derived server-side from the history DAG. Covers
 * every branch, so events the user undid away from are present too, flagged by
 * `onMainBranch`.
 */
export interface InpaintTimelineEvent {
  /** Transitions replaced by an `edit_applied` event. */
  clipCount?: number
  createdAt: number
  diffId: string
  /** Absent on migration diffs, which carry no owning edit. */
  editId?: string
  /** Keyframes written, on `keyframe_applied` and on `edit_applied` when it wrote any. */
  keyframeCount?: number
  kind: 'edit_applied' | 'edit_hidden' | 'edit_unhidden' | 'keyframe_applied'
  /** False for events on an abandoned branch, i.e. undone and superseded. */
  onMainBranch: boolean
  /** The edit's user prompt, when the edit is still known. */
  prompt?: string
}

export interface InpaintTimelineEventsResponse {
  /** Newest first. */
  events: InpaintTimelineEvent[]
  /** True when older events exist beyond this page. */
  hasMore: boolean
}

export type LongTakeKeyframe = {
  fallbackFromShotId?: string
  keyframeUrl: string
  shotId: string
  thumbnailUrl?: string
  usedFallback?: boolean
}

export interface LongTakeLipSyncVideoVariants {
  appliedCount: number
  baseVideoUrl: string
  baseWatermarkVideoUrl?: string
  failedCount: number
  lipSyncVideoUrl: string
  lipSyncWatermarkVideoUrl?: string
  skippedCount: number
}

export interface SaveLongTakeEditorDraftRequest {
  baseRevision: string
  /** `updatedAt` of the draft this save is based on; omit on the first save. Stale values are rejected with 409. */
  baseUpdatedAt?: number
  snapshots: unknown[]
  /** Full working editor state at save time. Authoritative on load; snapshots stay a bounded undo stack. Optional for back-compat with pre-workingState drafts. */
  workingState?: LongTakeEditorState
}

/**
 * Outcome of the Topaz upscale path for a delivered video. 'success' /
 * 'fallback' come from the upscale trace (fallback = Topaz failed and the naive-
 * scaled, non-upscale-quality video was delivered); 'not_run' means the project
 * used the non-upscale path (no trace). Used as the `upscaleOutcome` property
 * on the `project.downloaded` and `project.long_take.completed` tracking events.
 */
export type UpscaleOutcome = 'fallback' | 'not_run' | 'success'

// Music-analysis context (music_context.json) surfaced in the admin report.
export interface LongTakeMusicContext {
  bpm?: number
  durationSec?: number
  genre?: string
  sections?: Array<{ end: number; label?: string; start: number }>
}

export interface LongTakeRenderRequest {
  expectedRevision: string
  keyframes: LongTakeKeyframe[]
  settings?: LongTakeRenderSettings
  transitions: LongTakeTransition[]
}

export interface LongTakeRenderSettings {
  /**
   * The music toggle the user is looking at. Omitted means "no opinion", and
   * the render falls back to the project row's stored BGM state.
   */
  bgmEnabled?: boolean
  captionEnabled?: boolean
  /**
   * The caption look the user is looking at; null means none chosen (the video kind's
   * default). Omitted means "no opinion", and the render reads the project row's saved
   * `captionStyle`. Read field by field like the saved column: a malformed field counts as
   * unset.
   */
  captionStyle?: CaptionStyleSettings | null
}

export type LongTakeScriptPreviewFallback = {
  code: 'generate_preview_failed' | 'generate_script_missing' | 'rewrite_empty_result'
  fallbackTo: 'normalized_previous_script' | 'normalized_raw_input' | 'raw_input'
  stage: 'generate' | 'preview' | 'rewrite'
}

/**
 * Names what the system actually did with the user's input to produce the final
 * long-take voiceover script. Behavior-based, not cohort-based: a user pasting a
 * finished script lands in `passthrough` regardless of which feature-gate cohort
 * they're in. Surfaced on tracking events (`project.long_take.*` and
 * `survey.story_mode.submitted`) for A/B analysis.
 *
 * - `passthrough`: final script equals the user's input verbatim. No new content
 *   was authored. Decided by content equality, not by the LLM's `isScript` flag:
 *   the LLM can return `isScript: true` while still rewriting the input, so the
 *   flag alone is unreliable.
 * - `agent_pipeline`: V4 workflow generated the final script.
 * - `agent_pipeline_fallback`: V4 attempted, returned nothing, legacy LLM then
 *   generated the final script.
 * - `legacy`: legacy single-LLM call generated the final script. V4 was not
 *   attempted (V4 gate off, or parallel-detection path).
 * - `audio_upload`: user uploaded a pre-recorded audio file as their voiceover.
 *   The script generator never ran. Excluded from script-quality A/B reads.
 */
export type LongTakeScriptGeneratorPath =
  | 'agent_pipeline'
  | 'agent_pipeline_fallback'
  | 'audio_upload'
  | 'legacy'
  | 'passthrough'

export type LongTakeScriptPreviewResponse = {
  contextId: string
  fallbackSignals: LongTakeScriptPreviewFallback[]
  finalScriptSource:
    | 'generated'
    | 'normalized_previous_script'
    | 'normalized_raw_input'
    | 'raw_input'
  hasError: boolean
  script: string
  scriptGeneratorPath?: LongTakeScriptGeneratorPath
  v4Category?: string
  v4Track?: string
}

export type LongTakeStatus = {
  audioPreviewUrl?: null | string
  // BGM (Story Mode background music) data contract surfaced to the editor FE.
  // Mirrors the playback-relevant Project columns; exposed
  // unconditionally (null until generation writes them), FE gates *rendering* on
  // `enable_bgm`. bgmPrompt/bgmVersions are deliberately NOT surfaced here: the
  // status is readable via share links and playback needs neither; the editor
  // backend will expose them to owners for regeneration.
  bgmBedCdnUrl?: null | string
  /** Bed->voice loudness parity gain in dB; drives the live preview curve. */
  bgmBedGainDb?: null | number
  bgmBedUri?: null | string
  bgmDuckDb?: null | number
  bgmEnabled?: boolean | null
  bgmModel?: null | string
  /**
   * Whether the bed was ever regenerated (project.bgmVersions non-empty). A
   * derived boolean only -- the versions themselves (prompt text, URIs) stay
   * project-only per the note above. Feeds the project.downloaded
   * bgm_regenerated tracking property.
   */
  bgmRegenerated?: boolean | null
  /** 'generated' | 'library' | 'upload'; null before any bed. */
  bgmSource?: null | string
  bgmTrackId?: null | string
  bgmTrackName?: null | string
  bgmVolume?: null | number
  /** A colour the agent suggested for the highlight (loops' storyboard accent); never applied on its own. */
  captionAccentSuggestion?: null | string
  /** Which default caption look applies when nothing is saved: loops start in Punch, other videos in Classic. */
  captionKind?: 'loop' | 'video'
  /**
   * The caption look saved on the project (style, highlight, height, size); null when
   * nobody chose one, and the client resolves the default for the video's kind.
   */
  captionStyle?: CaptionStyleSettings | null
  concurrentStages?: LongTakeStatusStage[]
  customStyle?: boolean | null
  detail?: string
  enableCaption?: boolean | null
  isSavedStyle?: boolean | null
  lipSyncVideoVariants?: LongTakeLipSyncVideoVariants
  /**
   * The joined clips that loop's bed was made from (`long_take/beat_loop_clips.mp4`, keyed to
   * their own file's version): the picture the live preview plays, muted, under the voice-over
   * with the bed beside it. Set and null with `loopSfxBedUrl`.
   */
  loopClipsUrl?: null | string
  /**
   * True while a delivered loop's bed is being built in the background (a loop finished before
   * beds existed, or whose bed is older than its clips): keep reading the status past delivery
   * until it turns false, then `loopSfxBedUrl` has the bed. False for other videos, once the bed
   * is there, and when it will not come (no clips to build from, or the build failed; a failed
   * one is tried again on a status read ten minutes later). False while a render runs, and
   * nothing is built then: the render writes the loop's bed itself.
   */
  loopSfxBedPending?: boolean
  /**
   * A loop's clip sound bed for the live preview (`long_take/beat_loop_sfx.m4a`): the clips' own
   * sound effects as the delivered mix levels them, as long as the loop. Play it beside the
   * engine's voice-over at `loopSfxBedVolume`. Null for other videos, and while a loop has no bed
   * that matches its clips (one finished before beds existed gets it built in the background,
   * `loopSfxBedPending` meanwhile); play the delivered file then.
   */
  loopSfxBedUrl?: null | string
  /**
   * How loud to play that bed: 0-100 %, the audio element's own volume (linear), beside the
   * voice-over at its own level. The clips' sound then sits under the voice as in the delivered
   * mix (about 35%); 0 when the clips make no sound. Null whenever the URL is.
   */
  loopSfxBedVolume?: null | number
  meta?: Record<string, boolean | number | string>
  /**
   * The caption look the delivered video was rendered with, every default filled in: the record
   * its render wrote beside final_video.mp4 once the file was uploaded
   * (`final_video_caption_style.json`). Null with no delivered file, or when the file predates
   * recorded looks; it then has the old default caption (Classic laid out for 9:16). Download
   * renders again when `captionLookChanged` (adapters/caption/caption-look.ts) says the look on
   * screen draws differently.
   */
  renderedCaptionStyle?: CaptionStyleSettings | null
  resultVideoThumbnail?: null | string
  script?: null | string
  stage: LongTakeStatusStage
  status: LongTakeStatusState
  styleName?: null | string
  styleText?: null | string
  styleThumbnailUrl?: null | string
  updatedAt?: string
  uploadedAudioUrl?: null | string
  videoUrl?: null | string
  watermarkVideoUrl?: null | string
}

export type LongTakeStatusResponse = {
  data: LongTakeStatus | null
}

export type LongTakeStatusStage =
  | 'anchor_assets'
  | 'completed'
  | 'error'
  | 'experts_analysis'
  | 'keyframe_prompts'
  | 'keyframes'
  | 'queued'
  | 'rejected'
  | 'render'
  | 'script'
  | 'shot_plan'
  | 'started'
  | 'transitions'
  | 'user_assets_analysis'
  | 'user_assets_understanding'
  | 'visual_script'
  | 'voiceover'

export type LongTakeStatusState = 'completed' | 'error' | 'in_progress' | 'rejected'

export interface LongTakeTransition {
  baseVideoUri?: string
  endMs: number
  fromShotId: string
  lipSyncEnabled?: boolean
  lipSyncVideoUri?: string
  prompt: string
  startMs: number
  toShotId: string
  transitionId: string
  videoHeight?: number
  videoUri: string
  videoWidth?: number
}

export type TransitionRegenWorkflowResult = {
  fileUri: string
  transitionId: string
  videoHeight?: number
  videoWidth?: number
}
