export interface UipMusicEligibilitySpec {
  global_constraints?: null | {
    genre?: null | {
      primary_genre?: null | string
      reasoning?: null | string
      secondary_genre?: null | string
    }
    style?: null | {
      style_name?: null | string
      style_text?: null | string
    }
    target_audience?: null | string
    tone?: null | string
    topic?: null | string
    video_type?: null | string
  }
  meta?: null | {
    audio_is_music?: boolean
    is_music?: boolean
    mode_state?: null | {
      input_type?: null | string
      mode?: null | string
    }
  }
  visual_script?: null | {
    shots?: Array<{
      audio_vo?: null | string
      visual_primary?: null | {
        core_description?: null | string
      }
    }>
  }
}

export type UipMusicTrackIneligibilityReason = 'ads_mode'

export function getUipMusicTrackIneligibilityReason(
  spec: null | UipMusicEligibilitySpec | undefined,
): null | UipMusicTrackIneligibilityReason {
  if (spec?.meta?.mode_state?.mode === 'ads') {
    return 'ads_mode'
  }
  return null
}

export function hasUipMusicSignal(spec: null | UipMusicEligibilitySpec | undefined): boolean {
  const meta = spec?.meta
  return (
    meta?.is_music === true ||
    meta?.mode_state?.input_type === 'audio_music' ||
    meta?.audio_is_music === true
  )
}

export function isUipMusicTrackEligible(spec: null | UipMusicEligibilitySpec | undefined): boolean {
  return hasUipMusicSignal(spec) && getUipMusicTrackIneligibilityReason(spec) === null
}

/**
 * Which signal carries the session's music intent, for routing-quality
 * attribution on `project.long_take.completed`. Precedence mirrors signal
 * strength: explicit user declaration > planner classification > content
 * detector. Reports the raw signal source regardless of eligibility vetoes
 * (`musicFallbackReason` covers those separately).
 */
export type UipMusicSignalSource = 'content_detector' | 'none' | 'planner_audio_music' | 'preset'

export function getUipMusicSignalSource(
  spec: null | UipMusicEligibilitySpec | undefined,
): UipMusicSignalSource {
  const meta = spec?.meta
  if (meta?.is_music === true) {
    return 'preset'
  }
  if (meta?.mode_state?.input_type === 'audio_music') {
    return 'planner_audio_music'
  }
  if (meta?.audio_is_music === true) {
    return 'content_detector'
  }
  return 'none'
}
