// solid:       opaque action-card grey -- the default (desktop + legacy).
// translucent: white/10 overlay for the mobile create/assets sheet (sits on bg-panel).
// active:      resting bg when a card is pressed/playing (e.g. AudioCard).
export type StoryCardSurface = 'solid' | 'translucent'

export const STORY_CARD_SURFACE: Record<
  StoryCardSurface,
  { active: string; hover: string; rest: string }
> = {
  solid: {
    active: 'bg-action-card-hover',
    hover: 'hover:bg-action-card-hover',
    rest: 'bg-action-card',
  },
  translucent: {
    active: 'bg-white/15',
    hover: 'md:hover:bg-white/15',
    rest: 'bg-white/10',
  },
}
