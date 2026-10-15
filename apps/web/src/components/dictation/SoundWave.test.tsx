import { act, render } from '@testing-library/react'

import { SoundWave, WAVE_BARS, waveHeights } from './SoundWave'

describe('waveHeights', () => {
  it('pads with silence on the left, so new bars come in on the right', () => {
    const heights = waveHeights([0.25], 4)
    expect(heights.slice(0, 3)).toEqual([0, 0, 0])
    expect(heights[3]).toBeCloseTo(0.8)
  })

  it('keeps only the newest bars and never goes past full height', () => {
    expect(waveHeights([0.1, 0.2, 1, 4], 2)).toEqual([1, 1])
  })
})

describe('SoundWave', () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => jest.useRealTimers())

  it('moves the latest level in from the right as time passes', () => {
    const { container, rerender } = render(<SoundWave level={0} />)
    const bars = () => [...container.querySelectorAll<HTMLElement>('span > span')]
    expect(bars()).toHaveLength(WAVE_BARS)
    rerender(<SoundWave level={0.36} />)
    act(() => jest.advanceTimersByTime(90))
    expect(bars().at(-1)?.style.height).toBe('19px')
    expect(bars().at(-2)?.style.height).toBe('2px')
    act(() => jest.advanceTimersByTime(90))
    expect(bars().at(-2)?.style.height).toBe('19px')
  })
})
