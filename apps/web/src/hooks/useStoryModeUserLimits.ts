import {
  EXPANDED_STORY_MODE_LIMITS,
  type StoryModeUserLimits,
} from '@reelmakeeasy/common/story-mode/user-limits'

/**
 * Returns the effective Story Mode product limits for the current user.
 * The long-video rollout (`enable_long_story_mode_video`) is fully launched,
 * so there is a single product tier (10-min / 1700-word) for everyone.
 */
export function useStoryModeUserLimits(): StoryModeUserLimits {
  return EXPANDED_STORY_MODE_LIMITS
}
