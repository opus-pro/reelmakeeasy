import {
  getUipMusicSignalSource,
  getUipMusicTrackIneligibilityReason,
  isUipMusicTrackEligible,
  type UipMusicEligibilitySpec,
  type UipMusicSignalSource,
  type UipMusicTrackIneligibilityReason,
} from '@reelmakeeasy/uip-planner-runtime'

export function resolveUipMusicIntent(spec: null | UipMusicEligibilitySpec | undefined): boolean {
  return isUipMusicTrackEligible(spec)
}

export function resolveUipMusicRouteIneligibleReason(
  spec: null | UipMusicEligibilitySpec | undefined,
): null | UipMusicTrackIneligibilityReason {
  return getUipMusicTrackIneligibilityReason(spec)
}

export function resolveUipMusicSignalSource(
  spec: null | UipMusicEligibilitySpec | undefined,
): UipMusicSignalSource {
  return getUipMusicSignalSource(spec)
}
