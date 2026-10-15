import type React from 'react'

export interface ImageLightboxTriggerProps {
  onClick: ((event: React.MouseEvent<HTMLElement>) => void) | undefined
  onKeyDown: ((event: React.KeyboardEvent) => void) | undefined
  role: 'button' | undefined
  tabIndex: 0 | undefined
}

const INERT_TRIGGER_PROPS: ImageLightboxTriggerProps = {
  onClick: undefined,
  onKeyDown: undefined,
  role: undefined,
  tabIndex: undefined,
}

/**
 * Props that turn an arbitrary element into an `ImageLightbox` trigger. Use them wherever the
 * trigger cannot be a `<button>` - a tile that already contains a control, for instance, since
 * a button may not nest another.
 *
 * `role`, `tabIndex` and the keyboard handler come as one bundle so the role cannot be applied
 * without its keyboard contract. When `enabled` is false every prop is `undefined`, so a tile
 * that cannot expand renders as a plain element and claims no tab stop.
 *
 * Pure: it holds no state, so the caller owns when the lightbox is open.
 */
export function imageLightboxTriggerProps({
  enabled,
  onOpen,
}: {
  enabled: boolean
  onOpen: () => void
}): ImageLightboxTriggerProps {
  if (!enabled) {
    return INERT_TRIGGER_PROPS
  }
  return {
    onClick: (event) => {
      // Focus the trigger before opening. Safari does not focus a clicked `div`, and the
      // lightbox restores focus to whatever held it on open - without this, a click-opened
      // lightbox has nothing to hand focus back to.
      event.currentTarget.focus()
      onOpen()
    },
    onKeyDown: (event) => {
      // Only the trigger's own keys open it. A trigger typically wraps other controls - a
      // select checkbox, say - whose Enter/Space bubbles here; acting on those would swallow
      // the nested control's activation and open the lightbox in its place.
      if (event.target !== event.currentTarget) {
        return
      }
      // A held Enter/Space auto-repeats keydown; without this it would re-fire on every tick.
      if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) {
        return
      }
      event.preventDefault()
      onOpen()
    },
    role: 'button',
    tabIndex: 0,
  }
}
