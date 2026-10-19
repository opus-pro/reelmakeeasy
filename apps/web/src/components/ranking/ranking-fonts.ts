'use client'

import type { RankingFonts } from '@reelmakeeasy/common/ranking/ranking-overlay'

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
 * Loads the render pack's Montserrat into the page (from the API's font route), once. Resolves
 * false when it can't (no pack yet): the overlay then draws in the fallback fonts.
 */
export function loadRankingFonts(apiOrigin: string): Promise<boolean> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') return Promise.resolve(false)
  loading ??= Promise.all(
    FACES.map(async ({ file, weight }) => {
      const face = new FontFace(FAMILY, `url(${JSON.stringify(`${apiOrigin}/api/caption-fonts/pack/${file}`)})`, {
        weight,
      })
      document.fonts.add(await face.load())
    }),
  )
    .then(() => true)
    .catch(() => {
      loading = null
      return false
    })
  return loading
}
