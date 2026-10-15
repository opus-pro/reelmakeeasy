'use client'

import type { CaptionPackFamily } from '@shared/types/api/caption-style'
import { useQuery } from '@tanstack/react-query'
import { useAtomValue } from 'jotai'
import { useEffect, useState } from 'react'

import { apiOriginAtom } from '@/atom/apiOrigin'
import { useApi } from '@/hooks/useApi'

import {
  CAPTION_PACK_FAMILIES,
  captionFontSampleUrl,
  isCaptionFontSampleLoaded,
  isCaptionPackFamily,
  loadCaptionFontSample,
  sampleFontFamily,
} from './caption-fonts'
import { getCaptionFonts } from './caption-fonts.api'

/** One read of the caption fonts per page, shared by every Font list. */
export const captionFontsQueryKey = ['caption-fonts'] as const

type DrawnSamples = Partial<Record<CaptionPackFamily, string>>

const samplesInPage = (): DrawnSamples =>
  Object.fromEntries(
    CAPTION_PACK_FAMILIES.filter(isCaptionFontSampleLoaded).map((f) => [f, sampleFontFamily(f)]),
  )

/**
 * The CSS family each built-in font's name can be drawn in, once its sample is in the page.
 * Nothing is read until `open` (the Font list opened); then the list of fonts is read once
 * per page and each sample is added with FontFace (`loadCaptionFontSample`). A font whose
 * sample is still loading, or failed, is missing: its name stays in the app's own font.
 */
export function useCaptionFontSamples(open: boolean): DrawnSamples {
  const { fetchApiDomain } = useApi()
  const apiOrigin = useAtomValue(apiOriginAtom)
  const { data } = useQuery({
    enabled: open,
    queryFn: () => getCaptionFonts(fetchApiDomain),
    queryKey: captionFontsQueryKey,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Infinity,
  })
  const [drawn, setDrawn] = useState<DrawnSamples>(samplesInPage)

  useEffect(() => {
    if (!open || !data) return
    let live = true
    for (const { family, sampleUrl } of data) {
      if (!isCaptionPackFamily(family)) continue
      const url = captionFontSampleUrl(sampleUrl, apiOrigin)
      if (!url) continue
      void loadCaptionFontSample(family, url).then((ok) => {
        if (!ok || !live) return
        setDrawn((prev) => (prev[family] ? prev : { ...prev, [family]: sampleFontFamily(family) }))
      })
    }
    return () => {
      live = false
    }
  }, [apiOrigin, data, open])

  return drawn
}
