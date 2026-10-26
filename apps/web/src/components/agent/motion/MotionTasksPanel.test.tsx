import {
  initialTranscript,
  type Transcript,
} from '@reelmakeeasy/common/codex-agent/agent-transcript'
import { fireEvent, render, screen, within } from '@testing-library/react'

import { MotionReelPanel } from './MotionReelPanel'
import { MotionTasksPanel, shownMotionTasks } from './MotionTasksPanel'

// The player itself is tested on its own; jsdom can't load a video.
jest.mock('../AgentVideoPlayer', () => ({
  AgentVideoPlayer: ({ src }: { src: string }) => <video data-src={src} />,
}))

// react-markdown is ESM; the markdown itself is AgentMarkdown's to test.
jest.mock('../AgentMarkdown', () => ({
  AgentMarkdown: ({ text }: { text: string }) => <p data-markdown>{text}</p>,
}))

const transcript = (over: Partial<Transcript>): Transcript => ({ ...initialTranscript, ...over })

const TASKS: Transcript['motionTasks'] = [
  { id: 'setup', label: 'Set up', result: 'Motion reel, 16:9, 15 s', state: 'done' },
  { id: 'music', label: 'Music', result: 'Pulse Drive, 128 BPM', state: 'done' },
  { id: 'plan', label: 'Plan', result: 'plan.md: 3 sections', state: 'done' },
  { id: 'build', label: 'Build', result: '4 scene files', state: 'done' },
  {
    details: ['beat 4 (frame 113)', 'beat 12 (frame 338)'],
    id: 'look',
    label: 'Look (stills)',
    result: '2 stills over 1 look',
    state: 'done',
  },
  { id: 'render', label: 'Render', result: 'Rendering 2 of 3…', state: 'running' },
  {
    details: ['Kick pulse: none.', 'Sync: 1 to fix: kick pulse.'],
    id: 'sync',
    label: 'Sync check',
    result: '1 to fix: kick pulse',
    state: 'failed',
  },
]

const row = (container: HTMLElement, id: string) =>
  container.querySelector(`[data-task="${id}"]`) as HTMLElement

