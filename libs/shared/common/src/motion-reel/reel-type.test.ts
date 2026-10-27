import {
  MOTION_REEL_FALLBACK_BPM,
  MOTION_REEL_TYPE_INFO,
  MOTION_REEL_TYPES,
  motionReelTypeOf,
} from './reel-type'

describe('the kinds of reel', () => {
  it('offers a product launch first, then a motion reel, each a label and one line', () => {
    expect(MOTION_REEL_TYPES).toEqual(['launch', 'showreel'])
    expect(MOTION_REEL_TYPE_INFO).toEqual({
      launch: {
        description: 'Make one product memorable: show it working.',
        label: 'Product launch',
      },
      showreel: {
        description: 'Pure show-off motion that looks super cool.',
        label: 'Motion reel',
      },
    })
    expect(MOTION_REEL_FALLBACK_BPM).toEqual({ launch: 120, showreel: 124 })
  })

  it('reads a type, or an old style: product-ui-launch is a launch, any other a showreel', () => {
    expect(motionReelTypeOf({ type: 'launch' })).toBe('launch')
    expect(motionReelTypeOf({ type: 'showreel', styleId: 'product-ui-launch' })).toBe('showreel')
    expect(motionReelTypeOf({ styleId: 'product-ui-launch' })).toBe('launch')
    expect(motionReelTypeOf({ styleId: 'hud-showreel' })).toBe('showreel')
    expect(motionReelTypeOf({ styleId: 'kinetic-type' })).toBe('showreel')
    expect(motionReelTypeOf({ type: 'nope' })).toBeNull()
    expect(motionReelTypeOf({ styleId: ' ' })).toBeNull()
    expect(motionReelTypeOf({})).toBeNull()
    expect(motionReelTypeOf(null)).toBeNull()
  })
})
