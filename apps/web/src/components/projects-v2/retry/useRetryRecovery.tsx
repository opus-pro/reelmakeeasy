'use client'
import { toast } from '@shared/ui'
import { useRouter } from 'next/navigation'
import { type ReactNode, useRef, useState } from 'react'

import { useApi } from '@/hooks/useApi'
import { useDefaultVideoModelKey } from '@/hooks/useModels'

import { requestRegenerate } from './regenerate-request'
import { RetryRegenerateDialog } from './RetryRegenerateDialog'

/**
 * Retry recovery for a failed/cancelled long-take card. On the
 * "Retry" click we probe `/retry-eligibility`: when the source still has its
 * reusable artifacts we open a confirm dialog and regenerate (cheap, keyframe
 * reuse) into a new project; otherwise we fall back to the caller's full remix.
 * The probe failing for any reason also falls back to remix, so Retry never
 * leaves the user stuck.
 *
 * The regenerate runs on the registry's default video model (`GET /api/models`),
 * the same model first generation uses. The endpoint still requires an explicit
 * id, and it only accepts registry keys.
 */
export function useRetryRecovery({
  onFallbackRemix,
  projectId,
}: {
  onFallbackRemix: () => Promise<void> | void
  projectId: string
}): { handleRetry: () => Promise<void>; isPreparing: boolean; retryDialog: ReactNode } {
  const { fetchApiDomain } = useApi()
  const router = useRouter()
  const modelKey = useDefaultVideoModelKey()
  const [isChecking, setIsChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [dialogOpen, setDialogOpen] = useState(false)
  const busyRef = useRef(false)
  const submittingRef = useRef(false)

  const handleRetry = async () => {
    if (busyRef.current) {
      return
    }
    busyRef.current = true
    setIsChecking(true)
    try {
      const res = await fetchApiDomain<{ canRegenerate: boolean }>(
        `/api/long-take-videos/${projectId}/retry-eligibility`,
        { method: 'GET', noThrowError: true },
      )
      const canRegenerate = res.ok && res.data?.canRegenerate === true
      if (!canRegenerate) {
        await onFallbackRemix()
        return
      }
      setDialogOpen(true)
    } catch {
      await onFallbackRemix()
    } finally {
      busyRef.current = false
      setIsChecking(false)
    }
  }

  const handleConfirm = async () => {
    // Synchronous guard: a rapid double-click must not issue two regenerate
    // POSTs (which would create two projects). The button's
    // disabled state lags behind the state update, so gate on a ref.
    if (!modelKey || submittingRef.current) {
      return
    }
    submittingRef.current = true
    setSubmitting(true)
    try {
      const newProjectId = await requestRegenerate(fetchApiDomain, projectId, modelKey)
      if (!newProjectId) {
        throw new Error('Regeneration failed')
      }
      // Close before navigating so the dialog does not linger after the route
      // param changes. Leave submittingRef set: we are navigating away.
      setDialogOpen(false)
      setSubmitting(false)
      router.push(`/story-mode/${newProjectId}`)
    } catch {
      submittingRef.current = false
      setSubmitting(false)
      toast.error('Something went wrong. Please try again.')
    }
  }

  const retryDialog = (
    <RetryRegenerateDialog
      busy={submitting}
      canConfirm={Boolean(modelKey)}
      onConfirm={() => void handleConfirm()}
      onOpenChange={(open) => {
        if (!submitting) {
          setDialogOpen(open)
        }
      }}
      open={dialogOpen}
    />
  )

  return { handleRetry, isPreparing: isChecking || submitting, retryDialog }
}
