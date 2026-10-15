import { initialTranscript, type Transcript } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import { render, screen, within } from '@testing-library/react'

import { StoryboardPanel } from './StoryboardPanel'
import type { ProjectProgress } from './useProjectProgress'

let mockProgress: Partial<ProjectProgress> = {}

jest.mock('./AgentVideoPreview', () => ({ AgentVideoPreview: () => <div data-testid="video" /> }))
jest.mock('./VideoActions', () => ({ OpenInEditorLink: () => null }))
jest.mock('./VideoProgressCard', () => ({
  ProgressBar: () => null,
  shotsReady: (n: number) => `${n} shots ready`,
}))
jest.mock('./useAgentImageSrc', () => ({ useAgentImageSrc: () => undefined }))
jest.mock('./useProjectProgress', () => ({
  useProjectProgress: (projectId: null | string) => ({
    done: false,
    error: null,
    headline: 'Writing the voice-over...',
    keyframes: [],
    percent: 10,
    script: null,
    stage: null,
    videoUrl: null,
    ...(projectId ? mockProgress : {}),
  }),
}))

const LINES = [
  {
    narration: 'The ampersand was once the alphabet’s twenty-seventh letter.',
    stamp: '&: LETTER 27',
  },
  { narration: "Children recited its name as 'and per se and.'", stamp: null },
  { narration: "'Per se' means 'by itself': the symbol meant 'and.'", stamp: 'PER SE = ITSELF' },
]
const LOOP_BRIEF = {
  brief: '3 clips of 4 s, replaying as a loop',
  durationSeconds: 12,
  lines: LINES,
  title: "The Alphabet's Lost Letter",
}

function panel(transcript: Partial<Transcript>) {
  render(
    <StoryboardPanel
      mode="free"
      sessionId="s1"
      transcript={{ ...initialTranscript, ...transcript }}
    />,
  )
}

/** The Script section's lines, as the user reads them. */
const scriptItems = () =>
  within(screen.getByRole('heading', { name: 'Script' }).parentElement as HTMLElement)
    .getAllByRole('listitem')
    .map((item) => item.textContent)

beforeEach(() => {
  mockProgress = {}
})

describe('StoryboardPanel layout', () => {
  it('has no "Storyboard" title bar, and still names its region for screen readers', () => {
    panel({})

    expect(screen.queryByText('Storyboard', { exact: true })).toBeNull()
    expect(screen.getByRole('region', { name: 'Storyboard' })).toBeTruthy()
    expect(screen.getByText('Your plan and storyboard will build up here as you go.')).toBeTruthy()
  })
})

describe('StoryboardPanel with a loop short', () => {
  it('shows the storyboard while the card waits: the title, the length, each line with its stamp', () => {
    panel({ brief: LOOP_BRIEF })

    expect(screen.queryByText(/will build up here/)).toBeNull()
    expect(screen.getByText("The Alphabet's Lost Letter")).toBeTruthy()
    expect(screen.getByText(/· 12s/)).toBeTruthy()
    expect(scriptItems()).toEqual([
      `${LINES[0].narration}&: LETTER 27`,
      LINES[1].narration,
      `${LINES[2].narration}PER SE = ITSELF`,
    ])
  })

  it("once the video has its script, each line's words come from it, one item per line", () => {
    mockProgress = {
      script: [
        'The ampersand was the twenty-seventh letter of the alphabet.',
        LINES[1].narration,
        LINES[2].narration,
      ].join('\n'),
    }
    panel({
      brief: LOOP_BRIEF,
      entries: [{ id: 'video-p1', kind: 'video', projectId: 'p1' }],
    })

    expect(scriptItems()).toEqual([
      'The ampersand was the twenty-seventh letter of the alphabet.&: LETTER 27',
      LINES[1].narration,
      `${LINES[2].narration}PER SE = ITSELF`,
    ])
  })
})

describe('StoryboardPanel with a story video', () => {
  it("shows make_video's title and length while its style picker waits, and no empty line", () => {
    panel({ brief: { brief: '', durationSeconds: 30, title: 'Moon caves' } })

    const section = screen.getByRole('heading', { name: 'Brief' }).parentElement as HTMLElement
    expect(section.textContent).toBe('BriefMoon caves · 30s')
    expect(section.querySelectorAll('p')).toHaveLength(1)
    expect(screen.queryByRole('heading', { name: 'Script' })).toBeNull()
  })

  it("shows no length before Easy's length card is answered", () => {
    panel({ brief: { brief: 'A comet tonight.', title: 'Moon caves' } })

    const section = screen.getByRole('heading', { name: 'Brief' }).parentElement as HTMLElement
    expect(section.textContent).toBe('BriefMoon cavesA comet tonight.')
  })

  it('splits the script into its sentences, as before', () => {
    mockProgress = { script: 'Look up tonight! A comet passes.' }
    panel({ entries: [{ id: 'video-p1', kind: 'video', projectId: 'p1' }] })

    expect(scriptItems()).toEqual(['Look up tonight!', 'A comet passes.'])
  })
})
