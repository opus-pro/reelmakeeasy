'use client'

import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { useEffect } from 'react'

import { buildQueryStringFromSearchParams } from '@/util/persisted-url-query-params'

export function PersistedRedirect({ paramName, target }: { paramName?: string; target: string }) {
  const params = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()

  useEffect(() => {
    const id = paramName ? params[paramName] : undefined
    const path = id ? `${target}/${id}` : target
    const qs = buildQueryStringFromSearchParams(searchParams)
    router.replace(`${path}${qs}`)
  }, [params, searchParams, router, target, paramName])

  return null
}
