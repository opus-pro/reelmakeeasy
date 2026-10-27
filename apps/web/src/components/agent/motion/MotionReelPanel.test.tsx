import { render, screen } from '@testing-library/react'
import { initialTranscript } from '@reelmakeeasy/common/codex-agent/agent-transcript'

import { MotionReelPanel } from './MotionReelPanel'

// The player itself is tested on its own; jsdom can't load a video.
jest.mock('../AgentVideoPlayer', () => ({
  AgentVideoPlayer: ({ src }: { src: string }) => <video data-src={src} />,
}))

// react-markdown is ESM; the markdown itself is AgentMarkdown's to test.
jest.mock('../AgentMarkdown', () => ({
  AgentMarkdown: ({ text }: { text: string }) => <p data-markdown>{text}</p>,
}))

describe('MotionReelPanel', () => {
  it('says where a Claude Animation will play before it is rendered', () => {
    render(
      <MotionReelPanel
        transcript={{
          ...initialTranscript,
          entries: [
            {
              id: 'animation-setup-1',
              kind: 'animation_setup',
              setup: {
                lengthSec: 30,
                lookId: '8bit',
                lookLabel: '8-bit',
                music: { source: 'none' },
                musicTitle: null,
                subject: 'Volcanoes',
              },
              state: 'chosen',
            },
          ],
        }}
      />,
    )
    expect(screen.getByText("Your 8-bit animation will play here once it's rendered.")).toBeTruthy()
  })

  it("shows an animation's Tasks and its plan beside the chat", () => {
    render(
      <MotionReelPanel
        transcript={{
          ...initialTranscript,
          entries: [
            {
              id: 'animation-setup-1',
              kind: 'animation_setup',
              setup: {
                lengthSec: 30,
                lookId: '2d',
                lookLabel: '2D',
                music: { source: 'none' },
                musicTitle: null,
                subject: 'Clouds',
              },
              state: 'chosen',
            },
          ],
          motionPlan: {
            changedAt: 1,
            text: '## Script\n\n- Drip: Did you know a cloud weighs as much as 100 elephants?',
            truncated: false,
          },
        }}
      />,
    )
    expect(screen.getAllByText('Tasks').length).toBeGreaterThan(0)
    for (const label of [
      'Set up',
      'Plan',
      'Voices',
      'Music',
      'Build',
      'Look (stills)',
      'Render',
      'Check & fix',
    ])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect(screen.queryByText('Sync check')).toBeNull()
    expect(screen.getByText(/a cloud weighs as much as 100 elephants/)).toBeTruthy()
  })

  it('shows no beat check for a render without one', () => {
    render(
      <MotionReelPanel
        transcript={{
          ...initialTranscript,
          entries: [{ id: 'animation-1', kind: 'motion_video', videoUrl: '/v.mp4' }],
        }}
      />,
    )
    expect(screen.queryByText(/Beat check/)).toBeNull()
    expect(screen.getByText('Download')).toBeTruthy()
  })
})
