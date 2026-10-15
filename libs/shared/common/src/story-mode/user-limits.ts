/**
 * Story Mode per-user limit resolution. Acts as the single source of truth
 * for "what can THIS user generate" so all consumers (frontend picker,
 * backend DTO validation, UIP planner contract, LLM prompts) speak the
 * same language.
 *
 * There is a single tier, `EXPANDED_STORY_MODE_LIMITS` (the long-form product,
 * <=10min, <=1700 words), applied to every user. It previously sat behind the
 * `enable_long_story_mode_video` gate alongside a narrower `LEGACY` tier; the
 * gate has since gone to 100%, so the legacy tier was removed and everyone
 * resolves to the expanded limits.
 *
 * The codebase's internal `ABSOLUTE_MAX_SCRIPT_WORDS` / `SCRIPT_WORD_CAP`
 * etc. sit at this EXPANDED ceiling so internal defense paths (rewrite,
 * sentence-trim, audit) can handle the largest legitimate input.
 */

import { EXPANDED_STORY_MODE_DISPLAY_MINUTES } from '../utils/story-mode-audio-limits'

export interface StoryModeUserLimits {
  /** Hard word ceiling for user-provided / generated scripts. */
  absoluteMaxScriptWords: number
  /** Marketed audio cap (min) for copy, not enforced (10 min vs the 660s hard cap). */
  audioUploadDisplayMinutes: number
  /** Max duration in seconds for a user-uploaded audio file. */
  maxAudioUploadSeconds: number
  /** Max duration_seconds the planner accepts via MODE_CONFIRMED in non-audio mode. */
  maxNonAudioDurationSeconds: number
  /** Hard character ceiling on user-provided / generated scripts. */
  maxScriptChars: number
  /** Selectable duration values for the OmniChatBox duration picker. `null` = "Auto". */
  pickerOptionsSeconds: Array<null | number>
}

export const EXPANDED_STORY_MODE_LIMITS: StoryModeUserLimits = {
  absoluteMaxScriptWords: 1700,
  audioUploadDisplayMinutes: EXPANDED_STORY_MODE_DISPLAY_MINUTES, // 10 min (marketed)
  maxScriptChars: 10500,
  maxNonAudioDurationSeconds: 600, // 10 min
  maxAudioUploadSeconds: 660, // 11 min
  pickerOptionsSeconds: [null, 60, 120, 180, 240, 300, 360, 420, 480, 540, 600],
}

/**
 * Effective Story Mode limits. There is a single tier now that the
 * long-video rollout (`enable_long_story_mode_video`) is fully launched;
 * this returns the one profile for every user. Kept as the canonical
 * accessor so all consumers (frontend picker, backend DTO validation,
 * UIP planner contract, LLM prompts) speak the same language.
 */
export function getStoryModeUserLimits(): StoryModeUserLimits {
  return EXPANDED_STORY_MODE_LIMITS
}
