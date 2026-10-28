import { initialTranscript } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { MotionReelPanel } from './MotionReelPanel'

// The player itself is tested on its own; jsdom can't load a video.
// Radix sliders measure their track; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= jest.fn(() => ({
  disconnect: jest.fn(),
  observe: jest.fn(),
  unobserve: jest.fn(),
})) as unknown as typeof ResizeObserver

const mockFetchApiDomain = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))

jest.mock('../AgentVideoPlayer', () => ({
  AgentVideoPlayer: ({ playbackRate, src }: { playbackRate?: number; src: string }) => (
    <video data-rate={playbackRate} data-src={src} />
  ),
}))

// react-markdown is ESM; the markdown itself is AgentMarkdown's to test.
jest.mock('../AgentMarkdown', () => ({
  AgentMarkdown: ({ text }: { text: string }) => <p data-markdown>{text}</p>,
}))

describe('MotionReelPanel', () => {
  it('says where a Claude Animation will play before it is rendered', () => {
    render(
      <MotionReelPanel
        sessionId="s1"
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
        sessionId="s1"
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
      'Review',
    ])
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    expect(screen.queryByText('Sync check')).toBeNull()
    expect(screen.getByText(/a cloud weighs as much as 100 elephants/)).toBeTruthy()
  })

  it('shows no beat check for a render without one', () => {
    render(
      <MotionReelPanel
        sessionId="s1"
        transcript={{
          ...initialTranscript,
          entries: [{ id: 'animation-1', kind: 'motion_video', videoUrl: '/v.mp4' }],
        }}
      />,
    )
    expect(screen.queryByText(/Beat check/)).toBeNull()
    expect(screen.getByText('Download')).toBeTruthy()
  })

  it('plays the render at the picked speed and downloads it at that speed', async () => {
    mockFetchApiDomain.mockResolvedValue({ data: { videoUrl: '/v-speed125.mp4' }, ok: true })
    const click = jest
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => undefined)
    const { container } = render(
      <MotionReelPanel
        sessionId="s1"
        transcript={{
          ...initialTranscript,
          entries: [{ id: 'animation-1', kind: 'motion_video', videoUrl: '/v.mp4' }],
        }}
      />,
    )
    const thumb = screen.getByRole('slider', { name: 'Video speed' })
    for (let i = 0; i < 5; i++) fireEvent.keyDown(thumb, { key: 'ArrowRight' })
    expect(screen.getByText('1.25×')).toBeTruthy()
    expect(container.querySelector('video')?.getAttribute('data-rate')).toBe('1.25')
    fireEvent.click(screen.getByRole('button', { name: 'Download at 1.25×' }))
    await waitFor(() => expect(click).toHaveBeenCalled())
    expect(mockFetchApiDomain).toHaveBeenCalledWith(
      '/api/agent/sessions/s1/videos/animation-1/speed',
      expect.objectContaining({ data: { speed: 1.25 }, method: 'POST' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(screen.getByText('Download')).toBeTruthy()
    click.mockRestore()
  })
})
