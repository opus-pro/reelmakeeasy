import { MIN_V2V_REF_SEC } from '../video-models'

import type { InpaintModelFamily, InpaintStrategy } from './types'

// The per-family reference-clip envelope now has a single definition in
// ../video-models/inpaint.ts, derived from each family's v2v model row.
// Re-exported here so the existing importers need no change.
export {
  ALL_INPAINT_MODEL_FAMILIES,
  INPAINT_FAMILY_SUPPORTS_V2V_REF,
  MAX_V2V_REF_SEC,
  MIN_V2V_REF_SEC,
} from '../video-models'

export const MIN_BOUNDARY_SEC = 1
export const MIN_SPLIT_DURATION_SEC = 4

// Selects the inpaint strategy based on anchor position within the clip.
// Mirrors apps/web/.../mode-strategy.ts selectStrategy.
export type PredictedCallType = 'i2v' | 'v2v'

export function selectInpaintStrategy(
  anchorTimestampSec: number,
  totalDurationSec: number,
): InpaintStrategy {
  if (anchorTimestampSec < MIN_BOUNDARY_SEC) {
    return 'boundary_start'
  }
  if (totalDurationSec - anchorTimestampSec < MIN_BOUNDARY_SEC) {
    return 'boundary_end'
  }
  if (totalDurationSec < MIN_SPLIT_DURATION_SEC) {
    return 'direct'
  }
  return 'split'
}

// Predicts which call type each generated segment of a mode will use, so the UI
// can surface it before generation. Mirrors the worker's resolveCallType: v2v
// unless the segment's reference clip is shorter than the family minimum.
// `direct` reports as v2v - it is a 3-image call on the v2v model.
export function predictModeCallTypes(input: {
  anchorTimestampSec: number
  modelFamily: InpaintModelFamily
  strategy: InpaintStrategy
  totalDurationSec: number
}): PredictedCallType[] {
  const { anchorTimestampSec, modelFamily, strategy, totalDurationSec } = input
  const forRef = (refDurationSec: number): PredictedCallType =>
    refDurationSec < MIN_V2V_REF_SEC[modelFamily] ? 'i2v' : 'v2v'

  if (strategy === 'direct') {
    return ['v2v']
  }
  if (strategy === 'split' || strategy === 'split_plus') {
    // split_plus merges a too-short half with a neighbor clip, but for the UI badge it is
    // still a two-segment edit predicted per-half by reference length, same as split.
    return [forRef(anchorTimestampSec), forRef(totalDurationSec - anchorTimestampSec)]
  }
  return [forRef(totalDurationSec)]
}
