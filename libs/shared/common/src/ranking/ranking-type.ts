import type { RankingFontId, RankingStyle } from '@shared/types/api/ranking'

/**
 * The fonts a ranking can use, from the render font pack: the face file the browser loads (from
 * the API's pack font route) under its own family name, and a label for pickers. Montserrat is
 * the trend's look and the default for every part.
 */
export const RANKING_FONT_FACES: Record<RankingFontId, { file: string; label: string }> = {
  alegreya: { file: 'Alegreya-Black.ttf', label: 'Alegreya (bold serif)' },
  anton: { file: 'Anton-Regular.ttf', label: 'Anton (tall)' },
  dela: { file: 'DelaGothicOne-Regular.ttf', label: 'Dela Gothic (chunky)' },
  dmsans: { file: 'DMSans-Bold.ttf', label: 'DM Sans (rounded)' },
  montserrat: { file: 'Montserrat-Black.ttf', label: 'Montserrat (heavy)' },
  ptserif: { file: 'PTSerif-Bold.ttf', label: 'PT Serif' },
  roboto: { file: 'Roboto-Black.ttf', label: 'Roboto' },
}

export const RANKING_FONT_IDS = Object.keys(RANKING_FONT_FACES) as RankingFontId[]

export const isRankingFontId = (v: unknown): v is RankingFontId =>
  typeof v === 'string' && Object.hasOwn(RANKING_FONT_FACES, v)

/** The CSS family a font is loaded under (`loadRankingFonts`). */
export const rankingFontFamily = (id: RankingFontId) => `RME ${id}`

/** Keycap emoji for 0-10. */
const KEYCAPS = ['0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟']
const MEDALS = ['🥇', '🥈', '🥉']

/** The marks a custom format can't be longer than (a word and an emoji fit). */
export const RANKING_NUMBER_MARK_MAX = 12

/** How a rank is marked in the list, by the style's number format. */
export function rankMark(style: Pick<RankingStyle, 'numberFormat' | 'numberMarks'>, rank: number): string {
  switch (style.numberFormat ?? 'dot') {
    case 'custom': {
      return style.numberMarks?.[rank - 1]?.trim() || `${rank}.`
    }
    case 'hash': {
      return `#${rank}`
    }
    case 'keycap': {
      return KEYCAPS[rank] ?? `${rank}.`
    }
    case 'medal': {
      return MEDALS[rank - 1] ?? `${rank}.`
    }
    case 'plain': {
      return String(rank)
    }
    default: {
      return `${rank}.`
    }
  }
}
