'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import type { SharedProject } from '@shared/types/api/shared'
import { AccessLevel } from '@shared/types/api/shared'
import { toast } from '@shared/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useRefCallback } from '@/hooks/use-ref-callback'
import { useProjectWritePermission } from '@/hooks/useProjectWritePermission'
import { COPIED_TOAST_DURATION_MS, showLinkCopiedToast } from '@/util/share-toast'

import { useSearchByProjectId, useShareProject, useUpdateAccessLevel } from './useShareProject'

const nsLogger = Logger.get('project.use-project-share-controls')

/**
 * @param projectOverride - pass from list cards so the write-permission check
 *   knows the project owner; detail pages can omit it.
 * @param options.enabled - defaults to true; pass false to defer the
 *   share-state fetch until the caller actually needs it (e.g. a card's
 *   share menu hasn't been opened yet).
 */
export function useProjectShareControls(
  projectId: null | string,
  projectOverride?: { owner?: null | string },
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true
  const [isCopied, setIsCopied] = useState(false)
  const [sharedProjectId, setSharedProjectId] = useState('')
  const [isPublic, setIsPublic] = useState(false)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const pendingAccessLevelRef = useRef<AccessLevel | null>(null)
  const isSyncingRef = useRef(false)
  const serverAccessLevelRef = useRef<AccessLevel>(AccessLevel.PRIVATE)
  const sharedProjectIdRef = useRef('')
  const queryClient = useQueryClient()

  const { accessLevel: queryAccessLevel, sharedProjectId: querySharedProjectId } =
    useSearchByProjectId(projectId ?? '', enabled)
  const { createSharedProject, isCreating } = useShareProject()
  const { updateAccessLevel, isUpdating } = useUpdateAccessLevel()
  const { canEdit } = useProjectWritePermission(projectOverride)

  useEffect(() => {
    sharedProjectIdRef.current = querySharedProjectId
    setSharedProjectId(querySharedProjectId)

    const nextAccessLevel = querySharedProjectId ? queryAccessLevel : AccessLevel.PRIVATE
    serverAccessLevelRef.current = nextAccessLevel

    if (
      pendingAccessLevelRef.current === null ||
      pendingAccessLevelRef.current === nextAccessLevel
    ) {
      pendingAccessLevelRef.current = null
      setIsPublic(nextAccessLevel === AccessLevel.PUBLIC)
    }
  }, [queryAccessLevel, querySharedProjectId])

  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
    }
  }, [])

  const updateSharedProjectQuery = useRefCallback(
    (nextSharedProjectId: string, nextAccessLevel: AccessLevel) => {
      if (!projectId || !nextSharedProjectId) {
        return
      }

      queryClient.setQueryData<SharedProject | undefined>(
        ['searchByProjectId', projectId],
        (prev) => ({
          accessLevel: nextAccessLevel,
          disabled: prev?.disabled ?? false,
          owner: prev?.owner ?? '',
          projectId,
          sharedProjectId: nextSharedProjectId,
        }),
      )
    },
  )

  const ensureCanEdit = useRefCallback(() => {
    if (canEdit) {
      return true
    }

    toast.warning('Only the project owner can perform this action.')
    return false
  })

  const genCopyLink = useRefCallback((nextSharedProjectId: string) => {
    return new URL(`/share/${nextSharedProjectId}`, window.location.origin).toString()
  })

  const genDisplayLink = useRefCallback((nextSharedProjectId: string) => {
    return genCopyLink(nextSharedProjectId).replace(/^https?:\/\//, '')
  })

  const copyShareLinkById = useRefCallback(
    async (nextSharedProjectId: string): Promise<boolean> => {
      if (!nextSharedProjectId) {
        return false
      }

      try {
        await navigator.clipboard.writeText(genCopyLink(nextSharedProjectId))

        showLinkCopiedToast()

        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }

        setIsCopied(true)
        timeoutRef.current = setTimeout(() => {
          setIsCopied(false)
          timeoutRef.current = null
        }, COPIED_TOAST_DURATION_MS)

        return true
      } catch (error) {
        nsLogger.error('Failed to copy share link:', error)
        toast.error('Failed to copy link')
        return false
      }
    },
  )

  const ensureSharedProject = useRefCallback(async (): Promise<string> => {
    if (sharedProjectIdRef.current) {
      return sharedProjectIdRef.current
    }
    if (!projectId) {
      return ''
    }
    if (!ensureCanEdit()) {
      return ''
    }

    try {
      const nextSharedProjectId = await createSharedProject.mutateAsync({ projectId })
      sharedProjectIdRef.current = nextSharedProjectId
      setSharedProjectId(nextSharedProjectId)
      serverAccessLevelRef.current = AccessLevel.PRIVATE
      updateSharedProjectQuery(nextSharedProjectId, AccessLevel.PRIVATE)
      return nextSharedProjectId
    } catch (error) {
      nsLogger.error('Failed to create shared project:', error)
      toast.warning(error instanceof Error ? error.message : 'Failed to create share link')
      return ''
    }
  })

  const runPendingAccessUpdate = useRefCallback(async () => {
    const nextSharedProjectId = sharedProjectIdRef.current
    const nextAccessLevel = pendingAccessLevelRef.current

    if (!nextSharedProjectId || nextAccessLevel === null || isSyncingRef.current) {
      return
    }
    if (nextAccessLevel === serverAccessLevelRef.current) {
      pendingAccessLevelRef.current = null
      return
    }

    isSyncingRef.current = true

    try {
      await updateAccessLevel.mutateAsync({
        accessLevel: nextAccessLevel,
        sharedProjectId: nextSharedProjectId,
      })

      serverAccessLevelRef.current = nextAccessLevel
      updateSharedProjectQuery(nextSharedProjectId, nextAccessLevel)

      if (pendingAccessLevelRef.current === nextAccessLevel) {
        pendingAccessLevelRef.current = null
      }

      if (
        nextAccessLevel === AccessLevel.PUBLIC &&
        pendingAccessLevelRef.current !== AccessLevel.PRIVATE
      ) {
        await copyShareLinkById(nextSharedProjectId)
      }
    } catch (error) {
      nsLogger.error('Failed to update access level:', error)
      pendingAccessLevelRef.current = null
      setIsPublic(serverAccessLevelRef.current === AccessLevel.PUBLIC)

      const message =
        typeof error === 'object' &&
        error !== null &&
        'response' in error &&
        typeof error.response === 'object' &&
        error.response !== null &&
        'data' in error.response &&
        typeof error.response.data === 'object' &&
        error.response.data !== null &&
        'message' in error.response.data &&
        typeof error.response.data.message === 'string'
          ? error.response.data.message
          : 'Failed to update access level'
      toast.warning(message)
    } finally {
      isSyncingRef.current = false

      if (
        pendingAccessLevelRef.current !== null &&
        pendingAccessLevelRef.current !== serverAccessLevelRef.current
      ) {
        void runPendingAccessUpdate()
      }
    }
  })

  const toggleAccess = useRefCallback(async (nextIsPublic: boolean) => {
    if (!ensureCanEdit()) {
      return
    }

    const nextAccessLevel = nextIsPublic ? AccessLevel.PUBLIC : AccessLevel.PRIVATE

    pendingAccessLevelRef.current = nextAccessLevel
    setIsPublic(nextIsPublic)

    if (!nextIsPublic && !sharedProjectIdRef.current) {
      pendingAccessLevelRef.current = null
      return
    }

    let nextSharedProjectId = sharedProjectIdRef.current
    if (!nextSharedProjectId && nextIsPublic) {
      nextSharedProjectId = await ensureSharedProject()
      if (!nextSharedProjectId) {
        pendingAccessLevelRef.current = null
        setIsPublic(serverAccessLevelRef.current === AccessLevel.PUBLIC)
        return
      }
    }

    if (pendingAccessLevelRef.current !== nextAccessLevel) {
      void runPendingAccessUpdate()
      return
    }

    if (!isSyncingRef.current) {
      if (nextAccessLevel === serverAccessLevelRef.current) {
        pendingAccessLevelRef.current = null
        if (nextAccessLevel === AccessLevel.PUBLIC && nextSharedProjectId) {
          await copyShareLinkById(nextSharedProjectId)
        }
        return
      }

      void runPendingAccessUpdate()
    }
  })

  const displayLink = useMemo(
    () => (sharedProjectId ? genDisplayLink(sharedProjectId) : ''),
    [genDisplayLink, sharedProjectId],
  )

  return {
    copyShareLink: () => copyShareLinkById(sharedProjectId),
    copyShareLinkById,
    displayLink,
    ensureSharedProject,
    isCopied,
    isLoading: isCreating || isUpdating,
    isPublic,
    sharedProjectId,
    toggleAccess,
  }
}
