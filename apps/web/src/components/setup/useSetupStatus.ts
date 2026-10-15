'use client'

import type { SetupStatus } from '@shared/types/api/setup'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'react'

import { useApi } from '@/hooks/useApi'
import { MODELS_QUERY_KEY } from '@/hooks/useModels'
import { isApiError } from '@/lib/api-error'

import { CHECK_FAILED, NOT_THIS_COMPUTER, SAVE_FAILED, type SavePlan } from './setup-status'

/** Queries whose answers follow the video maker in force (phase 3): the clip-model and quality
 *  menus, the voice picker and the engine chips. `['models']` never goes stale on its own. */
const GENERATION_QUERY_KEYS = [MODELS_QUERY_KEY, ['voice-over-options'], ['tts-engines']] as const

/** What the Setup card reads and does. */
export interface SetupStatusState {
  /** Why the last check or save failed, in words; null when it worked. */
  error: null | string
  /** A check is running (the first read, or Check again). */
  loading: boolean
  /** Reads the status again, asking Codex and Claude Code afresh. */
  recheck: () => Promise<void>
  /** Stores the answers, then reads the status again; false when the API refused. A stored video
   *  maker also refreshes the model, voice and engine lists the composer shows. */
  save: (plan: SavePlan) => Promise<boolean>
  saving: boolean
  status: null | SetupStatus
}

/** The setup status from `GET /api/setup/status`: which keys exist (never their values), the
 *  agents, and the choices in effect. */
export function useSetupStatus(): SetupStatusState {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<null | SetupStatus>(null)
  const [error, setError] = useState<null | string>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const read = useCallback(
    async (refresh: boolean) => {
      setLoading(true)
      try {
        const { data } = await fetchApiDomain<SetupStatus>(
          refresh ? '/api/setup/status?refresh=1' : '/api/setup/status',
          { method: 'GET' },
        )
        setStatus(data)
        setError(null)
      } catch (err) {
        // 403: the page was opened from another computer or through a proxy.
        setError(isApiError(err) && err.isForbidden ? NOT_THIS_COMPUTER : CHECK_FAILED)
      } finally {
        setLoading(false)
      }
    },
    [fetchApiDomain],
  )

  useEffect(() => {
    void read(false)
  }, [read])

  const recheck = useCallback(() => read(true), [read])

  const save = useCallback(
    async (plan: SavePlan) => {
      setSaving(true)
      try {
        if (plan.llm) {
          await fetchApiDomain('/api/setup/llm', { data: { provider: plan.llm }, method: 'PUT' })
        }
        if (plan.generation) {
          await fetchApiDomain('/api/setup/generation', {
            data: { provider: plan.generation },
            method: 'PUT',
          })
          // The composer's lists were read for the old video maker: refetch the ones on screen,
          // and the rest the next time they mount.
          for (const queryKey of GENERATION_QUERY_KEYS) {
            void queryClient.invalidateQueries({ queryKey })
          }
        }
        await read(false)
        return true
      } catch (err) {
        if (isApiError(err)) setError(err.isForbidden ? NOT_THIS_COMPUTER : err.message)
        else setError(SAVE_FAILED)
        return false
      } finally {
        setSaving(false)
      }
    },
    [fetchApiDomain, queryClient, read],
  )

  return { error, loading, recheck, save, saving, status }
}
