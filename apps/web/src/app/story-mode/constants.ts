// white/18 is the shared hover fill, one step up from fill-secondary (white/10).
// hover:text-white is not redundant: the Button base sets
// hover:text-accent-foreground, which outranks the plain text-white beside it.
export const STORY_MODE_ICON_BUTTON_CLASS =
  'size-[38px] rounded-full bg-fill-secondary p-0 text-white hover:bg-white/18 hover:text-white'

export const STORY_MODE_ACTION_BUTTON_BASE_CLASS =
  'h-[38px] rounded-sm bg-fill-secondary text-white hover:text-white hover:bg-white/18 gap-2 px-2.5'

export const STORY_MODE_ACTION_BUTTON_LABEL_CLASS = 'text-sm font-medium leading-tight'

/**
 * Top inset for every full-screen mobile viewer surface that draws its own icon
 * row: the project view's top bar (FinalVideoView's MobileActionBar) and the
 * Background music page (MobileMusicPage). Shared so the icon row cannot drift
 * apart again as you move between the two screens.
 *
 * A plain utility on purpose. The BGM page shipped
 * `pt-[max(12px,env(safe-area-inset-top))]`, which Tailwind resolved to
 * **0px** -- measured against a `pt-4` control in the same render -- so the
 * header had no top padding at all rather than the intended 12. The safe-area
 * guard bought nothing either: the app sets no `viewport-fit=cover`, so
 * `env(safe-area-inset-top)` is 0 everywhere. The same class of arbitrary-value
 * failure has come up before.
 */
export const STORY_MODE_MOBILE_TOP_INSET_CLASS = 'pt-4'

export const STORY_MODE_COPY_STYLE_BUTTON_WIDTH_CLASS = 'w-[118px]'

export const STORY_MODE_REMIX_BUTTON_WIDTH_CLASS = 'w-[90px]'
