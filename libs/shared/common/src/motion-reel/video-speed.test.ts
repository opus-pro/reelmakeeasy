import { isVideoSpeed, VIDEO_SPEED, videoSpeedLabel } from './video-speed'

describe('video speed', () => {
  it('takes the speeds on the slider and nothing else', () => {
    expect(isVideoSpeed(1)).toBe(true)
    expect(isVideoSpeed(1.25)).toBe(true)
    expect(isVideoSpeed(VIDEO_SPEED.min)).toBe(true)
    expect(isVideoSpeed(VIDEO_SPEED.max)).toBe(true)
    // Floating point from the slider's steps.
    expect(isVideoSpeed(0.8 + 0.05 * 3)).toBe(true)
    for (const bad of [1.23, 0.5, 2, Number.NaN, '1.25', null])
      expect(isVideoSpeed(bad)).toBe(false)
  })

  it('labels a speed the short way', () => {
    expect(videoSpeedLabel(1)).toBe('1×')
    expect(videoSpeedLabel(1.25)).toBe('1.25×')
    expect(videoSpeedLabel(1.1)).toBe('1.1×')
  })
})
