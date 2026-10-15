/** Fixed colors with no CSS variable behind them. */
export const LITERAL_COLORS = {
  actionCard: '#424242',
  actionCardHover: '#484848',
  error: '#E5484D',
  highlight: '#FFC823',
  success: '#3AFEBD',
  warn: '#FFA057',
} as const

/**
 * Tailwind `theme.extend.colors` for the shared preset. Most colors read a CSS variable set in
 * ui-colors.css; `withAlphaVar` (from tailwind.preset.ts) wraps one so `/NN` opacity modifiers
 * work. A few variables hold bare channels instead of a full color, so they keep Tailwind's
 * `<alpha-value>` form.
 */
export function createTailwindColors(
  withAlphaVar: (cssVar: string) => string,
): Record<string, unknown> {
  // { DEFAULT: --name, foreground: --name-foreground }, the shadcn pair most colors use.
  const pair = (name: string) => ({
    DEFAULT: withAlphaVar(`--${name}`),
    foreground: withAlphaVar(`--${name}-foreground`),
  })

  // Key order is kept as it was: Tailwind emits same-utility classes in this order.
  return {
    accent: {
      DEFAULT: withAlphaVar('--accent'),
      blue: 'rgb(var(--accent-blue) / <alpha-value>)',
      foreground: withAlphaVar('--accent-foreground'),
      green: 'hsla(var(--accent-green), <alpha-value>)',
      orange: 'rgb(var(--accent-orange) / <alpha-value>)',
    },
    background: withAlphaVar('--bg-background'),
    uiBlack: withAlphaVar('--ui-bg-black'),
    card: { ...pair('card'), hover: withAlphaVar('--card-hover') },
    destructive: pair('destructive'),
    error: LITERAL_COLORS.error,
    // Plain text color (text-foreground); --foreground points at the primary text color.
    foreground: withAlphaVar('--foreground'),
    fill: {
      DEFAULT: withAlphaVar('--fill-primary'),
      disabled: withAlphaVar('--fill-disabled'),
      hover: withAlphaVar('--fill-hover'),
      secondary: withAlphaVar('--fill-secondary'),
      tertiary: withAlphaVar('--fill-tertiary'),
    },
    input: withAlphaVar('--input'),
    /** Keyboard focus: the brand blue (`--ring`), for `ring-ring` and the global outline. */
    ring: withAlphaVar('--ring'),
    muted: pair('muted'),
    popover: pair('popover'),
    primary: pair('primary'),
    secondary: pair('secondary'),
    success: LITERAL_COLORS.success,
    // No --tertiary-foreground exists, so tertiary is a single color.
    tertiary: withAlphaVar('--tertiary'),
    menu: {
      DEFAULT: 'hsl(var(--ui-bg-menu) / <alpha-value>)',
      background: withAlphaVar('--ui-bg-overlay-subtle'),
    },
    warn: LITERAL_COLORS.warn,
    highlight: LITERAL_COLORS.highlight,
    'action-card': { DEFAULT: LITERAL_COLORS.actionCard, hover: LITERAL_COLORS.actionCardHover },
  }
}
