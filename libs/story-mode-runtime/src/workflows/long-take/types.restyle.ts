import type { LongTakeShotPlanItem } from './types'
import type { LongTakeRegenerateWorkflowParams } from './types.regenerate'

export interface ApplyLongTakeRestyleKeyframePromptsActivityParams {
  projectId: string
  /**
   * Read-only: the source's pre-restyle keyframe prompt bases, used to carry any
   * text a later shot-plan step appended on top of them onto the restyled base.
   */
  sourceProjectId: string
  userId: string
}

export interface ApplyLongTakeRestyleKeyframePromptsActivityResult {
  /** Shots that resolved a regenerated prompt (directly or via their base id). */
  matchedShotCount: number
  /** The reused shot plan with its keyframe prompts re-pointed at the new style. */
  shotPlan: LongTakeShotPlanItem[]
  /** Subset of matchedShotCount whose prompt text actually changed. */
  updatedShotCount: number
}

export interface LongTakeRestyleWorkflowParams extends LongTakeRegenerateWorkflowParams {
  /**
   * Tracking-only, threaded from the source project: whether the newly applied
   * style is a custom (non-preset) one. Defaults to false when absent.
   */
  customStyle?: boolean
  /** Tracking-only, threaded from the source project. Defaults to false. */
  hasAudioUpload?: boolean
  /**
   * Source project's carried image model. Restyle regenerates keyframe images,
   * so unlike the regenerate workflow it needs the model the source used; absent
   * falls back to the keyframe activity's own resolution.
   */
  imageModel?: string
  keyframeImageModel?: string
  /** Applied style identity for tracking / preset-aware keyframe prompting. */
  styleName?: string
}

export interface PrepareLongTakeRestyleTargetActivityParams {
  projectId: string
  /** Read-only: re-copy source for an artifact the bulk folder copy dropped. */
  sourceProjectId: string
  /** The NEW style description the target project is restyled into. */
  styleText?: string
  userId: string
}

export interface PrepareLongTakeRestyleTargetActivityResult {
  styleSourcePath: string
  /** True when the copied visual script was missing and had to be re-copied. */
  visualScriptRecovered: boolean
}
