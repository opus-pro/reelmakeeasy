import { Suspense } from 'react'

import AppSidebar from '@/components/AppSidebar'
import { RankingHome } from '@/components/ranking/RankingHome'

/** Ranking Builder: make ranking shorts (a title, ranks 1..N, a clip per rank, labels revealed). */
export default function RankingPage() {
  return (
    <div className="min-h-screen bg-background">
      <div className="flex min-h-screen flex-col md:flex-row">
        <AppSidebar />
        <main className="flex min-h-screen min-w-0 flex-1 flex-col">
          <Suspense>
            <RankingHome />
          </Suspense>
        </main>
      </div>
    </div>
  )
}
