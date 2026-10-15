import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'
import type { ThemeConfig } from 'tailwindcss/types/config'
// tailwindcss-animate ships no types.
import tailwindcssAnimate from 'tailwindcss-animate'

import { createTailwindColors, createTailwindFontSize } from './src/tokens'

// Tokens that hold a full color in a CSS variable (e.g. `var(--bg-background)`)
// can't take Tailwind `/NN` alpha modifiers -- classes like `bg-secondary/20` or
// `border-primary/50` silently compile to NOTHING (the element falls back to
// inherited/preflight color), which is how the Style Studio's drag overlay
// shipped fully transparent. Function-form colors close the gap.
//
// For plain usages Tailwind passes `opacityValue` as `var(--tw-*-opacity)` (or
// nothing) -- return the bare var so every existing non-modifier class keeps
// byte-identical CSS. Only an explicit `/NN` (not `/100`) produces a color-mix.
// `opacityValue` is coerced through String() because the gradient plugin's
// `transparentTo()` passes a NUMBER (0), which would crash `.startsWith` and
// take the whole webpack build down with it. The cast is the standard escape
// hatch: Tailwind 3.4 accepts function color values at runtime but its Config
// type only admits strings.
const withAlphaVar = (cssVar: string): string =>
  (({ opacityValue }: { opacityValue?: number | string }) => {
    if (opacityValue === undefined) {
      return `var(${cssVar})`
    }
    const alpha = String(opacityValue)
    return alpha === '1' || alpha.startsWith('var(')
      ? `var(${cssVar})`
      : `color-mix(in srgb, var(${cssVar}) calc(${alpha} * 100%), transparent)`
  }) as unknown as string

