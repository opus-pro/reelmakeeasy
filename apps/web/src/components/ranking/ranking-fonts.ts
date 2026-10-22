'use client'

import type { RankingFonts } from '@reelmakeeasy/common/ranking/ranking-overlay'
import {
  RANKING_FONT_FACES,
  RANKING_FONT_IDS,
  rankingFontFamily,
} from '@reelmakeeasy/common/ranking/ranking-type'

/** The family name the studio loads Montserrat under (its own, so nothing else is affected). */
const FAMILY = 'RME Ranking'

/** The faces the overlay draws with: ExtraBold for the title and labels, Black for the numbers. */
const FACES = [
  { file: 'Montserrat-ExtraBold.ttf', weight: '800' },
  { file: 'Montserrat-Black.ttf', weight: '900' },
] as const

export const STUDIO_RANKING_FONTS: RankingFonts = {
  label: `"${FAMILY}", "Arial Black", sans-serif`,
  number: `"${FAMILY}", "Arial Black", sans-serif`,
  title: `"${FAMILY}", "Arial Black", sans-serif`,
}

let loading: null | Promise<boolean> = null

/**
 * Loads the render pack's fonts into the page (from the API's font route), once: Montserrat for
 * the default look, and every font a ranking can pick (`RME <id>`, each one face that answers for
 * any weight, so nothing is faked bold). Resolves false when Montserrat can't load (no pack yet):
 * the overlay then draws in the fallback fonts; a pick that fails falls back the same way.
 */
export function loadRankingFonts(apiOrigin: string): Promise<boolean> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined')
    return Promise.resolve(false)
  const url = (file: string) => {
    const href = `${apiOrigin}/api/caption-fonts/pack/${file}`
    return `url(${JSON.stringify(href)})`
  }
  const add = async (family: string, file: string, weight: string) =>
    document.fonts.add(await new FontFace(family, url(file), { weight }).load())
  loading ??= Promise.all([
    ...FACES.map(({ file, weight }) => add(FAMILY, file, weight)),
    ...RANKING_FONT_IDS.filter((id) => id !== 'montserrat').map((id) =>
      add(rankingFontFamily(id), RANKING_FONT_FACES[id].file, '100 900').catch(() => undefined),
    ),
  ])
    .then(() => true)
    .catch(() => {
      loading = null
      return false
    })
  return loading
}
