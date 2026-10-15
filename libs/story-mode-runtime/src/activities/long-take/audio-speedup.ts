export const STORY_MODE_TARGET_WPM = 155

export interface StoryModeAudioSpeedupOutcome {
  applied: boolean
  audioDurationSeconds?: number
  postWpm?: number
  preWpm: number
  ratio: number
  skipReason?: StoryModeSpeedupSkipReason
  targetWpm: number
  wasCapped: boolean
}

export type StoryModeSpeedupSkipReason =
  | 'already-fast'
  | 'asr-failed'
  | 'flag-off'
  | 'invalid-wpm'
  | 'speedup-failed'

/**
 * Story Mode voiceover speedup is off: the voiceover always ships at its
 * generated pace, reported as a `flag-off` skip for tracking.
 */
export async function maybeSpeedUpStoryModeVoiceover(): Promise<StoryModeAudioSpeedupOutcome> {
  return {
    applied: false,
    preWpm: 0,
    ratio: 1,
    skipReason: 'flag-off',
    targetWpm: STORY_MODE_TARGET_WPM,
    wasCapped: false,
  }
}
