import { clipIndexByTransitionId } from './clip-index'

describe('clipIndexByTransitionId', () => {
  it('numbers clips in plan order', () => {
    const map = clipIndexByTransitionId([
      { transitionId: 'transition_0' },
      { transitionId: 'transition_1' },
      { transitionId: 'loop_tail' },
    ])
    expect(map.get('transition_0')).toBe(0)
    expect(map.get('transition_1')).toBe(1)
    expect(map.get('loop_tail')).toBe(2)
    expect(map.get('missing')).toBeUndefined()
  })
})
