import type { CaptionFontsResponse, CaptionPackFontInfo } from '@shared/types/api/caption-style'

import type { FetchApiDomain } from '@/hooks/useApi'

/** The caption fonts the Font list offers (GET /api/caption-fonts). */
export async function getCaptionFonts(
  fetchApiDomain: FetchApiDomain,
): Promise<CaptionPackFontInfo[]> {
  const res = await fetchApiDomain<CaptionFontsResponse>('/api/caption-fonts', {
    method: 'GET',
    noThrowError: true,
  })
  if (!res.ok) {
    throw new Error(res.error || "Couldn't read the caption fonts")
  }
  return res.data?.data?.pack ?? []
}
