/**
 * Shared Story Mode audio limits used by both the web client (pre-upload
 * validation) and the API / runtime (post-upload enforcement). Keeping this
 * in libs/shared/common ensures client and server agree on the cap.
 *
 * These constants are the LEGACY product ceiling -- the safe default for
 * any consumer not threaded through `getStoryModeUserLimits()` /
 * `useStoryModeUserLimits()`. Users on the expanded 10-min product
 * (`enable_long_story_mode_video`) get `EXPANDED_STORY_MODE_LIMITS
 * .maxAudioUploadSeconds` (660s / 11 min).
 */
export const STORY_MODE_MAX_AUDIO_DURATION_SECONDS = 4 * 60

export const STORY_MODE_MAX_AUDIO_DURATION_MINUTES = Math.round(
  STORY_MODE_MAX_AUDIO_DURATION_SECONDS / 60,
)

export const STORY_MODE_MAX_AUDIO_DURATION_LABEL = `${STORY_MODE_MAX_AUDIO_DURATION_MINUTES} minutes`

// Marketed duration (minutes) for the expanded product, shown in all
// user-facing copy (banner + audio card/validation). MARKETED value, not the
// technical cap (`maxAudioUploadSeconds` = 660s/11 min, a 1-min buffer).
export const EXPANDED_STORY_MODE_DISPLAY_MINUTES = 10
