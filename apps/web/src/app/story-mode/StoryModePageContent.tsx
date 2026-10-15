'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { useEffect, useMemo } from 'react'

export function StoryModePageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const homeUrl = useMemo(() => {
    const query = searchParams?.toString()
    return query ? `/home?${query}` : '/home'
  }, [searchParams])

  useEffect(() => {
    router.replace(homeUrl)
  }, [homeUrl, router])

  return null
}
