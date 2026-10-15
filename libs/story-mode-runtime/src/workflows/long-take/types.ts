import type { PipelineContextEntry } from '@reelmakeeasy/common/job-context'
import type { CameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import type { RenderFinalTransitionVideo } from '@reelmakeeasy/common/long-take/render-final'
import type {
  LongTakeAdmissionTier,
  LongTakeHumanPresence,
} from '@reelmakeeasy/common/long-take/types'
import type { AspectRatio, GenerationResolution } from '@reelmakeeasy/common/media/types'
import type { CaptionStyleSettings } from '@shared/types/api/caption-style'
import type {
  LongTakeKeyframe,
  LongTakeRenderSettings,
  LongTakeScriptGeneratorPath,
} from '@shared/types/api/long-take'
import type { BgmRunState, BgmVersion } from '@shared/types/api/project'
import type { VoiceProfile } from '@shared/types/api/voice-profile'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import { DebugSettings } from '@shared/types/project/debug-settings'

import type { LongTakeIntentMode, LongTakePromptRoute } from '../../long-take-prompt-router'

import type {
  LongTakeTransitionPromptRefinementInput,
  LongTakeTransitionType,
  LongTakeTransitionVideoItem,
} from './transition-types'

export type {
  LongTakeTextSeverity,
  LongTakeTransitionAttemptRecord,
  LongTakeTransitionPlanItem,
  LongTakeTransitionPromptRefinementInput,
  LongTakeTransitionType,
  LongTakeTransitionVideoItem,
} from './transition-types'
export * from './types.bgm'
export * from './types.regenerate'
export * from './types.restyle'
export * from './types.slot'

export interface AnalyzeLongTakeExpertsActivityParams {
  projectId: string
  script: string
  styleText?: string
  userId: string
}

export interface AnalyzeLongTakeExpertsActivityResult {
  beatCount: number
  fallbackCount: number
  manifestCount: number
  outputDir: string
  promptCount: number
}

export interface AnalyzeLongTakeUserAssetsActivityParams {
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  script: string
  userAssetCatalog: LongTakeUserAssetCatalogItem[]
  userId: string
  userPrompt: string
}

export interface AnalyzeLongTakeUserAssetsActivityResult {
  contextSummary?: string
  fileCount: number
  matchedCount: number
  outputPath: string
  unresolvedCount: number
}

export interface AnalyzeLongTakeUserAssetUnderstandingActivityParams {
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  userAssetCatalog: LongTakeUserAssetCatalogItem[]
  userId: string
}

export interface AnalyzeLongTakeUserAssetUnderstandingActivityResult {
  analyzedCount: number
  contextSummary?: string
  failedCount: number
  outputPath: string
}

export interface AnalyzeLongTakeVoiceCharacterActivityParams {
  /** An agent-mode run (`isAgentHarnessRun`): its LLM calls go to Codex or Claude Code, which
   *  can't hear audio, whatever AI is chosen in Setup. */
  agentHarnessRun?: boolean
  projectId: string
  userId: string
}

export interface AnalyzeLongTakeVoiceCharacterActivityResult {
  outputPath: string
  voiceCharacter: string
  voiceProfile?: VoiceProfile
}

export interface ApplyLongTakePreVoiceoverSpeedActivityParams {
  audioDurationSeconds?: number
  projectId: string
  scriptText?: string
  speed: number
  transcriptPath: string
  userEmail?: string
  userId: string
  voiceOverPath: string
}

export interface BuildLongTakeShotPlanActivityParams {
  audioDurationSeconds?: number
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  transitionVideoModel?: string
  userEmail?: string
  userId: string
  visualScriptPath: string
}

export interface BuildLongTakeShotPlanActivityResult {
  fallbackCount?: number
  fallbackRatio?: number
  fallbackStartIndex?: number
  fallbackTotal?: number
  shotCount: number
  shotPlan: LongTakeShotPlanItem[]
  shotPlanPath: string
  timingSource?: string
}

export interface ClassifyLongTakeGenreActivityParams {
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  userId: string
}

export interface ClassifyLongTakeGenreActivityResult {
  outputPath: string
  primaryGenre: string
  scriptwriterGuidance: string
  secondaryGenre: string
  styleApplication: string
}

export interface ClassifyLongTakePromptActivityParams {
  /**
   * When set, the classifier additionally has Gemini LISTEN to the project's
   * voiceover/uploaded audio and feeds an authoritative AUDIO TRACK ANALYSIS
   * section into the classification prompt (is_music / music_genre come from
   * the heard track, not just the lyrics text). Defaults to the canonical
   * voiceover mp3 when set to `true`; pass a `store://` URI to override. Leave
   * unset (the default) for text-only classification - existing behavior.
   *
   * Callers MUST only enable this AFTER the voiceover stage has written
   * `story_loader/audio/voice_over.mp3`, otherwise the audio probe misses and
   * the classifier silently falls back to text-only.
   */
  analyzeAudio?: boolean | string
  projectId: string
  prompt: string
  userId: string
}

export type ClassifyLongTakePromptActivityResult = LongTakePromptClassification | null

export interface ClassifyLongTakePromptRouteActivityParams {
  intentMode?: LongTakeIntentMode | null
  originalUserInput?: string
  projectId: string
  script: string
  userId: string
}

export interface ClassifyLongTakePromptRouteActivityResult {
  outputPath?: string
  promptRoute: LongTakePromptRoute
  reasoning: string
}

export interface CorrectLongTakeTranscriptActivityParams {
  projectId: string
  userEmail?: string
  userId: string
}

export interface CorrectLongTakeTranscriptActivityResult {
  hasCorrections: boolean
  issuesCount: number
  isValid: boolean
  segmentsCount: number
}

export interface EnsureLongTakeTransitionsDirActivityParams {
  projectId: string
  userId: string
}

export interface ExpandLongTakeKeyframeActivityParams {
  aspectRatio?: AspectRatio
  generationResolution?: GenerationResolution
  imageModel?: string
  orgId?: string
  panel1Uri: string
  panel2Description: string
  projectId: string
  shotId: string
  userId: string
}

export interface ExpandLongTakeKeyframeActivityResult {
  panel2Uri: string
  shotId: string
}

export interface FinalizeLongTakeAnchorAssetsActivityParams {
  assetCount: number
  /**
   * Brand anchor-library coordinates. Present only for a saved-brand
   * session with an effective style. The render side does not store anchors to
   * the durable library, so this is currently unread.
   */
  brandAnchorLibrary?: {
    brandStagedAssetIds: string[]
    briefId: string
    orgId: string
    styleHash: string
    // Style display name, recorded on the stored manifest for
    // debuggability. Resolved at confirm alongside styleHash so it names the style
    // the anchors were actually rendered in.
    styleName?: null | string
  }
  projectId: string
  rawAnchors: LongTakeRawAnchorAssetItem[]
  styledAnchors: LongTakeStyledAnchorAssetItem[]
  styleName?: null | string
  userId: string
}

export interface FinalizeLongTakeAnchorAssetsActivityResult {
  assetCount: number
  fallbackToRawCount: number
  outputDir: string
  rawAnchorCount: number
  styledAnchorCount: number
}

export interface GenerateAndUpdateLongTakeProjectNameActivityParams {
  projectId: string
  scriptText: string
  userId: string
}

export interface GenerateLongTakeAnchorAssetFileBindingActivityParams {
  /**
   * Brand anchor-library coordinates. Present only for a saved-brand
   * session with an effective style. The render side does not reuse stored
   * anchors, so this is currently unread.
   */
  brandAnchorLibrary?: {
    brandStagedAssetIds: string[]
    briefId: string
    orgId: string
    styleHash: string
  }
  projectId: string
  userId: string
}

export interface GenerateLongTakeAnchorAssetFileBindingActivityResult {
  assetCount: number
  assetTasks: LongTakeAnchorAssetTask[]
  outputPath: string
  userFileBoundAssetCount: number
}

export interface GenerateLongTakeAnchorAssetsActivityParams {
  generationResolution?: GenerationResolution
  /** Org id that owns the project. */
  orgId?: string
  projectId: string
  styleText?: string
  userId: string
}

export interface GenerateLongTakeAnchorAssetsActivityResult {
  assetCount: number
  fallbackToRawCount: number
  outputDir: string
  rawAnchorCount: number
  styledAnchorCount: number
}

export interface GenerateLongTakeBgmBedActivityParams {
  /** The video's camera style: sets the music's energy (calm, or a gentle pulse). */
  cameraStyle?: CameraStyle
  /** Target bed length in seconds (the video duration); also selects Clip vs Pro. */
  durationSec: number
  /**
   * The regeneration's freeze id, which the activity reports as the editor gen
   * event's edit id. Absent on the initial creation path, which the activity
   * reports as bgm_creation instead.
   */
  editId?: string
  hasVoiceover?: boolean
  numShots?: number
  numTransitions?: number
  orgId?: string
  projectId: string
  /**
   * User-edited Lyria prompt from the music panel. When set the
   * director LLM is skipped and this text is used verbatim (a track name is
   * still generated); absent => a fresh director take from the report fields.
   */
  promptOverride?: string
  styleName?: string
  styleText?: string
  /** Threaded into the activity's JobContext. */
  userEmail?: string
  userId: string
  /** The user's wish for the music (the Music choice); the director honours it. */
  userRequest?: string
}

/** A chosen track for a bed: a library track (resolved by id at fit time) or the user's own file. */
export interface BgmTrackArg {
  id: string
  source: 'library' | 'upload'
  /** Shown as the track name. */
  title: string
  /** The uploaded file's store:// uri; absent for library tracks. */
  uri?: string
}

export interface FitLongTakeBgmTrackActivityParams {
  /** Target bed length in seconds (the voice-over duration). */
  durationSec: number
  orgId?: string
  projectId: string
  track: BgmTrackArg
  userEmail?: string
  userId: string
}

export interface GenerateLongTakeBgmBedActivityResult {
  /**
   * Ear-tuning: bed->voice loudness parity gain in dB (voice LUFS -
   * bed LUFS); absent when the measurement failed (best-effort).
   */
  bedToVoiceGainDb?: number
  cdnUrl: string
  durationMs: number
  fileUri: string
  /** The music model key used (the registry's `music` role, e.g. `lyria2`); '' for a track. */
  model: string
  prompt: string
  /** Where the bed came from; absent on results from before the library (generated). */
  source?: 'generated' | 'library' | 'upload'
  /** The library track id or the user's track id, with source library/upload. */
  trackId?: string
  trackName: string
}

export interface GenerateLongTakeExpertsAssetManagerActivityParams {
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  styleText?: string
  userId: string
}

export interface GenerateLongTakeExpertsAssetManagerActivityResult {
  outputPath: string
  promptCount: number
  usedFallback: boolean
}

export interface GenerateLongTakeExpertsAssetManifestActivityParams {
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  script: string
  styleText?: string
  userEmail?: string
  userId: string
}

export interface GenerateLongTakeExpertsAssetManifestActivityResult {
  contextSummary?: string
  manifestCount: number
  outputPath: string
  usedFallback: boolean
}

export interface GenerateLongTakeExpertsBeatSheetActivityParams {
  cameraStyle?: CameraStyle
  projectId: string
  promptRoute?: LongTakePromptRoute
  script: string
  transcriptPath?: string
  transitionVideoModel?: string
  userId: string
}

export interface GenerateLongTakeExpertsBeatSheetActivityResult {
  beatCount: number
  outputPath: string
  textAudited?: boolean
  timeAudited?: boolean
  usedFallback: boolean
}

export interface GenerateLongTakeExpertsParallelActivityParams {
  cameraStyle?: CameraStyle
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  script: string
  // Music-video route: the beat sheet comes from the music grid (buildLongTakeMusicBeatSheet), so the
  // text-driven beat sheet is skipped here and only world bible + asset manifest are produced.
  skipBeatSheet?: boolean
  styleText?: string
  transcriptPath?: string
  transitionVideoModel?: string
  userEmail?: string
  userId: string
}

export interface GenerateLongTakeExpertsParallelActivityResult {
  assetManifest: GenerateLongTakeExpertsAssetManifestActivityResult
  beatSheet: GenerateLongTakeExpertsBeatSheetActivityResult
  worldBible: GenerateLongTakeExpertsWorldBibleActivityResult
}

export interface GenerateLongTakeExpertsWorldBibleActivityParams {
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  script: string
  styleText?: string
  transitionVideoModel?: string
  userId: string
}

export interface GenerateLongTakeExpertsWorldBibleActivityResult {
  contextSummary?: string
  outputPath: string
  usedFallback: boolean
}

export interface GenerateLongTakeKeyframeActivityParams {
  admissionTier?: LongTakeAdmissionTier
  aspectRatio?: AspectRatio
  generationResolution?: GenerationResolution
  humanPresence?: LongTakeHumanPresence
  imageModel?: string
  keyframeImageModel?: string
  orgId?: string
  projectId: string
  prompt: string
  promptRoute?: LongTakePromptRoute
  shotId: string
  styleName?: string
  styleText?: string
  // The stylization decision from the keyframe-prompts step, threaded
  // in so suppression of the per-shot style suffix matches whether the style was
  // baked into prompt_base. Undefined -> re-evaluate.
  stylizeKeyframes?: boolean
  usedAssetIds?: string[]
  userId?: string
}

export type GenerateLongTakeKeyframeActivityResult = LongTakeKeyframeItem

export interface GenerateLongTakeKeyframePromptsActivityParams {
  /**
   * Story Mode 3.0. Tells the meta-prompt that `core_description`
   * covers the whole clip in time order, so the keyframe is its OPENING instant.
   * Absent on every V2 call, which keeps their prompt byte-identical.
   */
  openingInstantOnly?: boolean
  orgId?: string
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  userId: string
}

export interface GenerateLongTakeKeyframePromptsActivityResult {
  outputPath: string
  /**
   * The authored prompt per shot id. V2 re-reads the artifact inside
   * its shot-plan activity; Story Mode 3.0 builds its shot plan in the workflow,
   * so it takes the mapping straight from here rather than adding a read.
   */
  promptByShotId?: Record<string, string>
  shotCount: number
  // The keyframe-stylization gate decision, computed once here (with
  // the real orgId) so keyframe generation can reuse it instead of re-checking
  // the gate with different args -- which caused the style to be applied twice.
  stylizeKeyframes: boolean
}

export interface GenerateLongTakeKeyframesActivityParams {
  aspectRatio?: AspectRatio
  keyframeImageModel?: string
  projectId: string
  promptRoute?: LongTakePromptRoute
  shotPlanPath: string
  styleText?: string
  userId?: string
}

export interface GenerateLongTakeKeyframesActivityResult {
  frameCount: number
  keyframesPath: string
}

export interface GenerateLongTakeMotionPromptsActivityParams {
  panels: Array<{ description: string; panelId: string }>
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  userId: string
}

export interface GenerateLongTakeMotionPromptsActivityResult {
  motionPrompts: string[]
  outputPath: string
}

export interface GenerateLongTakeScriptActivityParams {
  projectId: string
  script: string
  userEmail?: string
  userId: string
}

export interface GenerateLongTakeScriptActivityResult {
  scriptPath: string
}

export interface GenerateLongTakeSingleRawAnchorAssetActivityParams {
  assetTask: LongTakeAnchorAssetTask
  generationResolution?: GenerationResolution
  imageModel?: string
  orgId?: string
  projectId: string
  styleText?: string
  userId: string
}

export type GenerateLongTakeSingleRawAnchorAssetActivityResult = LongTakeRawAnchorAssetItem

export interface GenerateLongTakeTransitionVideoActivityParams {
  admissionTier?: LongTakeAdmissionTier
  aspectRatio?: AspectRatio
  beatBoundarySeconds?: number
  /** Camera style (Calm when absent): Dynamic writes timed-beat Hailuo prompts. */
  cameraStyle?: CameraStyle
  /** Save the finished clip's last frame and return it as `lastFrameUri` (chained transitions). */
  captureLastFrame?: boolean
  /** Position of this clip in the video, for the Dynamic camera-move rotation. */
  clipIndex?: number
  debugSettings?: DebugSettings
  dropFirstFrame?: boolean
  durationSeconds: number
  endMs: number
  firstFrameUri: string
  fromAudio?: string
  fromKeyframePrompt?: string
  fromPrompt?: string
  fromShotId: string
  /** Per-project generation-resolution setting; resolved (value > default) in the activity. */
  generationResolution?: GenerationResolution
  globalScript?: string
  improvedVisualScriptEnabled?: boolean
  intermediateKeyframeUris?: string[]
  isNewStyleTransfer?: boolean
  /**
   * Absent for a Story Mode 3.0 `cut` clip, which is generated
   * i2v-only from its opening frame; the cut itself is made by timeline
   * adjacency at render. Always set on every V2 path.
   */
  lastFrameUri?: string
  /** Org id that owns the project. */
  orgId?: string
  /** File name for the clip under `long_take/transitions/` (default: the transition id). */
  outputName?: string
  pipelineContext?: PipelineContextEntry[]
  /** A prompt already rewritten for the model; skips the per-clip rewrite (chained transitions). */
  preparedPrompt?: string
  projectId: string
  prompt: string
  promptRoute?: LongTakePromptRoute
  referenceAssetIds?: string[]
  seedance25MergedSegment?: boolean
  shouldLipSync?: boolean
  skipPromptRewrite?: boolean
  startMs: number
  staticHoldFallbackOnAllBlack?: boolean
  styleText?: string
  toAudio?: string
  toKeyframePrompt?: string
  toPrompt?: string
  toShotId: string
  transitionId: string
  transitionVideoModel?: string
  userEmail?: string
  userId?: string
}

export type GenerateLongTakeTransitionVideoActivityResult = LongTakeTransitionVideoItem

export interface GenerateLongTakeVisualNotesActivityParams {
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  userId: string
  userPrompt?: string
}

export interface GenerateLongTakeVisualNotesActivityResult {
  noteCount: number
  notesPath: string
}

export interface GenerateLongTakeVisualScriptActivityParams {
  cameraStyle?: CameraStyle
  perfectLoop?: boolean
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  /**
   * Read the asset manifest tolerantly (missing file -> zero assets) instead of failing the
   * activity. Set by the UIP non-fast regeneration path, where the confirm-time handoff
   * legitimately skips asset_manifest.json when the planner produced no anchor candidates.
   */
  tolerateMissingAssetManifest?: boolean
  transitionVideoModel?: string
  userId: string
  userPrompt?: string
  visualScriptTemperature?: number
}

export interface GenerateLongTakeVisualScriptActivityResult {
  itemCount: number
  visualScriptPath: string
}

export interface GenerateLongTakeVoiceoverActivityParams {
  audioPath?: string
  /**
   * What kind of audio `audioPath` points at, which decides whether the ASR of
   * that audio is held to `confirmedScript`.
   *
   * `tts_preview` is machine-generated narration handed off from the UIP
   * transcript preview: it is supposed to say exactly `confirmedScript`, so it
   * goes through the same insertion/truncation gate as freshly generated TTS.
   * `user_upload` -- the default when omitted -- is the user's own
   * recording, where diverging from the script is normal and must never be
   * gated. Only set this to `tts_preview` for audio a TTS provider produced.
   */
  audioSource?: 'tts_preview' | 'user_upload'
  /** User-confirmed script text. When provided for uploaded-audio flows, this is
   *  written to script.txt instead of the server-side ASR result so the transcript
   *  displayed in the viewer matches what the user approved. */
  confirmedScript?: string
  /**
   * The org the project belongs to, forwarded to the provider router so the
   * org-bucketed `fal_voice_clone` gate can be evaluated at render time.
   *
   * Load-bearing, not telemetry: `feature-flag.ts` OMITS the 'Org ID' custom ID entirely
   * when this is empty, so an org-targeted rule cannot match and the gate returns a plain
   * `false`. Without it every catalog preset silently rendered on MiniMax while the preview
   * path -- which has the request org -- sent the same voice to fal.
   */
  orgId?: string
  projectId: string
  /** When true, this activity writes the RAW ASR transcript to storage and the
   *  workflow runs a separate `correctLongTakeTranscript` activity afterwards
   *  so correction failures surface on their own. Default (undefined / false) keeps
   *  the legacy combined behavior. */
  skipCorrection?: boolean
  userEmail?: string
  userId: string
  voiceId?: string
}

export interface GenerateLongTakeVoiceoverActivityResult {
  audioDurationSeconds?: number
  fasterTtsApplied?: boolean
  fasterTtsCohort?: 'faster_tts' | 'legacy' | 'not_evaluated'
  fasterTtsEvaluated?: boolean
  fasterTtsPostWpm?: number
  fasterTtsPreWpm?: number
  fasterTtsRatio?: number
  fasterTtsSkipReason?:
    | 'already-fast'
    | 'asr-failed'
    | 'flag-off'
    | 'invalid-wpm'
    | 'speedup-failed'
    | 'tts-cache-hit'
    | 'uploaded-audio'
    | 'voice-clone'
  fasterTtsTargetWpm?: number
  fasterTtsWasCapped?: boolean
  scriptText?: string
  transcriptPath?: string
  ttsProvider?: 'byteplus' | 'elevenlabs' | 'fal' | 'gemini' | 'kokoro' | 'minimax' | 'qwen3'
  voiceOverPath?: string
  voiceSubstituted?: boolean
}

export interface GenerateV3ClipPromptsActivityParams {
  /** Rendered opening frame per shot id; a shot without one is skipped by the vision call. */
  keyframeUriByShotId: Record<string, string>
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  shotPlan: LongTakeShotPlanItem[]
  styleText?: string
  userId: string
}

export interface GenerateV3ClipPromptsActivityResult {
  clipPrompts: Array<{
    motionPrompt: string
    shotId: string
    /** Non-null only for a `continuous` hand-off. */
    transitionPrompt: null | string
  }>
  /** True when the model call failed and every prompt fell back to its description. */
  usedFallback: boolean
}

export interface GenerateV4ScriptActivityParams {
  hasUserLengthRequest: boolean
  maxWords: number
  projectId: string
  rawInput: string
  targetWords: number
  userId: string
}

export interface GenerateV4ScriptActivityResult {
  script: string
}

export interface GetLongTakeConcurrencyActivityParams {
  projectId: string
  userId: string
}

export interface GetLongTakeConcurrencyActivityResult {
  imageConcurrency: number
  videoConcurrency: number
}

export interface IdeateVisualTreatmentActivityParams {
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  userId: string
}

export interface IdeateVisualTreatmentActivityResult {
  expertRecommendations: string
  outputPath: string
}

export interface IdentifyLongTakeIntentActivityParams {
  projectId: string
  userId: string
  userPrompt: string
}

export interface IdentifyLongTakeIntentActivityResult {
  intentAnalysis: string
  outputPath: string
}

export interface IdentifyLongTakeStyleActivityParams {
  intentAnalysis: null | string
  projectId: string
  styleReferenceImageUrls: string[]
  styleText?: string
  userId: string
  userPrompt: string
}

export interface IdentifyLongTakeStyleActivityResult {
  colorPalette: Record<string, { hex: string; percentage: string }>
  keyStyleTags: string[]
  outputPath: string
  reproductionGuidance: null | string
  reusableStylePrompt: string
  styleDescription: string
}

export interface LongTakeAnchorAssetTask {
  asset_id: string
  keyword: string
  printed_text?: string[]
  prompt_text: string
  proper_name?: null | string
  reference_image_uris: string[]
  source_file_ids: string[]
  source_image_uris: string[]
  source_passthrough?: boolean
  type: 'Character' | 'Prop'
  visual_reference: string
}

export interface LongTakeKeyframeItem {
  fallbackFromShotId?: string
  finalPrompt?: string
  hasGibberish?: boolean | null
  imageModel?: string
  keyframeUrl: string
  reframe?: boolean | null
  shotId: string
  thumbnailUrl?: null | string
  upsideDown?: boolean | null
  usedFallback?: boolean
}

export interface LongTakePromptClassification {
  is_music?: boolean
  music_genre?: string
  music_genre_confidence?: number
  topic: string
  topic_confidence: number
  use_case: string
  use_case_confidence: number
}

export interface LongTakeRawAnchorAssetItem {
  anchor_uri: null | string
  asset_id: string
  prompt_text: string
  source_file_ids: string[]
  source_image_uris: string[]
  source_passthrough?: boolean
  status: 'failed' | 'success'
}

export interface LongTakeShotPlanItem {
  audio: string
  // New fields for three-phase prompts
  entry_prompt?: string
  exit_prompt?: string
  human_presence?: LongTakeHumanPresence
  keyframe_prompt: string
  requires_lip_sync?: boolean
  shot_id: string
  time_range: {
    end: number
    start: number
  }
  /**
   * Story Mode 3.0 hand-off to the next shot. Decides whether this
   * shot's clip is generated i2v-only (`cut`, the cut is made by timeline
   * adjacency at render) or first-and-last-frame (`continuous`). Absent on
   * every V2 shot plan.
   */
  transition_to_next?: 'continuous' | 'cut' | null
  used_asset_id?: string[]
  video_prompt: string
}

export interface LongTakeStageCostSummary {
  completedAt: string
  costNano: number
  durationMs: number
  stage: LongTakeStatusStage
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

export interface LongTakeStyledAnchorAssetItem {
  anchor_uri: null | string
  asset_id: string
  effective_anchor_uri: null | string
  prompt_text: string
  raw_anchor_uri: null | string
  source_file_ids: string[]
  source_image_uris: string[]
  source_passthrough?: boolean
  status: 'failed' | 'fallback_raw' | 'raw_only' | 'styled'
  styled_anchor_uri: null | string
}

export interface LongTakeUserAssetCatalogItem {
  aliases: string[]
  fileId: string
  mime: string
  shortname: string
  storageUri: string
}

export interface LongTakeWorkflowParams {
  admissionTier?: LongTakeAdmissionTier
  aspectRatio?: AspectRatio
  audioPath?: string
  /**
   * Persisted BGM user toggle threaded from the project row at
   * workflow start. Bed generation is attempted only when this is true and the
   * project is not a music project. Absent/false => no BGM for the run.
   */
  bgmEnabled?: boolean | null
  /** The user's wish for the music (a preset mood or their words), fed to the bed director. */
  bgmNote?: null | string
  /** A chosen track (library or the user's own) to fit instead of generating a bed. */
  bgmTrack?: BgmTrackArg | null
  /** Camera style (Calm when absent): Dynamic clip prompts and 3-6s shot pacing. */
  cameraStyle?: CameraStyle
  customStyle?: boolean
  debugSettings?: DebugSettings
  enableCaption?: boolean | null
  /**
   * Per-project generation-resolution setting: API option resolved
   * server-side, pinned for the whole project. Activities apply precedence
   * (this value > defaults); the final render canvas stays 1080p.
   */
  generationResolution?: GenerationResolution
  imageModel?: string
  /**
   * Raw client image-model selection, telemetry-only. Set on the direct
   * (Path 2) start path so the started event can report what the user picked
   * before validation. The UIP path persists only the resolved value, so this
   * is absent there (D1).
   */
  imageModelSelected?: string
  isStyleCopy?: boolean
  keyframeImageModel?: string
  /** Final normalized model-selector tier, tracking-only. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  orgId?: string
  perfectLoop?: boolean
  projectId: string
  queuedAtMs?: number
  remixProjectId?: string
  requestedDurationSeconds?: number
  script: string
  scriptGeneratorPath?: LongTakeScriptGeneratorPath
  /**
   * Channel that initiated this Story Mode start: 'mcp' (agent MCP server) or
   * 'web' (web app direct). Absent on rerun/playground paths => 'unknown' at
   * tracking. Lets project.long_take.started/.completed break down by channel
   * without a projectId join.
   */
  source?: 'mcp' | 'web'
  startPaused?: boolean
  styleName?: string
  styleReferenceImageUrls?: string[]
  styleText?: string
  transitionVideoModel?: string
  userAssetCatalog?: LongTakeUserAssetCatalogItem[]
  userEmail?: string
  userId: string
  userPrompt: string
  /** @deprecated Fully rolled out. Remove after in-flight workflows drain. */
  useV4Architecture?: boolean
  v4Category?: string
  v4PreviewContextId?: string
  v4Track?: string
  visualScriptTemperature?: number
  voiceId?: string
}

export interface PersistLongTakeBgmBedActivityParams {
  /** The non-null result returned by generateLongTakeBgmBed. */
  bed: GenerateLongTakeBgmBedActivityResult
  /**
   * Settled status-pill record written alongside the bed swap (the
   * regenerate path passes {status:'done',...}). Omitted on the creation path,
   * which never writes bgmRun -- the card already shows whole-project progress
   * during creation.
   */
  bgmRun?: BgmRunState
  /**
   * Full regen history to persist alongside the swap (prior versions
   * + the new bed appended by the caller). Omitted on the creation path, which
   * predates versioning and writes only the flat bed fields.
   */
  bgmVersions?: BgmVersion[]
  projectId: string
  userEmail?: string
  userId: string
}

export interface RealignV3ShotTimesActivityParams {
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  transitionVideoModel?: string
  userEmail?: string
  userId: string
  visualScriptPath: string
}

export interface RealignV3ShotTimesActivityResult {
  shotCount: number
  shotPlan: LongTakeShotPlanItem[]
  shotTimesPath: string
  timingSource: 'beat_sheet_time_range' | 'lcs_transcript' | 'lcs_transcript_partial'
  /** Shots the transcript alignment could not place; they fell back to the planner's `time`. */
  unalignedShotCount: number
}

export interface RecordLongTakeRuntimeMetadataActivityParams {
  projectId: string
  userEmail?: string
  userId: string
}

export interface RefineLongTakeTransitionPromptsActivityParams {
  globalScript?: string
  projectId: string
  promptRoute?: LongTakePromptRoute
  transitions: LongTakeTransitionPromptRefinementInput[]
  userEmail?: string
  userId: string
}

export interface RefineLongTakeTransitionPromptsActivityResult {
  refinedPrompts: Array<{
    prompt: string
    transitionId: string
  }>
}

export interface RenderLongTakeVideoActivityParams {
  aspectRatio?: AspectRatio
  /**
   * store address of the generated BGM bed (settled from
   * generateLongTakeBgmBed before the render stage). When set, render finalize
   * bakes it under the voiceover before the final video is uploaded; mixing is
   * best-effort and can never fail the render. Absent => no BGM for the run.
   */
  bgmBedUri?: string
  /**
   * The music's Volume % (0-100) with `bgmBedUri`: a loop short's render mixes the music at it
   * in its finish pass, any other video's bake ducks the bed with the music remux's level rule.
   * Absent: the default level.
   */
  bgmVolume?: number
  /**
   * The caption look to draw, from an editor export: the one the user was looking at (null: the
   * video kind's default). Absent: the render reads the look saved on the project.
   */
  captionStyle?: CaptionStyleSettings | null
  enableCaption?: boolean | null
  /** Editor re-renders save the keyframes they rendered, so the editor state matches. */
  keyframesToCommit?: LongTakeKeyframe[]
  projectId: string
  transitionVideos: RenderFinalTransitionVideo[]
  userEmail?: string
  userId: string
}

/** What the API's editor export (`POST /long-take-videos/:id/render`) starts. */
export interface LongTakeEditRenderWorkflowParams {
  aspectRatio?: AspectRatio
  bgmBedUri?: string
  bgmVolume?: number
  keyframes?: LongTakeKeyframe[]
  projectId: string
  settings?: LongTakeRenderSettings
  transitionVideos: RenderFinalTransitionVideo[]
  userEmail?: string
  userId: string
}

export interface RegenerateTransitionItem {
  endMs: number
  firstFrameUri: string
  /** The outgoing shot's narration and scene, for the model-written (editor) path. */
  fromAudio?: string
  fromKeyframePrompt?: string
  fromShotId: string
  lastFrameUri: string
  /** File name for the new clip (`regenerateOutputName`); the id when absent. */
  outputName?: string
  /** The final clip prompt (agent) or the user's instruction (editor). */
  prompt: string
  startMs: number
  toAudio?: string
  toKeyframePrompt?: string
  toShotId: string
  transitionId: string
}

export interface RenderLongTakeVideoActivityResult {
  /**
   * Whether the BGM bed actually reached the delivered video. The
   * bake is best-effort, so a generated bed is not proof of delivery -- the
   * completion event's has_bgm reads this.
   */
  bgmBaked: boolean
  enableCaption: boolean
  renderDurationMs: number
  thumbnailFallbackUsed: boolean
  videoUri?: string
}

export interface SaveLongTakeKeyframesActivityParams {
  keyframes: LongTakeKeyframeItem[]
  projectId: string
}

export interface SaveLongTakeKeyframesActivityResult {
  frameCount: number
  keyframesPath: string
}

export interface SaveLongTakePipelineContextActivityParams {
  pipelineContext: PipelineContextEntry[]
  projectId: string
  userId: string
}

export interface SeedV3PlaygroundShadowActivityParams {
  baselineProjectId: string
  shadowProjectId: string
}

export interface SeedV3PlaygroundShadowActivityResult {
  baselineShotCount: number
  /** The baseline's confirmed voice-over, re-derived from the copied spec. */
  script: string
}

export interface SelectLongTakeTransitionTypesActivityParams {
  orgId?: string
  projectId: string
  promptRoute?: LongTakePromptRoute
  transitions: Array<{
    durationSeconds: number
    fromPrompt: string
    fromShotId: string
    shouldLipSync?: boolean
    toPrompt: string
    toShotId: string
    transitionId: string
  }>
  userId?: string
}

export interface SelectLongTakeTransitionTypesActivityResult {
  selections: Array<{
    transitionId: string
    transitionType: LongTakeTransitionType
  }>
}

export interface SetLongTakeStatusActivityParams {
  concurrentStages?: LongTakeStatusStage[]
  detail?: string
  meta?: Record<string, boolean | number | string>
  projectId: string
  stage: LongTakeStatusStage
  status: 'completed' | 'error' | 'in_progress' | 'rejected'
  userEmail?: string
  userId: string
}

export interface StoryMode3PlaygroundParams {
  /** The finished project whose delivered video is the control arm. */
  baselineProjectId: string
  generationResolution?: GenerationResolution
  imageModel?: string
  orgId?: string
  /**
   * Everything the V3 render workflow needs beyond what the playground derives
   * itself (projectId / script / user identity), forwarded verbatim so the
   * playground never drifts from a real confirm.
   */
  renderParams: Omit<
    import('../uip-to-story-mode/types').UipToStoryModeWorkflowParams,
    | 'projectId'
    | 'script'
    | 'userEmail'
    | 'userId'
    // Both are outputs of the regeneration step, so the workflow fills them in
    // rather than the API guessing them before anything has been generated.
    | 'visualScriptItemCount'
    | 'visualScriptPath'
  >
  /** The hidden project this run generates into; also the run id. */
  shadowProjectId: string
  transitionVideoModel?: string
  userEmail?: string
  userId: string
}

export interface StoryMode3PlaygroundResult {
  error?: string
  manifestPath: string
  shadowProjectId: string
  status: 'completed' | 'failed'
  videoUri?: string
}

export interface WriteV3PlaygroundManifestActivityParams {
  baselineProjectId: string
  baselineShotCount: number
  error?: string
  shadowProjectId: string
  shotCount?: number
  startedAt: string
  status: 'completed' | 'failed'
  /** The render's own output uri, when the run got that far. */
  videoUri?: string
}

export interface WriteV3PlaygroundManifestActivityResult {
  manifestPath: string
}

/** One or more clips of a finished video, redone in place (the editor's "Regenerate shot" and
 *  agent edit mode's `regenerate_clip`). */
export interface RegenerateTransitionWorkflowParams {
  aspectRatio?: AspectRatio
  cameraStyle?: CameraStyle
  /** Write the new clips into the canonical editor state (agent edit mode). The web editor
   *  applies results to its own draft and commits at render, so it leaves this unset. */
  commitToCanonical?: boolean
  projectId: string
  /** The prompt is the final clip prompt (agent edit mode): no LLM rewrite. The editor's
   *  free-text instruction is rewritten by the model as a planned clip is. */
  promptIsFinal?: boolean
  transitionList: RegenerateTransitionItem[]
  transitionVideoModel?: string
  userEmail?: string
  userId: string
}

export type RegenerateTransitionWorkflowResult = {
  results: Array<{
    fileUri: string
    transitionId: string
    videoHeight?: number
    videoWidth?: number
  }>
}
