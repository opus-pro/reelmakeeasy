/**
 * Fills the bottom-panel surfaces (composer, queued card, generating, cancelled) share.
 *
 * All three are the same colour - `bg-menu` is `--ui-bg-menu`, #444444 - so they differ only in
 * alpha. Opaque drops `backdrop-blur`, a no-op behind a solid fill.
 */
export const OPAQUE_PANEL_SURFACE = 'bg-menu'

export const GLASS_PANEL_SURFACE = 'bg-menu/50 backdrop-blur-2xl'

/** The composer's canvas glass is heavier than its siblings'. */
export const CANVAS_GLASS_PANEL_SURFACE = 'bg-menu/80 backdrop-blur-3xl'
