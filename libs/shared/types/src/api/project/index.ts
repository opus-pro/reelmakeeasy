import { PROJECT_STAGE } from '../../enums/project'
import type { ModelSelectorAnalyticsTier } from '../../model-selector-analytics-tier'
import { DebugSettings } from '../../project/debug-settings'
import type { CaptionStyleSettings } from '../caption-style'
import { PaginatedResponse } from '../common/pagination'
import { ValueOf } from '../common/type-util'
import type { VoiceProfile } from '../voice-profile'

import { ProjectScene } from './project-scene'

export type AspectRatio = '1:1' | '9:16' | '16:9'

export type ProjectTier = 'LITE' | 'PRO'

export type UipCardStatus = {
  // Awaiting user: is_idle or an open review gate
  needsInput: boolean
  // UipSession.phase (PlannerPhase value) or null
  phase: null | string
  // Planner loop actively running
  thinking: boolean
}

// Base voice configuration shared across different contexts
export type BaseVoiceConfig = {
  labels?: string[]
  name: string
  previewAudioUrl?: string
  provider?: string // 'byteplus' | 'elevenlabs' | 'gemini' | 'minimax'
  voiceCloneId?: string
  voiceId: string
  voiceProfile?: VoiceProfile
}
export type Project = ProjectForBackend & {
  aspectRatio: '1:1' | '9:16' | '16:9'
  createdAt: string
  lastSeenAt?: null | string
  processingSeenAt?: null | string
  resultVideoThumbnail?: string
  routePrefix?: string
  updatedAt: string
}
export type ProjectCreateRequestBody = {
  attachmentIds?: string[]
  avatarId?: string
  // Story-mode "Background music" toggle at creation. Only sent by
  // the FE when the enable_bgm gate is on; persisted onto Project.bgmEnabled.
  bgmEnabled?: boolean
  /** The user's wish for the music (a preset mood or their words); fed to the bed director. */
  bgmNote?: string
  /** Where the bed comes from: 'generated' | 'library' | 'upload'. */
  bgmSource?: null | string
  /** The library track id or the user's track id, with bgmSource library/upload. */
  bgmTrackId?: null | string
  // Story Mode project type chosen at creation (a CreateUseCaseKey value, e.g.
  // 'script-to-video' | 'song-to-video' | 'audio-to-video' | 'animation-style-ad').
  // Typed as string so libs/shared/types need not depend on the web app constant.
  /** Camera style for long-take clips (Calm when absent). */
  cameraStyle?: 'calm' | 'dynamic'
  createUseCase?: string
  debugSettings?: DebugSettings
  enableCaption?: boolean
  hookId?: string
  hookTemplateName?: string
  initialText?: string
  isLongTake?: boolean
  longTakeInput?: 'audio' | 'transcript'
  longTakeRatio?: AspectRatio
  /** Final normalized model-selector tier snapshotted at Story Mode submission. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  projectTier?: ProjectTier
  script?: string
  style?: {
    id: string
  }
  styleName?: string
  styleText?: string
  styleThumbnailUrl?: string
  // Voice configuration
  voice?: ProjectVoiceOverJson
}

export const PROJECT_ENV = {
  DEV: 'DEV',
  STG: 'STG',
  PRD: 'PRD',
} as const

export type ExpiryPlanTier = 'free' | 'max' | 'pro'

export type ProjectEnv = ValueOf<typeof PROJECT_ENV>

/**
 * One entry in Project.bgmVersions: the Story Mode BGM regeneration history.
 * Appended on each regenerate by the editor backend.
 */
export type BgmVersion = {
  /**
   * Bed->voice parity gain in dB measured when this bed was generated.
   * Absent on entries written before version switching shipped:
   * applying one of those clears Project.bgmBedGainDb, and the live preview
   * falls back to the legacy linear volume curve. The baked export is
   * unaffected either way -- the re-mux measures the gain itself.
   */
  bedToVoiceGainDb?: number
  createdAt: string
  model: string
  prompt: string
  /** Where this bed came from; absent on entries written before the library shipped (generated). */
  source?: 'generated' | 'library' | 'upload'
  /** The library track id or UserMusicTrack id it was fitted from. */
  trackId?: string
  trackName: string
  uri: string
}

/**
 * Project.bgmRun: the persisted "BGM job in flight" record behind
 * the project-card status pill. Workflow-owned -- written at regen start,
 * settled by the bed persist patch, cleared to null on failure. The done
 * state renders only while settledAt > Project.processingSeenAt.
 */
export type BgmRunState = {
  kind: 'generate' | 'regenerate'
  settledAt?: string
  startedAt: string
  status: 'done' | 'running'
}

/**
 * Project.upscale4kRun: the persisted "4K export in flight" record
 * behind the project-card status pill and the Activity rows. The sibling of
 * BgmRunState, deliberately the same shape so one resolver serves both.
 *
 * Workflow-owned: stamped at export start, settled by the export's terminal
 * patch, cleared to null when the start fails. The done state renders only
 * while settledAt > Project.processingSeenAt, the acknowledgement both job
 * kinds share.
 *
 * `kind` has a single member today. It exists so the pill's label map stays
 * keyed the same way BgmRunState's is, and so a second kind of 4K job (a
 * re-composite, say) can be told apart without a schema change.
 */
export type ProjectForBackend = {
  /** The agent chat that made this project; cleared when that chat is deleted. */
  agentSessionId?: null | string
  agentVersion?: '1.0' | '2.0'
  avatarId?: string
  // BGM (Story Mode background music) data contract: persisted on the
  // project, read by the editor/export and written by creation/generation/editor.
  // Exposed unconditionally (null until generation writes them); consumers gate
  // *rendering* on `enable_bgm`. bgmDuckDb = positive dB attenuated below the voice.
  bgmBedCdnUrl?: null | string
  /** Bed->voice loudness parity gain in dB; drives the live preview curve. */
  bgmBedGainDb?: null | number
  bgmBedUri?: null | string
  bgmDuckDb?: null | number
  bgmEnabled?: boolean
  bgmModel?: null | string
  /** Status-pill run record; see BgmRunState. */
  /** The user's wish for the music; null = none (the director decides). */
  bgmNote?: null | string
  bgmPrompt?: null | string
  bgmRun?: BgmRunState | null
  bgmSource?: null | string
  bgmTrackId?: null | string
  bgmTrackName?: null | string
  bgmVersions?: BgmVersion[]
  bgmVolume?: null | number
  /** Camera style for long-take clips: 'dynamic' or 'calm'; null on older rows means calm. */
  cameraStyle?: null | string
  /**
   * The caption look the user picked (Json column); null = never chosen. Read it with
   * readCaptionStyleSettings, which drops malformed fields.
   */
  captionStyle?: CaptionStyleSettings | null
  codeCdnUrl?: string
  createdAt: Date
  /** 'agent' when agent mode (the user's local Codex) made this project. */
  createdVia?: null | string
  /** Original creation billing duration; retained by Reimagine descendants. */
  creationBilledDurationSeconds?: null | number
  debugSettings?: unknown // MongoDB Json type
  duration?: null | number // seconds; null on pre-rendered rows, populated by render-finalize
  enableCaption?: boolean
  /** default: DEV */
  env?: ProjectEnv
  expiresAt?: Date | null // stored anchor; null = never (Max OR unresolved)
  expiryPlanTier?: ExpiryPlanTier | null
  /** Reason code when stage is FAILED. Frontend maps to user-facing message. */
  failedReason?: string
  /** True after the first-user-message onboarding reply (video plan intro) was sent */
  firstMessageReplySent?: boolean
  /**
   * Per-project generation-resolution setting; Json column shaped
   * as { videoResolution?, imageSize? }. Sanitized on read before use.
   */
  generationResolution?: null | { imageSize?: string; videoResolution?: string }
  hardDeleteAt?: Date | null
  hookId?: string
  hookTemplateName?: string
  id: string
  /** User-selected image generation model id; persisted via uip.imageModel column. */
  imageModel?: null | string
  initPrompt: string
  /** Derived from the uip session timeline; see deriveBrandTelemetry. Batch-computed for list responses by enrichWithBrandVideo. */
  isBrandVideo?: boolean
  isCustomName?: boolean
  isDeleted?: boolean
  isLongTake?: boolean
  isUip?: boolean
  lastSeenAt?: Date | null
  lifecycleStatus?: null | ProjectLifecycleStatus
  lockedAt?: Date | null
  longTakeInput?: 'audio' | 'transcript'
  longTakeRatio?: AspectRatio
  /** Final normalized model-selector tier used for lifecycle analytics. */
  modelSelectorTier?: ModelSelectorAnalyticsTier | null
  modelSwitch?: Record<string, Record<string, string>>
  name: string

  orgId: string
  owner?: string // owner user id
  ownerEmail?: string

  paused?: boolean
  previewThumbnail?: string
  /**
   * User acknowledgement timestamp for finished background jobs (the
   * status pill's done state). Set on project open, never by workflows.
   */
  processingSeenAt?: Date | null
  projectTier?: ProjectTier
  purgedAt?: Date | null
  rerunFrom?: string
  rerunTo?: string
  researcherRefId?: string
  resultVideo?: string
  /**
   * Delivered 4K variant CDN urls, patched onto the project by the 4K export
   * workflow's finalize stage. Captioned vs no-caption mirror the
   * 1080p `resultVideo` pair; the FE reads these to detect a ready 4K download.
   */
  resultVideo4k?: string
  /**
   * Legacy captions-off 4K url from the caption-scoped-pair era. New
   * finalizes null it (single canonical artifact); read only as a
   * mixed-deploy fallback.
   */
  resultVideo4kNocaption?: null | string
  resultVideo4kThumbnail?: string
  resultVideoThumbnail?: string
  /**
   * Image model a PT-eligible project actually rendered on, written once by the
   * worker. Reused on rerun so regeneration reproduces the same
   * model instead of re-deciding PT routing.
   */
  routedImageModel?: null | string
  scenes?: ProjectScene[]
  script?: string

  scriptConfirmed?: boolean

  scriptRefId?: string
  /** Populated only on search responses (GET /project?search=...). Absent otherwise. */
  searchMeta?: ProjectSearchMeta
  /** Write-once vector-search source: truncated script snapshot taken at first FINISHED. */
  searchText?: string
  stage?: ProjectStage
  storyboardReady?: boolean

  storyboardRefId?: string
  style?: {
    id: string
  }
  styleName?: string
  styleText?: string
  styleThumbnailUrl?: string
  uip?: UipCardStatus
  updatedAt: Date
  // Legacy 4K export state; read-only now that 4K export is gone.
  upscale4k?: null | {
    completedAt?: string
    /**
     * The caption+BGM variant whose bytes are the ONE 4K file on disk
     * (single-artifact) - the API's ready/recomposite discriminator.
     */
    lastVariantKey?: string
    masterCacheKey?: string
    variantKeys?: string[]
    workflowId?: string
  }
  /** Status-pill run record; see Upscale4kRunState. */
  upscale4kRun?: null | Upscale4kRunState
  userId: string
  /** Version counter for Video Plan Card refId */
  viralHookRefId?: string
  //  | string
  /**
   * Story Mode voice-over track, derived per read rather than stored, so the
   * browser receives a finished URL and never composes the storage path itself.
   */
  voiceoverAudioUrl?: null | string
  voiceOverJson?: ProjectVoiceOverJson
  watermarkVideo?: string
}

export type ProjectLifecycleStatus = 'ACTIVE' | 'HARD_DELETED' | 'LOCKED'

export type ProjectPaginatedResponse = PaginatedResponse<Project>

export type ProjectSearchMatchedField = 'initPrompt' | 'name' | 'script'

export interface ProjectSearchMeta {
  matchedField?: ProjectSearchMatchedField
  score: number
  snippet?: { field: 'script'; text: string }
}

export type ProjectStage = ValueOf<typeof PROJECT_STAGE>
export type Upscale4kRunState = {
  kind: 'export'
  settledAt?: string
  startedAt: string
  status: 'done' | 'running'
}

// Voice configuration with type for projects
export type ProjectVoiceOverJson = BaseVoiceConfig & {
  type: 'voice-cloned' | 'voice-over' | 'voice-over-attachment'
}

// Export commonly used voice config types
export type VoiceConfig = ProjectVoiceOverJson

// Export ongoing projects types

export const PROJECT_LIST_QUERY_TYPE = {
  ALL: 'all',
  BY_USER: 'by-user',
  /** story mode projects */
  STORY_MODE: 'story-mode',
  ME: 'me',
} as const

export type ProjectListQueryType = ValueOf<typeof PROJECT_LIST_QUERY_TYPE>

export const PROJECT_LIST_SORT_TYPE = {
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
} as const
export const PROJECT_STAGE_FILTER = {
  ALL: 'all',
  NON_ONGOING: 'nonOngoing',
  ONGOING: 'ongoing',
} as const

export const PROJECT_SEEN_FILTER = {
  ALL: 'all',
  UNSEEN: 'unseen',
} as const
export type ProjectAnalysisCallbackBody = {
  averageScore: number
}

export type ProjectListSortType = ValueOf<typeof PROJECT_LIST_SORT_TYPE>
export type ProjectSeenFilter = ValueOf<typeof PROJECT_SEEN_FILTER>
export type ProjectStageFilter = ValueOf<typeof PROJECT_STAGE_FILTER>
