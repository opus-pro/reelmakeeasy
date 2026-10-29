import { captionChunks, litWord } from '../caption-chunks'
import { voiceLines } from '../clock'

import { textWidth } from './font'

/** The pixel HUD (`E.hud`), as far as the narration caption uses it. */
type Hud = {
  C: Record<string, string>
  panel: (x: number, y: number, w: number, h: number) => void
  text: (
    s: string,
    x: number,
    y: number,
    o?: { align?: string; color?: string; u?: number },
  ) => number
}

/** The cell size and the most text one caption row may take (inside a 6% margin). */
const U = 5
const MAX_W = 1080 * 0.88

/**
 * The narrator's words at t, in the pixel font, at `y` (default 1712, above the bottom edge): the
 * line paged a phrase at a time (as the app's captions page), the phrase being said shown whole,
 * its current word lit in `accent`. Call it in `update(t)` after the scene's own HUD.
 */
export function narration(
  H: Hud,
  t: number,
  { accent, y = 1712 }: { accent?: string; y?: number } = {},
): void {
  const line = voiceLines.find((l) => t >= l.start - 0.05 && t <= l.end + 0.15)
  if (!line) return
  // Pages of whole phrases, as the app's captions page (up to 6 words, breaking after punctuation),
  // a page too wide for the row split in two.
  const rows = captionChunks(line.words, 6).flatMap((c) => {
    const words = c.words
    const text = words.map((w) => w.text.toUpperCase()).join(' ')
    if (words.length < 2 || textWidth(text, U) <= MAX_W) return [words]
    const half = Math.ceil(words.length / 2)
    return [words.slice(0, half), words.slice(half)]
  })
  const row =
    rows.find((r) => t <= (r.at(-1)?.end ?? 0) + 0.05) ?? (rows.at(-1) as typeof line.words)
  const text = row.map((w) => w.text.toUpperCase()).join(' ')
  const width = textWidth(text, U)
  H.panel(540 - width / 2 - 6 * U, y - 4 * U, width + 12 * U, 15 * U)
  let x = 540 - width / 2
  const lit = litWord({ from: 0, to: 0, words: row }, t)
  for (const [i, w] of row.entries()) {
    const word = w.text.toUpperCase()
    const now = i === lit
    H.text(word, x, y, { color: now ? (accent ?? H.C['yellow']) : H.C['ink'], u: U })
    x += textWidth(`${word} `, U) + U
  }
}
