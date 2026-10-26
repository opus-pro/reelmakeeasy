import { render, screen } from '@testing-library/react'
import { initialTranscript } from '@reelmakeeasy/common/codex-agent/agent-transcript'

import { MotionReelPanel } from './MotionReelPanel'

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
