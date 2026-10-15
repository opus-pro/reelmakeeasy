'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

import { buildQuery } from '@/util/build-url-with-query'

// Type representing the destination workflow context for quick-start navigation.
// 'videos' left this union with the AI UGC entrance sunset (2026-08-05): no
// caller navigates to the legacy video workflow anymore, so nothing can write
// ?create=ai-ugc-video internally.
export type QuickStartNavigationType = 'story-mode'

type QueryValue = null | string | undefined

// Maps navigation type to its canonical route path.
const TYPE_TO_PATH: Record<QuickStartNavigationType, string> = {
  'story-mode': '/story-mode',
}

// Centralizes navigation for quick-start / recreate actions: navigates to the
// canonical route for the type with any supplied query params, replacing the
// entry when already on that path.
export function useQuickStartNavigation() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const navigate = (
    type: QuickStartNavigationType,
    query?: Readonly<Record<string, QueryValue>>,
  ) => {
    const newPathname = TYPE_TO_PATH[type]

    if (pathname === newPathname) {
      router.replace(`${newPathname}${buildQuery(query, searchParams)}`)
    } else {
      router.push(`${newPathname}${buildQuery(query)}`)
    }
  }

  return { navigate }
}
