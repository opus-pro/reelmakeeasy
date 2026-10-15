import { describeBgmVolume } from './bgm-volume'

describe('describeBgmVolume', () => {
  it('shows the level as a plain percentage of the narration', () => {
    expect(describeBgmVolume(100)).toBe('100%')
    expect(describeBgmVolume(90)).toBe('90%')
    expect(describeBgmVolume(56.4)).toBe('56%')
    expect(describeBgmVolume(0)).toBe('0%')
    expect(describeBgmVolume(140)).toBe('100%')
    expect(describeBgmVolume(-5)).toBe('0%')
  })
})
