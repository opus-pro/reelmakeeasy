import { Suspense } from 'react'

import { RankingHeadlessRender } from '@/components/ranking/RankingHeadlessRender'

/**
 * Not for people: the page the API opens in a headless browser to export a ranking when no
 * studio is open (an agent asked). It draws the overlays exactly as the studio does and starts
 * the render.
 */
export default function RankingRenderPage() {
  return (
    <Suspense>
      <RankingHeadlessRender />
    </Suspense>
  )
}
