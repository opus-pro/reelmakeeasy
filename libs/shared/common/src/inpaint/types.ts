import type { LongTakeKeyframe } from '@shared/types/api/long-take'

import type { RenderFinalTransitionVideo } from '../long-take/render-final.types'
import type { InpaintModelFamily, VideoGenModel } from '../video-models'

export type InpaintCallType = 'direct' | 'eraser' | 'segment_i2v' | 'segment_v2v'

export type InpaintMode = {
  modelFamily: InpaintModelFamily
  strategy: InpaintStrategy
}

// Defined with the capability registry: the family taxonomy is model
// data, and keeping it there is what lets video-models/ derive the per-family
// rows without importing back into inpaint/.
export type { InpaintModelFamily } from '../video-models'

export interface InpaintSegmentParams {
  aspectRatio: string
  callType: InpaintCallType
  durationSeconds: number
  firstFrameUrl?: string
  imageUrls?: string[]
  lastFrameUrl?: string
  model: VideoGenModel
  /** Opaque string to bust the storage cache and force a new generation (roll dice). */
  nonce?: string
  projectId: string
  /** Raw user prompt (e.g. "make the car red"). The activity prepends the system template. */
  prompt: string
  referenceVideoUrl?: string
  /** Deterministic per-provider seed (byte-dance/seedance only) to force a different generation without changing the prompt. */
  seed?: number
  /** Post-generation speed correction: >1 speeds up, <1 slows down to hit the target slot duration. */
  speedFactor?: number
}

export type InpaintStrategy = 'boundary_end' | 'boundary_start' | 'direct' | 'split' | 'split_plus'

// --- storage history types ---

export type InpaintHistoryBase = {
  // Marker sets carried by the base state. Persisted histories never set these
  // (their base predates any marker op); only the truncated public projection
  // populates them, so markers from dropped diffs survive the cut.
  appliedEditIds?: string[]
  hiddenEditIds?: string[]
  id: string
  keyframes: LongTakeKeyframe[]
  transitions: RenderFinalTransitionVideo[]
}

export type InpaintHistoryData = {
  base: InpaintHistoryBase
  currentId: string // always valid; equals base.id when at base
  diffs: Record<string, InpaintHistoryDiff>
  latestId: string // tip of main branch; used to build idList for default redo
}

export type InpaintHistoryDiff = {
  createdAt: number
  id: string
  ops: Op[]
  prevId: string // points to parent diff.id or base.id (never null)
}

export type Op =
  // set_edit_hidden is a soft-delete marker for an edit. It carries no
  // transition/keyframe change; it only flips an edit's hidden flag, derived
  // into HistoryState.hiddenEditIds.
  | { editId: string; hidden: boolean; type: 'set_edit_hidden' }
  // set_edit_applied marks that an edit was applied (its result written into the
  // timeline). It carries no transition/keyframe change -- those ride on the
  // apply_transition / apply_keyframe ops in the same diff -- and only derives into
  // HistoryState.appliedEditIds. Distinguishes an applied edit from a merely hidden
  // (dismissed) one (which both also emit set_edit_hidden). No un-apply: undo reverts
  // via the history chain.
  | { editId: string; type: 'set_edit_applied' }
  // mark_restore tags a diff as a version restore rather than an edit apply. Like the
  // other marker ops it changes no transition/keyframe state; the reducer ignores it.
  // Histories written before this op existed simply lack it, so its absence means
  // "not a restore" and no migration is needed.
  | { keyframe: LongTakeKeyframe; type: 'apply_keyframe' }
  | {
      transitionId: string
      type: 'apply_transition'
      videoHeight?: number
      videoUri: string
      videoWidth?: number
    }
  | { type: 'mark_restore' }
