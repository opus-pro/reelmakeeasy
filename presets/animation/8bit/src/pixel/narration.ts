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
 * line cut into short rows of whole words, the row being said shown, its current word lit in
 * `accent`. Call it in `update(t)` after the scene's own HUD.
 */
export function narration(
  H: Hud,
  t: number,
  { accent, y = 1712 }: { accent?: string; y?: number } = {},
): void {
  const line = voiceLines.find((l) => t >= l.start - 0.05 && t <= l.end + 0.15)
  if (!line) return
  const rows: (typeof line.words)[] = [[]]
  for (const w of line.words) {
    const row = rows[rows.length - 1] as typeof line.words
    const next = [...row, w].map((x) => x.text.toUpperCase()).join(' ')
    if (row.length && textWidth(next, U) > MAX_W) rows.push([w])
    else row.push(w)
  }
  const row =
    rows.find((r) => t <= (r.at(-1)?.end ?? 0) + 0.05) ?? (rows.at(-1) as typeof line.words)
  const text = row.map((w) => w.text.toUpperCase()).join(' ')
  const width = textWidth(text, U)
  H.panel(540 - width / 2 - 6 * U, y - 4 * U, width + 12 * U, 15 * U)
  let x = 540 - width / 2
  for (const w of row) {
    const word = w.text.toUpperCase()
    const now = t >= w.start && t <= w.end + 0.05
    H.text(word, x, y, { color: now ? (accent ?? H.C['yellow']) : H.C['ink'], u: U })
    x += textWidth(`${word} `, U) + U
  }
}
