import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import type { BeatLoopStoryboard } from '@shared/types/api/agent'

import type { BeatLoopFallback } from '../../activities/beat-loop'
import type { LongTakeTransitionVideoItem } from '../long-take/transition-types'

/** What the API's loop-short start (`BeatLoopService.start`) passes, through the admission queue. */
export interface BeatLoopWorkflowParams {
  /** Set by the admission queue. */
  admissionTier?: LongTakeAdmissionTier
  /** The music the user added, when it is on and audible: the render mixes it under the loop. */
  bgmBedUri?: string
  /** Its Volume % (0-100), with `bgmBedUri`. */
  bgmVolume?: number
  /** The loop's captions and stamps; on unless the project turned captions off. */
  enableCaption?: boolean | null
  orgId?: string
  projectId: string
  /** Set by the admission queue. */
  queuedAtMs?: number
  /** Set by the admission queue: wait for its start signal. */
  startPaused?: boolean
  /** Already validated (`validateBeatLoopStoryboard`). */
  storyboard: BeatLoopStoryboard
  /** The look: the storyboard's style, or the one picked for it. */
  style: string
  userEmail?: string
  userId: string
  /** The voice for every line; the default voice when unset. */
  voiceId?: string
}

/** A clip kept although it still fails a check, with one sentence per failed check. */
export interface BeatLoopFlaggedClip {
  clipId: string
  failures: string[]
}

/** A clip this run made on the other provider's model: its first model's call failed on it. */
export interface BeatLoopOtherModelClip extends BeatLoopFallback {
  clipId: string
}

export interface BeatLoopWorkflowResult {
  /** Clips kept although they still fail a check, for the reply to name. */
  flaggedClips: BeatLoopFlaggedClip[]
  /** Clips this run made on the other provider's model (at its price), for the reply to name. */
  otherModelClips: BeatLoopOtherModelClip[]
  /** Re-rolls that went into the kept clips. */
  rerolls: number
  /** Clips reused from an earlier run of the same project. */
  resumedClips: number
  status: 'completed'
  videoUri?: string
}

/** A clip the loop is made of: its kept take, as the chain and the render read it. */
export interface KeptBeatLoopClip {
  clipId: string
  clipIndex: number
  /** One plain sentence per check the kept take still fails. */
  failures: string[]
  /** Clip 1's real first frame: the loop seam is checked against it. */
  firstFrameUri?: string
  /** Kept although it still fails a check (its re-roll failed too, or none was left). */
  flagged: boolean
  keptTake: number
  /** Where the next clip starts. */
  lastFrameUri?: string
  model: string
  /** Takes after the first that went into this clip. */
  rerolls: number
  /** When the kept take was made (a stored take without a start frame is chained by time). */
  startedAt?: string
  transition: LongTakeTransitionVideoItem
}
