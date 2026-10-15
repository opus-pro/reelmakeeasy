'use client'

import { LOCAL_USER_ID } from '@reelmakeeasy/common/auth/local-identity'
import { toast } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useCallback } from 'react'

import { canEditProjectAtom } from '@/atom/project'

// Pass this on pages where no project is focused (list cards): the global
// canEditProjectAtom reads the empty projectIdAtom and reports "not the owner"
// for everyone, including the real owner.
type ProjectWritePermissionOverride = { owner?: null | string }

/**
 * Guards project write operations. Pass `projectOverride` from list cards;
 * detail pages can omit it and fall back to the focused-project atom.
 */
export function useProjectWritePermission(projectOverride?: ProjectWritePermissionOverride) {
  const globalCanEdit = useAtomValue(canEditProjectAtom)

  // Check the given project's owner against the local user.
  const canEdit = projectOverride ? projectOverride.owner === LOCAL_USER_ID : globalCanEdit

  const guard = useCallback(
    <T extends Function>(callback: T): T => {
      return ((...args: unknown[]) => {
        if (!canEdit) {
          toast.warning('Only the project owner can perform this action.')
          // Return a resolved Promise to maintain Promise contract for async callbacks
          // This ensures that callers can safely use .then(), .catch(), or await
          // even when permission is denied. The outer type cast (as unknown as T)
          // preserves the original function signature.
          return Promise.resolve()
        }
        return (callback as unknown as (...args: unknown[]) => unknown)(...args)
      }) as unknown as T
    },
    [canEdit],
  )

  return {
    canEdit,
    guard,
  }
}
