// BGM editor-backend workflow/activity types (settings re-mux + bed
// regeneration), split out of types.ts to keep it under its line budget --
// re-exported there so existing `./types` imports keep resolving.

import type { BgmVersion } from '@shared/types/api/project'

import type { BgmTrackArg } from './types'

// Regenerate the bed on demand from the music panel. Unlike the
// settings remux this is NOT started with TERMINATE_EXISTING: concurrent starts
// fail and the API surfaces "already in progress".
export interface LongTakeBgmRegenerateWorkflowParams {
  /** Persisted panel settings at start time; drive the post-swap delivery remux. */
  bgmEnabled: boolean
  /**
   * When the API stamped the Project.bgmRun 'running' record; the
   * settle patch echoes it so the record keeps one consistent startedAt.
   */
  bgmRunStartedAt?: string
  bgmVolume: number
  /** Target bed length in seconds (the delivered video duration). */
  durationSec: number
  /** Prior regen history (seeded with the current bed by the API); the new bed is appended. */
  existingVersions: BgmVersion[]
  orgId?: string
  projectId: string
  /** User-edited Lyria prompt; absent => a fresh director take. */
  prompt?: string
  /** True when the project has a delivered video to rebuild after the swap. */
  remuxDelivered: boolean
  /** A chosen track to fit instead of generating; `prompt` is then ignored. */
  track?: BgmTrackArg
  userEmail?: string
  userId: string
  /** The project's music wish, for a director take (no prompt). */
  userRequest?: string
}

export interface LongTakeBgmRegenerateWorkflowResult {
  applied: 'regenerated' | 'skipped_gate'
  bedCdnUrl?: string
  remux?: RemuxLongTakeBgmActivityResult
  trackName?: string
}

// Rebuild the delivered video (and watermark variant) at the
// persisted BGM settings. The API passes the settings it just persisted so a
// superseding start (TERMINATE_EXISTING on the shared workflow id) always
// republishes the latest user intent.
export type LongTakeBgmRemuxWorkflowParams = RemuxLongTakeBgmActivityParams

export type LongTakeBgmRemuxWorkflowResult = RemuxLongTakeBgmActivityResult

export interface RemuxLongTakeBgmActivityParams {
  /** Required when bgmEnabled with a non-zero volume; the bed to mix. */
  bgmBedUri?: string
  bgmEnabled: boolean
  /** Panel slider value on the 0-100 scale; 0 delivers voiceover-only. */
  bgmVolume: number
  projectId: string
  userEmail?: string
  userId?: string
}

export interface RemuxLongTakeBgmActivityResult {
  applied: 'mixed' | 'voiceover_only'
  /** Bed gain applied on the mixed path. */
  gainDb?: number
  /** False when the project has no watermark variant to republish. */
  watermarkUpdated: boolean
}