const preset: Partial<Config> = {
  plugins: [
    tailwindcssAnimate,
    plugin(({ addUtilities }) => {
      addUtilities({
        '.scrollbar-hide': {
          /* Internet Explorer 10+ */
          '-ms-overflow-style': 'none',
          /* Firefox */
          'scrollbar-width': 'none',
        },
        '.scrollbar-hide::-webkit-scrollbar': {
          /* Chrome, Safari and Opera */
          display: 'none',
        },
        // Overlay-style scrollbar: invisible by default, thumb fades in only
        // while the `.is-scrolling` class is toggled on (see useIsScrolling),
        // so it also shows for touch/keyboard/programmatic scroll, which a
        // hover-only rule never sees. Combine with `.scrollbar-thin`
        // for width/radius/track -- only declares the thumb color toggle
        // itself here, since `.scrollbar-thin`'s own thumb color is fixed and
        // (being defined after `@tailwind utilities` in tailwind.css) would
        // otherwise always win the cascade over anything set here.
        '.scrollbar-reveal': {
          'scrollbar-color': 'transparent transparent',
          transition: 'scrollbar-color 0.2s',
        },
        '.scrollbar-reveal::-webkit-scrollbar-thumb': {
          'background-color': 'transparent',
          transition: 'background-color 0.2s',
        },
        '.scrollbar-reveal.is-scrolling': {
          'scrollbar-color': 'var(--ui-ref-color-grey-200) transparent',
        },
        '.scrollbar-reveal.is-scrolling::-webkit-scrollbar-thumb': {
          'background-color': 'var(--ui-ref-color-grey-200)',
        },
      })
    }),
  ],
  theme: {
    extend: {
      spacing: {
        '4.5': '1.125rem', // 18px
        '7.5': '1.875rem', // 30px
        '9.5': '2.375rem', // 38px
        '13.5': '3.375rem', // 54px
      },
      lineHeight: {
        '6.5': '26px',
      },
      // Tailwind v3's `/N` color-opacity modifier only accepts values from the
      // opacity scale (multiples of 5 by default) -- anything else, e.g.
      // `bg-white/8`, silently emits NO CSS. Bless the off-scale steps the
      // design uses so they compile everywhere without bracket syntax.
      opacity: {
        '3': '0.03',
        '4': '0.04',
        '7': '0.07',
        '8': '0.08',
        '12': '0.12',
        '16': '0.16',
        '18': '0.18',
        '22': '0.22',
        '58': '0.58',
        '62': '0.62',
      },
      backgroundColor: {
        DEFAULT: withAlphaVar('--bg-background'),
        foreground: withAlphaVar('--bg-foreground'),
        overlay: withAlphaVar('--bg-overlay'),
        panel: withAlphaVar('--bg-panel'),
        // bg-popover intentionally omitted here so it resolves to colors.popover
        // (var(--popover)) -- a solid floating surface. The old
        // `hsla(var(--fill-primary), 0.16)` broke once --fill-primary became a
        // full color (hsla() needs channels), painting popovers transparent.
        secondary: withAlphaVar('--bg-secondary'),
        tertiary: withAlphaVar('--bg-tertiary'),
      },
      borderColor: {
        DEFAULT: withAlphaVar('--border'),
        primary: withAlphaVar('--border-primary'),
        secondary: withAlphaVar('--border-secondary'),
        tertiary: withAlphaVar('--border-tertiary'),
        subtle: withAlphaVar('--border-subtle'),
      },
      borderRadius: {
        '4xl': '34px',
        '3xl': '24px',
        '2xl': '20px',
        lg: '14px',
        md: '12px',
        sm: '10px',
        xs: '8px',
        xxs: '6px',
      },
      // Z-index scale: named layers instead of magic numbers.
      // DOM paint order handles stacking within a layer -- the last portal appended
      // to <body> wins, so one token per layer is enough (no per-dialog incrementing).
      //
      // uip-overlay / uip-dialog: UIP planner modal and its backdrop.
      //   Radix modal=true side-effects: body pointer-events:none, trapped FocusScope,
      //   aria-hidden on siblings.
      // floating / floating-dialog: surfaces above UIP (debug panel, quick-start).
      //   Require pointer-events-auto to re-opt in.
      // modal: blocking dialogs inside UIP -- backdrop + content share this value;
      //   Radix renders backdrop before content so DOM order handles layering.
      // modal-chrome: page-header affordances (UIP planner close X) that stay
      //   visible and interactive above modal (200) dialogs. Requires
      //   pointer-events-auto to re-opt in.
      // lightbox: full-screen image viewer. It opens from anywhere, including from
      //   inside a modal (200) dialog and from under the modal-chrome (300) close X,
      //   so it must cover both. Requires pointer-events-auto to re-opt in.
      // Scale uses intervals of 100 above modal so new layers have room.
      //
      // This is a hard dependency of `src/lib/utils.ts`'s `cn()`, which bakes these
      // exact token names into its `tailwind-merge` `extendTailwindMerge` z classGroup --
      // keep the two lists in sync.
      zIndex: {
        tooltip: '50',
        'uip-overlay': '80',
        'uip-dialog': '81',
        floating: '90',
        'floating-dialog': '91',
        modal: '200',
        'modal-chrome': '300',
        lightbox: '400',
      },
      colors: createTailwindColors(withAlphaVar) as ThemeConfig['colors'],
      fontSize: createTailwindFontSize(),
      fontFamily: {
        mono: ['var(--font-geist-mono)'],
        sans: ['var(--font-geist-sans)'],
      },
      animation: {
        'agent-idle': 'breathe 2.5s ease-in-out infinite',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'caret-blink': 'caret-blink 1.2s ease-out infinite',
        'shimmer-diagonal': 'shimmer-diagonal 2s infinite',
        shimmer: 'shimmer 2s linear infinite',
      },
      // popover-drop-down (used in components/ui/popover.tsx) has no keyframe
      // definition anywhere in this repo -- it's a pre-existing
      // dead utility layered on top of the working animate-in/fade-in/zoom-in/
      // slide-in-from-* entrance animation on the same element. Not covered here.
      keyframes: {
        breathe: {
          '0%, 100%': { transform: 'scale(0.88)', opacity: '0.72' },
          '50%': { transform: 'scale(1.1)', opacity: '1' },
        },
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'caret-blink': {
          '0%,70%,100%': { opacity: '1' },
          '20%,50%': { opacity: '0' },
        },
        // Ported from apps/web/tailwind.config.ts so shared/ui components can use a
        // diagonal-sweep shimmer that previews correctly in Storybook.
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'shimmer-diagonal': {
          '0%': { transform: 'translate(-50%, -50%) rotate(-45deg) translateY(-200%)' },
          '100%': { transform: 'translate(-50%, -50%) rotate(-45deg) translateY(200%)' },
        },
      },
    },
  },
}

export default preset
