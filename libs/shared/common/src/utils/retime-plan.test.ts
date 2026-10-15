import { resolveRetimePlan } from './media'
import { RETIME_MAX_SPEED_MULTIPLIER } from './retime-constants'

describe('resolveRetimePlan', () => {
  it('caps the speed-up at 1.1x and trims the rest by default', () => {
    expect(resolveRetimePlan({ adjustedDuration: 5, targetDuration: 3.5 })).toEqual({
      clampedMultiplier: RETIME_MAX_SPEED_MULTIPLIER,
      residual: 'trim',
    })
  })

  it('plays the whole clip faster when a higher cap allows it', () => {
    const plan = resolveRetimePlan({
      adjustedDuration: 5,
      maxSpeedMultiplier: 1.6,
      targetDuration: 3.5,
    })
    expect(plan.residual).toBe('none')
    expect(plan.clampedMultiplier).toBeCloseTo(5 / 3.5, 4)
  })

  it('still trims past the higher cap', () => {
    expect(
      resolveRetimePlan({ adjustedDuration: 5, maxSpeedMultiplier: 1.6, targetDuration: 3 }),
    ).toEqual({ clampedMultiplier: 1.6, residual: 'trim' })
  })
})