describe('MotionTasksPanel', () => {
  it('shows each phase with its state and result line', () => {
    const { container } = render(
      <MotionTasksPanel transcript={transcript({ motionTasks: TASKS })} />,
    )
    expect(row(container, 'render').dataset.state).toBe('running')
    expect(within(row(container, 'render')).getByText('Rendering 2 of 3…')).toBeTruthy()
    expect(row(container, 'sync').dataset.state).toBe('failed')
    expect(within(row(container, 'sync')).getByText('needs fixing:')).toBeTruthy()
    expect(within(row(container, 'music')).getByText('Pulse Drive, 128 BPM')).toBeTruthy()
    expect(screen.getAllByText('5 of 7 done').length).toBeGreaterThan(0)
  })

  it('opens a row to show its details', () => {
    const { container } = render(
      <MotionTasksPanel transcript={transcript({ motionTasks: TASKS })} />,
    )
    expect(screen.queryByText('beat 4 (frame 113)')).toBeNull()
    fireEvent.click(within(row(container, 'look')).getByRole('button'))
    expect(screen.getByText('beat 4 (frame 113)')).toBeTruthy()
    // A row with nothing more to show is not a button.
    expect(within(row(container, 'plan')).queryByRole('button')).toBeNull()
  })

  it("shows the agent's to-do list under the phases, with its states", () => {
    render(
      <MotionTasksPanel
        transcript={transcript({
          motionTasks: TASKS,
          plan: [
            { status: 'completed', step: 'Write the plan' },
            { status: 'inProgress', step: 'Build the drop' },
            { status: 'pending', step: 'Render' },
          ],
        })}
      />,
    )
    expect(screen.getByText("The agent's to-do list")).toBeTruthy()
    expect(screen.getByText('Write the plan').className).toMatch(/line-through/)
    expect(screen.getByText('Build the drop').className).toMatch(/text-primary/)
  })

  it('shows the live activity line only while a turn runs', () => {
    const working = transcript({
      activity: { id: 'c1', label: 'Running node tools/score.mjs --no-cues' },
      motionTasks: TASKS,
      working: true,
    })
    const { rerender } = render(<MotionTasksPanel transcript={working} />)
    expect(screen.getByRole('status').textContent).toBe('Running node tools/score.mjs --no-cues')
    rerender(<MotionTasksPanel transcript={{ ...working, activity: null }} />)
    expect(screen.getByRole('status').textContent).toBe('Working…')
    rerender(<MotionTasksPanel transcript={{ ...working, working: false }} />)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('before the first list: every phase waits, the setup is done once chosen', () => {
    expect(shownMotionTasks(initialTranscript).every((t) => t.state === 'waiting')).toBe(true)
    const chosen = shownMotionTasks(
      transcript({ entries: [{ id: 'motion-setup-1', kind: 'motion_setup', state: 'chosen' }] }),
    )
    expect(chosen.map((t) => t.state)).toEqual([
      'done',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ])
  })
})

describe('MotionTasksPanel: the plan', () => {
  const PLAN = {
    changedAt: 1,
    text: '## Intro\n- Scene 1 (bars 0-2): logo bang',
    truncated: false,
  }
  const planToggle = () => screen.getByRole('button', { name: /Plan/ })

  it('shows the plan as markdown, open while there is no render, and folds on a click', () => {
    const { container, rerender } = render(
      <MotionTasksPanel transcript={transcript({ motionPlan: PLAN, motionTasks: TASKS })} />,
    )
    expect(planToggle().getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('[data-markdown]')?.textContent).toBe(PLAN.text)
    fireEvent.click(planToggle())
    expect(container.querySelector('[data-markdown]')).toBeNull()
    // The agent edits plan.md: the new text shows when the section is open.
    fireEvent.click(planToggle())
    rerender(
      <MotionTasksPanel
        transcript={transcript({
          motionPlan: { ...PLAN, changedAt: 2, text: '- Scene 1 (bars 0-4): logo' },
          motionTasks: TASKS,
        })}
      />,
    )
    expect(container.querySelector('[data-markdown]')?.textContent).toBe(
      '- Scene 1 (bars 0-4): logo',
    )
  })

  it('is folded once there is a render, and says when only the start is shown', () => {
    const { container } = render(
      <MotionTasksPanel
        transcript={transcript({
          entries: [{ id: 'm1', kind: 'motion_video', videoUrl: '/r.mp4' }],
          motionPlan: { ...PLAN, truncated: true },
          motionTasks: TASKS,
        })}
      />,
    )
    expect(planToggle().getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-markdown]')).toBeNull()
    fireEvent.click(planToggle())
    expect(screen.getByText('Only the start of plan.md is shown.')).toBeTruthy()
  })

  it('has no plan section without a plan (or in a chat from before it was sent)', () => {
    const { container } = render(
      <MotionTasksPanel transcript={transcript({ motionTasks: TASKS })} />,
    )
    expect(container.querySelector('[data-section="plan"]')).toBeNull()
    // An old saved transcript without the field at all.
    const { motionPlan: _gone, ...old } = transcript({ motionTasks: TASKS })
    const { container: oldContainer } = render(<MotionTasksPanel transcript={old as Transcript} />)
    expect(oldContainer.querySelector('[data-section="plan"]')).toBeNull()
  })
})

describe('MotionReelPanel', () => {
  it('shows the Tasks above the latest render', () => {
    const { container } = render(
      <MotionReelPanel
        transcript={transcript({
          entries: [
            {
              id: 'm1',
              kind: 'motion_video',
              report: '7 of 7 cuts on the grid',
              videoUrl: '/r.mp4',
            },
          ],
          motionTasks: TASKS,
        })}
      />,
    )
    const tasks = screen.getByRole('region', { name: 'Tasks' })
    const render1 = screen.getByText('Latest render')
    expect(tasks.compareDocumentPosition(render1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText('Beat check: 7 of 7 cuts on the grid')).toBeTruthy()
    expect(container.querySelectorAll('[data-task]')).toHaveLength(7)
  })

  it('before a render: the Tasks and where the reel will play', () => {
    render(<MotionReelPanel transcript={initialTranscript} />)
    expect(screen.getByRole('region', { name: 'Tasks' })).toBeTruthy()
    expect(screen.getByText(/it will play here once it is rendered/)).toBeTruthy()
  })
})
