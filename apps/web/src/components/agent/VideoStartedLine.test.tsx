import { VIDEO_STARTED_MESSAGE } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import { render, screen } from '@testing-library/react'

import type { ProjectProgress } from './useProjectProgress'
import {
  VIDEO_FAILED_LINE,
  VIDEO_READY_LINE,
  videoFlaggedLine,
  VideoStartedLine,
  videoStartedLines,
} from './VideoStartedLine'

let mockProgress: Partial<ProjectProgress> = {}

jest.mock('./useProjectProgress', () => ({
  useProjectProgress: (projectId: string) => (projectId === 'p1' ? mockProgress : {}),
}))
jest.mock('./AgentMarkdown', () => ({
  AgentMarkdown: ({ text }: { text: string }) => <p>{text}</p>,
}))

describe('VideoStartedLine', () => {
  it('says the video is being made while it is', () => {
    mockProgress = { done: false, error: null, flaggedClips: [] }
    render(<VideoStartedLine projectId="p1" text={VIDEO_STARTED_MESSAGE} />)
    expect(screen.getByText(VIDEO_STARTED_MESSAGE)).toBeTruthy()
  })

  it('shows the failure in its place once the run failed', () => {
    mockProgress = {
      done: false,
      error: 'Narration too long for its clip even at 1.3x speed',
      flaggedClips: [],
    }
    render(<VideoStartedLine projectId="p1" text={VIDEO_STARTED_MESSAGE} />)
    expect(screen.queryByText(VIDEO_STARTED_MESSAGE)).toBeNull()
    expect(screen.getByText(VIDEO_FAILED_LINE)).toBeTruthy()
  })

  it('says the video is ready once it is, never that it is still being made', () => {
    mockProgress = { done: true, error: null, flaggedClips: [] }
    render(<VideoStartedLine projectId="p1" text={VIDEO_STARTED_MESSAGE} />)
    expect(screen.queryByText(VIDEO_STARTED_MESSAGE)).toBeNull()
    expect(screen.getByText(VIDEO_READY_LINE)).toBeTruthy()
  })

  it('names the clips that still fail a check when a finished loop kept some', () => {
    mockProgress = { done: true, error: null, flaggedClips: ['s2', 's4'] }
    render(<VideoStartedLine projectId="p1" text={VIDEO_STARTED_MESSAGE} />)
    expect(screen.queryByText(VIDEO_STARTED_MESSAGE)).toBeNull()
    expect(screen.queryByText(VIDEO_READY_LINE)).toBeNull()
    expect(screen.getByText(videoFlaggedLine(['s2', 's4']))).toBeTruthy()
  })
})

describe('videoFlaggedLine', () => {
  it('says which clips, in plain words, by their number in the loop', () => {
    expect(videoFlaggedLine(['s3'])).toBe(
      "Your video is ready, but clip 3 didn't pass every check. You can ask to make it again.",
    )
    expect(videoFlaggedLine(['s2', 's4'])).toBe(
      "Your video is ready, but clips 2 and 4 didn't pass every check. You can ask to make them again.",
    )
    expect(videoFlaggedLine(['s1', 's2', 's5'])).toMatch(
      /^Your video is ready, but clips 1, 2 and 5 /,
    )
    // A clip id that isn't numbered is named as it is.
    expect(videoFlaggedLine(['hook'])).toMatch(/but clip hook didn't pass/)
  })
})

describe('videoStartedLines', () => {
  it("ties each of ReelMakeEasy's started messages to the video before it, and nothing else", () => {
    const lines = videoStartedLines([
      { id: 'ly-1', kind: 'assistant', text: VIDEO_STARTED_MESSAGE },
      { id: 'video-p1', kind: 'video', projectId: 'p1' },
      { id: 'ly-3', kind: 'assistant', text: VIDEO_STARTED_MESSAGE },
      { id: 'm-4', kind: 'assistant', text: VIDEO_STARTED_MESSAGE },
      { id: 'ly-5', kind: 'assistant', text: 'Tell me what to fix.' },
      { id: 'video-p2', kind: 'video', projectId: 'p2' },
      { id: 'ly-7', kind: 'assistant', text: VIDEO_STARTED_MESSAGE },
    ])
    expect([...lines]).toEqual([
      ['ly-3', 'p1'],
      ['ly-7', 'p2'],
    ])
  })
})
