/** One Tailwind `fontSize` value: `[size, { lineHeight, letterSpacing, fontWeight }]`. */
export interface FontSizeEntry {
  fontWeight: string
  letterSpacing: string
  lineHeight: string
}

// The app's text styles, all in Geist: [name, size px, weight, line height px, letter spacing px].
// `text-body-md` and friends come from here; libs/shared/ui/src/lib/utils.ts lists the same names
// so cn() treats them as font sizes.
const TEXT_STYLES: readonly (readonly [string, number, number, number, number])[] = [
  ['h1', 80, 600, 86.4, -4.2],
  ['h2', 64, 600, 69.2, -3.36],
  ['h3', 48, 600, 51.8, -2.4],
  ['h4', 36, 600, 39.6, -1.08],
  ['h5', 24, 600, 28.8, -0.6],
  ['h6', 18, 600, 21.8, 0],
  ['label-lg', 18, 500, 22, 0],
  ['label-md', 16, 500, 20, 0],
  ['label-sm', 14, 500, 17, 0],
  ['label-xs', 12, 500, 15, 0],
  ['body-lg', 20, 400, 30, -0.92],
  ['body-md', 16, 400, 26, -0.12],
  ['body-sm', 14, 400, 22, 0],
  ['body-xs', 12, 400, 19, 0],
  ['section-lg', 18, 600, 23, 0.5],
  ['section-md', 16, 600, 20, 0.2],
  ['section-sm', 14, 500, 18, 0.1],
]

/** Tailwind `theme.extend.fontSize` for the shared preset: `text-h1` ... `text-section-sm`. */
export function createTailwindFontSize(): Record<string, [string, FontSizeEntry]> {
  return Object.fromEntries(
    TEXT_STYLES.map(([name, size, weight, lineHeight, tracking]) => [
      name,
      [
        `${size}px`,
        {
          lineHeight: `${lineHeight}px`,
          letterSpacing: `${tracking}px`,
          fontWeight: String(weight),
        },
      ],
    ]),
  )
}
