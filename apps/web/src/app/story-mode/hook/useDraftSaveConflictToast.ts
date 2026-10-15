'use client'

import { toast } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useEffect, useRef } from 'react'

import { longtakeHistoryStore } from '@/atom/longtake-history.store'

// Guards the false->true edge across every mount: the V1 and V2 renderers
// each initialize the draft store and can both mount this hook, but the
// underlying conflict is a single session-wide event and must surface once.
let hasShownConflictToast = false
// A fixed id, passed through `id`, so this exact toast can be dismissed later.
const CONFLICT_TOAST_ID = 'longtake-draft-save-conflict'

/**
 * Surfaces the editor draft save conflict (a rejected, wedged save) that was
 * previously swallowed silently. Fires a persistent toast on the false->true
 * edge of draftSaveConflictAtom; a reload is the only recovery, since the
 * store halts further saves once conflicted.
 */
export function useDraftSaveConflictToast() {
  const hasConflict = useAtomValue(longtakeHistoryStore.draftSaveConflictAtom)
  const wasConflicted = useRef(false)
  const toastId = useRef<null | number | string>(null)

  useEffect(() => {
    if (hasConflict && !wasConflicted.current && !hasShownConflictToast) {
      hasShownConflictToast = true
      toastId.current = CONFLICT_TOAST_ID
      toast.error('Some recent changes could not be saved', {
        action: {
          label: 'Reload',
          onClick: () => window.location.reload(),
        },
        description: 'Reload the page to get the latest saved version.',
        duration: Infinity,
        id: CONFLICT_TOAST_ID,
      })
    }
    wasConflicted.current = hasConflict
    if (!hasConflict) {
      hasShownConflictToast = false
      if (toastId.current !== null) {
        toast.dismiss(toastId.current)
        toastId.current = null
      }
    }
  }, [hasConflict])
}
