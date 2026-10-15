import type { PipelineContextEntry } from '@reelmakeeasy/common/job-context'
import type { CameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import type { AspectRatio, GenerationResolution } from '@reelmakeeasy/common/media/types'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import { DebugSettings } from '@shared/types/project/debug-settings'

import type { LongTakePromptRoute } from '../../long-take-prompt-router'

import type { LongTakeKeyframeItem, LongTakeShotPlanItem } from './types'

export interface CopyLongTakeSourceArtifactsActivityParams {
  /** The new project the copied artifacts land on. */
  projectId: string
  /** The finished project whose artifacts are reused. */
  sourceProjectId: string
  userId: string
}

export interface CopyLongTakeSourceArtifactsActivityResult {
  keyframeCount: number
}

export interface LoadLongTakeRegenerateInputsActivityParams {
  projectId: string
  userId: string
}

export interface LoadLongTakeRegenerateInputsActivityResult {
  audioDurationSeconds: number
  globalScript?: string
  keyframes: LongTakeKeyframeItem[]
  pipelineContext?: PipelineContextEntry[]
  promptRoute?: LongTakePromptRoute
  shotPlan: LongTakeShotPlanItem[]
}

export interface LongTakeRegenerateWorkflowParams {
  admissionTier?: LongTakeAdmissionTier
  aspectRatio?: AspectRatio
  /**
   * Absolute store:// URI of the source project's settled BGM bed
   * (Project.bgmBedUri). Threaded straight into render finalize so the bed
   * is baked under the voiceover; absent means no BGM for the run.
   */
  bgmBedUri?: string
  cameraStyle?: CameraStyle
  debugSettings?: DebugSettings
  enableCaption?: boolean | null
  generationResolution?: GenerationResolution
  /** Threaded from the API so the completed event reports the same audio-upload cohort as `project.long_take.started`. */
  hasAudioUpload?: boolean
  /** Final normalized selector tier inherited by the regenerated project. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  orgId?: string
  perfectLoop?: boolean
  /** The NEW project the regenerated video lands on. */
  projectId: string
  queuedAtMs?: number
  /** The finished project whose artifacts are reused through keyframes. */
  sourceProjectId: string
  startPaused?: boolean
  styleText?: string
  transitionVideoModel?: string
  userEmail?: string
  userId: string
}
