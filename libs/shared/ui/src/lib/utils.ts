import { type ClassValue, clsx } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge about the app z-index tokens (the `theme.extend.zIndex`
// scale in ../../tailwind.preset.ts) so cn() treats them as z-index
// utilities and dedupes them against standard/arbitrary z classes. Without
// this, cn('z-[64]', 'z-floating') keeps BOTH classes and the winner depends
// on CSS source order. Keep this list in sync with the zIndex scale.
//
// Same problem for the app font-size tokens (the `theme.extend.fontSize`
// scale, `createTailwindFontSize()` in ../../tailwind.preset.ts):
// tailwind-merge only recognizes its own t-shirt sizes and arbitrary values
// as `font-size`, so an unlisted key like `text-body-md` falls through to
// its `text-color` group instead and collides with a real color class like
// `text-primary` -- the loser gets silently stripped. Keep this list in
// sync with the fontSize scale.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'h1',
            'h2',
            'h3',
            'h4',
            'h5',
            'h6',
            'label-lg',
            'label-md',
            'label-sm',
            'label-xs',
            'body-lg',
            'body-md',
            'body-sm',
            'body-xs',
            'section-lg',
            'section-md',
            'section-sm',
          ],
        },
      ],
      z: [
        {
          z: [
            'tooltip',
            'uip-overlay',
            'uip-dialog',
            'floating',
            'floating-dialog',
            'modal',
            'modal-chrome',
            'lightbox',
          ],
        },
      ],
    },
  },
})

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
