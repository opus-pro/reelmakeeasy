'use client'

import type { AgentAnimationOptions } from '@shared/types/api/agent'
import { useEffect, useState } from 'react'

import { useApi } from '@/hooks/useApi'

let cached: AgentAnimationOptions | null = null

/** What the Claude Animation setup card offers (looks, lengths, music), loaded once. */
export function useAnimationOptions(): {
  error: boolean
  options: AgentAnimationOptions | null
  retry: () => void
} {
  const { fetchApiDomain } = useApi()
  const [options, setOptions] = useState<AgentAnimationOptions | null>(cached)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (cached) return undefined
    let live = true
    setError(false)
    fetchApiDomain<AgentAnimationOptions>('/api/agent/animation/options', { method: 'GET' })
      .then((response) => {
        cached = response.data
        if (live) setOptions(response.data)
      })
      .catch(() => {
        if (live) setError(true)
      })
    return () => {
      live = false
    }
  }, [attempt, fetchApiDomain])

  return { error, options, retry: () => setAttempt((n) => n + 1) }
}
