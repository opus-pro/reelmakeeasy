'use client'

import type { AgentMotionOptions } from '@shared/types/api/agent'
import { useEffect, useState } from 'react'

import { useApi } from '@/hooks/useApi'

let cached: AgentMotionOptions | null = null

/** What the Motion Reel setup card offers (reel types, music, lengths, shapes), loaded once. */
export function useMotionReelOptions(): {
  error: boolean
  options: AgentMotionOptions | null
  retry: () => void
} {
  const { fetchApiDomain } = useApi()
  const [options, setOptions] = useState<AgentMotionOptions | null>(cached)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (cached) return undefined
    let live = true
    setError(false)
    fetchApiDomain<AgentMotionOptions>('/api/agent/motion-reel/options', { method: 'GET' })
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
