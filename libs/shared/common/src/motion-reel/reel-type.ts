/**
 * The kinds of reel the setup card and `motion_setup` offer: a plain choice. ReelMakeEasy gives no
 * look, palette or fonts with it; the agent decides the look from the type and the user.
 */
export const MOTION_REEL_TYPES = ['launch', 'showreel'] as const
export type MotionReelType = (typeof MOTION_REEL_TYPES)[number]
export const DEFAULT_MOTION_REEL_TYPE: MotionReelType = 'launch'

/** What each type is, as the setup card and the agent offer it. */
export const MOTION_REEL_TYPE_INFO: Record<MotionReelType, { description: string; label: string }> =
  {
    launch: {
      description: 'Make one product memorable: show it working.',
      label: 'Product launch',
    },
    showreel: { description: 'Pure show-off motion that looks super cool.', label: 'Motion reel' },
  }

/**
 * The tempo of a reel without music (its steady grid), per type: a product launch at a
 * confident 120 BPM, a showreel a touch faster at 124.
 */
export const MOTION_REEL_FALLBACK_BPM: Record<MotionReelType, number> = {
  launch: 120,
  showreel: 124,
}

export const isMotionReelType = (v: unknown): v is MotionReelType =>
  (MOTION_REEL_TYPES as readonly unknown[]).includes(v)

/**
 * A setup's type, read from a card, a tool call or a saved setup: its `type`, or, for a setup
 * saved when reels had styles, its old `styleId` ('product-ui-launch' was the launch, every other
 * style a showreel). Null when it names neither.
 */
export function motionReelTypeOf(setup: unknown): MotionReelType | null {
  if (typeof setup !== 'object' || setup === null) return null
  const { styleId, type } = setup as { styleId?: unknown; type?: unknown }
  if (isMotionReelType(type)) return type
  if (typeof styleId !== 'string' || !styleId.trim()) return null
  return styleId === 'product-ui-launch' ? 'launch' : 'showreel'
}
