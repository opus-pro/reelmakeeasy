import { join } from 'node:path'

import { createGlobPatternsForDependencies } from '@nx/react/tailwind'
import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

// tailwind loads this config through jiti, which ignores tsconfig path aliases,
// so the @shared/ui alias fails at build time -- the relative source
// import is the only one that resolves.
// eslint-disable-next-line @nx/enforce-module-boundaries
import designPreset from '../../libs/shared/ui/tailwind.preset'

// The above utility import will not work if you are using Next.js' --turbo.
// Instead you will have to manually add the dependent paths to be included.
// For example
// '../libs/buttons/**/*.{ts,tsx,js,jsx,html}',                 <--- Adding a shared lib
// '!../libs/buttons/**/*.{stories,spec}.{ts,tsx,js,jsx,html}', <--- Skip adding spec/stories files from shared lib

// If you are **not** using `--turbo` you can uncomment both lines 1 & 19.
// A discussion of the issue can be found: https://github.com/nrwl/nx/issues/26510

const config: Config = {
  presets: [designPreset],
  safelist: ['w-[248px]'],
  content: [
    join(__dirname, '{src,pages,components,app}/**/*!(*.stories|*.spec).{ts,tsx,html}'),
    join(__dirname, '../../libs/shared/ui/src/**/*.{js,ts,jsx,tsx,mdx}'),
    ...createGlobPatternsForDependencies(__dirname),
  ],
  darkMode: 'class',
  plugins: [
    require('@tailwindcss/container-queries'),
    require('@tailwindcss/forms'),
    require('@tailwindcss/typography'),
    require('@tailwindcss/aspect-ratio'),
    plugin(({ addUtilities }) => {
      addUtilities({
        '.shimmer-text': {
          backgroundImage:
            'linear-gradient(110deg, rgba(255,255,255,0.55) 12%, rgba(255,255,255,0.98) 45%, rgba(255,255,255,0.55) 78%)',
          backgroundSize: '200% 100%',
          '-webkit-background-clip': 'text',
          backgroundClip: 'text',
          color: 'transparent',
        },
        // Premium label fill, widened so the shimmer can travel across the glyphs.
        '.premium-shimmer': {
          backgroundImage:
            'linear-gradient(90deg, #FFF 0%, var(--ui-sys-color-accent-yellow) 35%, #FFF 50%, var(--ui-sys-color-accent-yellow) 65%, #FFF 100%)',
          backgroundSize: '250% 100%',
        },
        // The tier labels in the 4-tier quality menu, each carrying `.premium-shimmer`'s
        // sweep with its own two colours. Same 5-stop structure and 250% size, so the
        // travel and wrap are identical to the shipped Premium label; they reuse its
        // `animate-premium-shimmer` keyframes.
        // The Quality pill's resting glow. Built from offset inset shadows, not a masked
        // ring: an inset shadow already hugs the radius and fades inward with no edge of
        // its own, where any mask has to cut somewhere and that cut reads as a line across
        // the middle. Offsetting gathers the light on one part of the outline and
        // animating the offsets walks it around; the negative spread keeps it off the
        // label. Three layers on two pseudo-elements, so the static base sits on the
        // element itself.
        '.pulse-inner-beam': {
          position: 'relative',
          boxShadow:
            'inset 0 0 13px -7px rgb(255 255 255 / 0.095), inset 0 0 2px 0 rgb(255 255 255 / 0.054)',
          transition: 'box-shadow 150ms ease-out',
        },
        '.pulse-inner-beam::before, .pulse-inner-beam::after': {
          content: '""',
          position: 'absolute',
          inset: '0',
          borderRadius: 'inherit',
          pointerEvents: 'none',
          transition: 'opacity 150ms ease-out',
        },
        '.pulse-inner-beam::before': {
          animation: 'pulse-edge-a 7.5s linear infinite',
        },
        '.pulse-inner-beam::after': {
          animation: 'pulse-edge-b 11s linear infinite',
        },
        // The glow is the at-rest tell. On hover the pill gets its own fill, and two
        // treatments on the same edge compete, so it yields -- faded rather than paused,
        // so it returns where it would have been. The label's shimmer keeps running.
        '.pulse-inner-beam:hover': { boxShadow: 'none' },
        '.pulse-inner-beam:hover::before, .pulse-inner-beam:hover::after': { opacity: '0' },
        // Yielding on hover only makes sense where something takes over the edge -- the pill's
        // own fill. On a plain container (the quote card's Model Section) nothing does, so the
        // beam would simply blink out under the pointer. This modifier holds it.
        '.pulse-inner-beam-hold:hover': {
          boxShadow:
            'inset 0 0 13px -7px rgb(255 255 255 / 0.095), inset 0 0 2px 0 rgb(255 255 255 / 0.054)',
        },
        '.pulse-inner-beam-hold:hover::before, .pulse-inner-beam-hold:hover::after': {
          opacity: '1',
        },
        // One entry per media query: a second '@media (prefers-reduced-motion: reduce)'
        // key on this object would silently overwrite this one, so every motion opt-out
        // in this file belongs here.
        '@media (prefers-reduced-motion: reduce)': {
          '.pulse-inner-beam::before, .pulse-inner-beam::after': {
            animation: 'none',
            transition: 'none',
          },
          '.pulse-inner-beam': { transition: 'none' },
          '.slider-flow-a, .slider-flow-b, .slider-flow-c, .slider-flow-reveal': {
            animation: 'none',
          },
        },
        // Specks drifting inside the quality bar. Three tiles of different widths on
        // different periods, so they never line up and the parallax reads as speed.
        '.slider-flow': {
          position: 'absolute',
          inset: '0',
          pointerEvents: 'none',
          backgroundRepeat: 'repeat',
          transition: 'opacity 320ms ease-out',
        },
        // The arrival. Its mask window starts past the right edge and slides into place
        // once, so the specks are uncovered from the right instead of fading up already
        // spread across the bar; at rest the same gradient thins them out to the left.
        '.slider-flow-reveal': {
          position: 'absolute',
          inset: '0',
          pointerEvents: 'none',
          transition: 'opacity 320ms ease-out',
          WebkitMaskImage:
            'linear-gradient(to left, #000 0%, rgb(0 0 0 / 0.4) 23%, transparent 45%, transparent 100%)',
          maskImage:
            'linear-gradient(to left, #000 0%, rgb(0 0 0 / 0.4) 23%, transparent 45%, transparent 100%)',
          WebkitMaskSize: '200% 100%',
          maskSize: '200% 100%',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          // Rest on the opaque end of the doubled gradient; the arrival travels here from
          // the transparent end. A `to left` ramp puts its opaque stop at the image's
          // right edge, so 100% -- not 0% -- is the visible state.
          WebkitMaskPositionX: '100%',
          maskPositionX: '100%',
          animation: 'slider-flow-in 380ms ease-out both',
        },
        '.slider-flow-a': {
          backgroundImage: [
            'radial-gradient(circle 0.8px at 4.9% 46.9%, rgb(255 255 255 / 0.6) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.6px at 3.4% 82.5%, rgb(255 255 255 / 0.55) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.7px at 17.7% 46.6%, rgb(255 255 255 / 0.6) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.0px at 14.7% 78.6%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.4px at 30.1% 71.7%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.7px at 34.8% 11.5%, rgb(255 255 255 / 0.32) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.7px at 34.3% 46.8%, rgb(255 255 255 / 0.55) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.0px at 51.9% 55.3%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.8px at 48.8% 19.1%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.8px at 53.1% 43.8%, rgb(255 255 255 / 0.48) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.2px at 64.5% 56.0%, rgb(255 255 255 / 0.6) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.7px at 67.3% 63.9%, rgb(255 255 255 / 0.32) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.7px at 64.1% 57.7%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.2px at 85.3% 54.7%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
          ].join(', '),
          backgroundSize: '46px 100%',
          animation: 'slider-flow-a 2.9s linear infinite',
        },
        '.slider-flow-b': {
          backgroundImage: [
            'radial-gradient(circle 1.7px at 8.4% 77.0%, rgb(255 255 255 / 0.6) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.6px at 9.2% 71.6%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.6px at 24.3% 79.2%, rgb(255 255 255 / 0.55) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.2px at 22.9% 28.4%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.7px at 40.5% 21.1%, rgb(255 255 255 / 0.32) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.7px at 39.8% 44.5%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.7px at 49.6% 86.7%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.8px at 70.9% 52.2%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.7px at 70.8% 64.6%, rgb(255 255 255 / 0.55) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.0px at 79.8% 19.9%, rgb(255 255 255 / 0.32) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.8px at 80.5% 57.5%, rgb(255 255 255 / 0.32) 0 100%, transparent 100%)',
          ].join(', '),
          backgroundSize: '66px 100%',
          animation: 'slider-flow-b 4.3s linear infinite',
        },
        '.slider-flow-c': {
          backgroundImage: [
            'radial-gradient(circle 0.8px at 3.7% 79.1%, rgb(255 255 255 / 0.32) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.8px at 5.6% 81.7%, rgb(255 255 255 / 0.32) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.4px at 18.3% 65.7%, rgb(255 255 255 / 0.55) 0 100%, transparent 100%)',
            'radial-gradient(circle 0.7px at 38.6% 12.2%, rgb(255 255 255 / 0.4) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.2px at 42.1% 89.3%, rgb(255 255 255 / 0.32) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.7px at 41.2% 72.7%, rgb(255 255 255 / 0.32) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.4px at 59.8% 73.0%, rgb(255 255 255 / 0.32) 0 100%, transparent 100%)',
            'radial-gradient(circle 1.7px at 60.0% 25.2%, rgb(255 255 255 / 0.48) 0 100%, transparent 100%)',
          ].join(', '),
          backgroundSize: '86px 100%',
          animation: 'slider-flow-c 6.1s linear infinite',
        },
        // A fine grain over the whole fill. SVG turbulence rather than a bitmap: it scales
        // with the bar and costs no request.
        '.slider-noise': {
          position: 'absolute',
          inset: '0',
          pointerEvents: 'none',
          opacity: '0.5',
          mixBlendMode: 'overlay',
          backgroundImage:
            "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='90' height='90' viewBox='0 0 90 90'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='2' numOctaves='1' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3CfeComponentTransfer%3E%3CfeFuncR type='linear' slope='4' intercept='-1.5'/%3E%3CfeFuncG type='linear' slope='4' intercept='-1.5'/%3E%3CfeFuncB type='linear' slope='4' intercept='-1.5'/%3E%3C/feComponentTransfer%3E%3C/filter%3E%3Crect width='90' height='90' filter='url(%23n)'/%3E%3C/svg%3E\")",
          backgroundSize: '64px 64px',
        },
        // Standard: no ramp in its identity, so its sweep is its own white/60 lifted to
        // full white and back -- the same motion as the tiers above it, without
        // borrowing their colour.
        '.tier-basic-shimmer': {
          backgroundImage:
            'linear-gradient(90deg, rgb(255 255 255 / 0.45) 0%, #FFF 25%, rgb(255 255 255 / 0.45) 50%, #FFF 75%, rgb(255 255 255 / 0.45) 100%)',
          backgroundSize: '250% 100%',
        },
        // Standard+: the `New/Standard` gradient, linear-gradient(90deg, #FFF 0%, #FFCDB5 70%).
        // Mirrored into the 5-stop 250% form so it can travel; the two colours are the
        // token's, the shape is `.premium-shimmer`'s.
        '.tier-standard-shimmer': {
          backgroundImage:
            'linear-gradient(90deg, #FFF 0%, #FFCDB5 25%, #FFF 50%, #FFCDB5 75%, #FFF 100%)',
          backgroundSize: '250% 100%',
        },
        // Premium: the `New/Premium` gradient, linear-gradient(90deg, #FFCDB5 0%, #B2E8FD 60%).
        '.tier-premium-shimmer': {
          backgroundImage:
            'linear-gradient(90deg, #FFCDB5 0%, #FFF 25%, #B2E8FD 50%, #FFF 75%, #FFCDB5 100%)',
          backgroundSize: '250% 100%',
        },
        // Ultra: the `New/Ultra` gradient, linear-gradient(90deg, #B2E8FD 0%, #FFD1FD 60%).
        '.tier-ultra-shimmer': {
          backgroundImage:
            'linear-gradient(90deg, #B2E8FD 0%, #FFF 25%, #FFD1FD 50%, #FFF 75%, #B2E8FD 100%)',
          backgroundSize: '250% 100%',
        },
        '.text-glow-sm': {
          filter: 'drop-shadow(0 0 6px rgba(255,255,255,0.22))',
        },
        '.blur-gradient': {
          position: 'absolute',
        },
        '.blur-gradient::before': {
          content: '""',
          position: 'absolute',
          top: '0',
          left: '0',
          right: '0',
          bottom: '0',
          opacity: '1',
          backdropFilter: 'blur(40px)',
          mask: 'linear-gradient(transparent, black 80%)',
          transition: '1s',
        },
      })
    }),
  ],
  theme: {
    extend: {
      spacing: {
        '15': '3.75rem', // 60px
        '18': '4.5rem', // 72px - custom design size
        '22.5': '5.625rem', // 90px - brand brief asset tile
        '88': '22rem', // 352px - DetailPanel width
      },
      lineHeight: {
        '6.5': '26px',
      },
      transitionTimingFunction: {
        /** Strong ease-out tail; snappy settle (dialogs, smaller UI). */
        'out-soft': 'cubic-bezier(0.22, 1, 0.36, 1)',
        /** Ease-in-out for large layout / mode switches (less snap than out-soft). */
        'in-out-soft': 'cubic-bezier(0.45, 0, 0.55, 1)',
      },
      animation: {
        'mouse-path-1': 'mouse-path-1 10s ease-in-out infinite',
        'mouse-path-2': 'mouse-path-2 12s ease-in-out infinite',
        'mouse-path-3': 'mouse-path-3 11s ease-in-out infinite',
        'slide-out': 'slideOut 0.4s ease-out forwards',
        'slide-in': 'slideIn 0.4s ease-out forwards',
        'dialog-in': 'dialogIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'dialog-out': 'dialogOut 0.2s cubic-bezier(0.4, 0, 1, 1)',
        'overlay-show': 'overlayShow 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        'overlay-hide': 'overlayHide 0.2s cubic-bezier(0.4, 0, 1, 1)',
        'shimmer-diagonal': 'shimmer-diagonal 2s infinite',
        shimmer: 'shimmer 2s linear infinite',
        'premium-shimmer': 'premium-shimmer 6s linear infinite',
        // The grow animates the standalone `scale` property, never `transform`. Framer
        // drives the label's enter/exit slide through `transform` on this same element,
        // and a CSS animation on that property overwrites the slide outright; `scale`
        // composes with it instead, so the two can share the element.
        'tier-sweep':
          'premium-shimmer 3.8s linear infinite, tier-label-grow 3.8s ease-in-out infinite',
        'drop-slot-pulse': 'drop-slot-pulse 0.9s ease-in-out infinite alternate',
        sparkle: 'sparkle 2s ease-in-out infinite',
        'glow-breathe':
          'glow-breathe var(--glow-duration, 4s) cubic-bezier(0.42, 0, 0.58, 1) infinite',
      },
      backgroundImage: {
        blur: 'linear-gradient(180deg, rgba(0, 0, 0, 0.00) 0%, #2a2a2a 100%)',
      },
      boxShadow: {
        'green-glow': '0px -4px 20px 0px #C6FD7F',
        'inner-glow': '0px 0px 30px 0px rgba(255, 255, 255, 0.1) inset',
      },
      maxWidth: {
        content: '49.5rem', // 792px
      },
      highlightGradient: 'bg-clip-text bg-gradient-to-r from-[#ffc823] to-[#ffc82380]',
      keyframes: {
        'mouse-path-1': {
          '0%, 100%': {
            transform: 'translate3d(0, 0, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
          '25%': {
            transform: 'translate3d(30px, -20px, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
          '50%': {
            transform: 'translate3d(-10px, -30px, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
          '75%': {
            transform: 'translate3d(-25px, -10px, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
        },
        'mouse-path-2': {
          '0%, 100%': {
            transform: 'translate3d(0, 0, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
          '20%': {
            transform: 'translate3d(-25px, -15px, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
          '50%': {
            transform: 'translate3d(5px, -28px, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
          '80%': {
            transform: 'translate3d(20px, -8px, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
        },
        'mouse-path-3': {
          '0%, 100%': {
            transform: 'translate3d(0, 0, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
          '30%': {
            transform: 'translate3d(28px, -18px, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
          '60%': {
            transform: 'translate3d(-20px, -25px, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
          '85%': {
            transform: 'translate3d(-15px, -5px, 0)',
            animationTimingFunction: 'cubic-bezier(0.25, 0.1, 0.25, 1)',
          },
        },
        slideOut: {
          '0%': { transform: 'translateX(0%)', opacity: '1' },
          '100%': { transform: 'translateX(100%)', opacity: '0' },
        },
        slideIn: {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        dialogIn: {
          from: {
            opacity: '0',
            transform: 'translate(-50%, calc(-50% + 8px)) scale(0.96)',
          },
          to: {
            opacity: '1',
            transform: 'translate(-50%, -50%) scale(1)',
          },
        },
        dialogOut: {
          from: {
            opacity: '1',
            transform: 'translate(-50%, -50%) scale(1)',
          },
          to: {
            opacity: '0',
            transform: 'translate(-50%, calc(-50% + 8px)) scale(0.96)',
          },
        },
        overlayShow: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        overlayHide: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        // -166.667% travels exactly one gradient period at background-size 250%
        // (1.6667 x 1.5W = 2.5W), so the loop wraps without a visible hitch.
        'premium-shimmer': {
          '0%': { backgroundPosition: '0% 50%' },
          '100%': { backgroundPosition: '-166.667% 50%' },
        },
        // Rides the same 4s period as the sweep, peaking as the highlight crosses.
        // Transform only, so it costs no layout and cannot nudge the pill's width.
        shimmer: {
          '0%': { backgroundPosition: '200% 0' },
          '100%': { backgroundPosition: '-200% 0' },
        },
        'shimmer-diagonal': {
          '0%': {
            transform: 'translate(-50%, -50%) rotate(-45deg) translateY(-200%)',
          },
          '100%': {
            transform: 'translate(-50%, -50%) rotate(-45deg) translateY(200%)',
          },
        },
        'drop-slot-pulse': {
          from: { borderColor: 'rgba(255,255,255,0.3)', backgroundColor: 'rgba(255,255,255,0.04)' },
          to: { borderColor: 'rgba(255,255,255,0.75)', backgroundColor: 'rgba(255,255,255,0.10)' },
        },
        sparkle: {
          '0%, 100%': { transform: 'scale(1) rotate(0deg)' },
          '50%': { transform: 'scale(1.25) rotate(20deg)' },
        },
        'glow-breathe': {
          // Organic breathing: inhale to full, hold briefly at the peak (45%-55%),
          // then exhale and rest. Color and blur range come from the consumer via
          // --glow-color / --glow-blur-min / --glow-blur-max (all with defaults), so
          // the same animation is reusable across colors and intensities.
          '0%, 100%': {
            boxShadow: 'inset 0 0 var(--glow-blur-min, 10px) 0 var(--glow-color, #ff8000)',
          },
          '45%, 55%': {
            boxShadow: 'inset 0 0 var(--glow-blur-max, 20px) 0 var(--glow-color, #ff8000)',
          },
        },
      },
      typography: () => ({
        ui: {
          css: {
            '--tw-prose-body': 'var(--text-primary)',
            '--tw-prose-bold': 'var(--text-primary)',
            '--tw-prose-bullets': 'var(--text-primary)',
            '--tw-prose-captions': 'var(--text-primary)',
            '--tw-prose-code': 'var(--text-primary)',
            '--tw-prose-counters': 'var(--text-primary)',
            '--tw-prose-headings': 'var(--text-primary)',
            '--tw-prose-hr': 'var(--text-primary)',
            '--tw-prose-invert-body': 'var(--text-primary)',
            '--tw-prose-invert-bold': 'var(--text-primary)',
            '--tw-prose-invert-bullets': 'var(--text-primary)',
            '--tw-prose-invert-captions': 'var(--text-primary)',
            '--tw-prose-invert-code': 'var(--text-primary)',
            '--tw-prose-invert-counters': 'var(--text-primary)',
            '--tw-prose-invert-headings': 'var(--text-primary)',
            '--tw-prose-invert-hr': 'var(--text-primary)',
            '--tw-prose-invert-lead': 'var(--text-primary)',
            '--tw-prose-invert-links': 'var(--text-primary)',
            '--tw-prose-invert-pre-bg': 'rgb(0 0 0 / 50%)',
            '--tw-prose-invert-pre-code': 'var(--text-primary)',
            '--tw-prose-invert-quote-borders': 'var(--text-primary)',
            '--tw-prose-invert-quotes': 'var(--text-primary)',
            '--tw-prose-invert-td-borders': 'var(--text-primary)',
            '--tw-prose-invert-th-borders': 'var(--text-primary)',
            '--tw-prose-lead': 'var(--text-primary)',
            '--tw-prose-links': 'var(--text-primary)',
            '--tw-prose-pre-bg': 'var(--text-primary)',
            '--tw-prose-pre-code': 'var(--text-primary)',
            '--tw-prose-quote-borders': 'var(--text-primary)',
            '--tw-prose-quotes': 'var(--text-primary)',
            '--tw-prose-td-borders': 'var(--text-primary)',
            '--tw-prose-th-borders': 'var(--text-primary)',
          },
        },
      }),
    },
  },
}

export default config
