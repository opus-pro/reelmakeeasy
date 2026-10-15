/**
 * Opaque surface for the chat cards that float over the scrolling transcript (QuestionCard and its
 * resolved echo).
 *
 * These cards sit inside the Workbench `side` pane, which already paints the glass fill
 * `rgba(68,68,68,0.50)` (`Workbench.tsx`, `sideVariant='card'`). Painting a second translucent
 * layer on top double-stacks that alpha over scrolling messages, so earlier turns read through the
 * question text -- the same double-stack `StoryModeUserIntentPlannerShell` already
 * avoids one layer up.
 *
 * The value is the exact composite those two layers produce today, so the card looks unchanged and
 * only loses the see-through:
 *
 *   panel = 0.5*grey-300 + 0.5*page
 *   card  = 0.5*grey-300 + 0.5*panel  =  0.75*grey-300 + 0.25*page
 *
 * Kept as a `color-mix` of the two source tokens rather than a baked hex so it tracks them instead
 * of drifting. Exact in dark mode (the only mode the app ships -- `forcedTheme="ui"`); in
 * Storybook's light mode the menu fill is a black alpha rather than grey-300, so this reads as a
 * mid-grey approximation, which is still more legible than the translucent original. The
 * mode-aware surface token that would make it exact in both is tracked separately.
 */
export const CHAT_FLOATING_CARD_SURFACE_CLASS =
  'bg-[color-mix(in_srgb,var(--ui-ref-color-grey-300)_75%,var(--bg-background)_25%)]'
