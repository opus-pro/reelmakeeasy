import { getStageSecondaryText, LLM_NOT_SET_UP_TEXT } from './progress'

const STALE = "Claude Code can't write and plan right now (Not installed): open Setup"

describe('getStageSecondaryText on a failed video', () => {
  it('shows the reason the failure carries when no AI could write and plan', () => {
    expect(getStageSecondaryText('error', `LLM_NOT_SET_UP: ${STALE}`)).toBe(STALE)
  })

  it('says to open Setup when the failure carries no reason', () => {
    expect(getStageSecondaryText('error', 'LLM_NOT_SET_UP')).toBe(LLM_NOT_SET_UP_TEXT)
    expect(getStageSecondaryText('error', 'LLM_NOT_SET_UP:  ')).toBe(LLM_NOT_SET_UP_TEXT)
    expect(LLM_NOT_SET_UP_TEXT).toContain('Open Setup')
  })

  it('keeps the existing words for other failures', () => {
    expect(getStageSecondaryText('error', 'TTS_FAILED')).toBe(
      "We couldn't generate the voiceover for your video. Please try again.",
    )
    expect(getStageSecondaryText('error', 'Activity task failed')).toBe(
      'Video generation failed. Please try again.',
    )
  })
})
