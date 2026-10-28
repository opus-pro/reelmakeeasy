import type { AgentUiEvent } from '@shared/types/api/agent'

import { renderedVideo, speedKey } from './video-speed'

describe('video speed', () => {
  it('keeps the file at a speed next to the render', () => {
    expect(speedKey('agent-animation/s1/animation-1-2.mp4', 1.25)).toBe(
      'agent-animation/s1/animation-1-2-speed125.mp4',
    )
    expect(speedKey('agent-motion/s1/reel-3.mp4', 0.9)).toBe('agent-motion/s1/reel-3-speed90.mp4')
  })

  it("finds only the chat's own stored render by its item id", () => {
    const events: AgentUiEvent[] = [
      {
        itemId: 'animation-1',
        type: 'motion_video',
        videoUrl: 'store://agent-animation/s1/animation-1.mp4',
      },
      { itemId: 'animation-2', type: 'motion_video', videoUrl: 'https://elsewhere.test/x.mp4' },
    ]
    expect(renderedVideo(events, 'animation-1')).toBe('store://agent-animation/s1/animation-1.mp4')
    expect(renderedVideo(events, 'animation-2')).toBeNull()
    expect(renderedVideo(events, 'animation-3')).toBeNull()
  })
})
