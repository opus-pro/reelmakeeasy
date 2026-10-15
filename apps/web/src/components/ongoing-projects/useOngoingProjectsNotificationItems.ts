'use client'

import { Project } from '@shared/types/api/project'
import { PROJECT_STAGE } from '@shared/types/enums/project'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useFileUrl } from '@/hooks/use-file-url'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useApi } from '@/hooks/useApi'
import { createSharedSSEConnectionFactory } from '@/util/shared-sse-connection'

import {
  createOngoingProjectsNotificationState,
  OngoingProjectsNotificationStateValue,
} from './OngoingProjectsNotificationState'
import type { OngoingProjectsNotificationItem } from './OngoingProjectsNotificationView'
import type { OngoingProjectsNotificationItemsResult } from './useOngoingProjectsNotificationItems.types'
import { getCreatedFromBaseline, resolveProjectTitle } from './utils'

type UseOngoingProjectsNotificationItemsOptions = {
  enableConnectedFallbackPolling?: boolean
  isSyncPaused?: boolean
}

export function useOngoingProjectsNotificationItems(
  options: UseOngoingProjectsNotificationItemsOptions = {},
): OngoingProjectsNotificationItemsResult {
  const { enableConnectedFallbackPolling = true, isSyncPaused = false } = options
  const { addImgHostname } = useFileUrl()
  const { fetchApiDomain: rawFetchApiDomain, createSSEConnection } = useApi()
  const fetchApiDomain = useRefCallback(rawFetchApiDomain)
  const queryClient = useQueryClient()
  const sharedCreateSSEConnection = useMemo(
    () => createSharedSSEConnectionFactory(createSSEConnection),
    [createSSEConnection],
  )

  const timelineRef = useRef<ReturnType<typeof createOngoingProjectsNotificationState>>(null)

  const [state, setState] = useState<OngoingProjectsNotificationStateValue>({
    allTotal: 0,
    error: null,
    isConnected: false,
    isLoading: false,
    isReconnecting: false,
    ongoingTotal: 0,
    items: [],
  })

  useEffect(() => {
    const timeline = createOngoingProjectsNotificationState({
      createSSEConnection: sharedCreateSSEConnection,
      createdFromBaseline: getCreatedFromBaseline(),
      enableConnectedFallbackPolling,
      fetchApiDomain,
      isSyncPaused,
      onStateChange: setState,
      queryClient,
    })
    timelineRef.current = timeline
    timeline.start()
    return () => {
      timelineRef.current = null
      timeline.dispose()
    }
  }, [enableConnectedFallbackPolling, fetchApiDomain, queryClient, sharedCreateSSEConnection])

  useEffect(() => {
    timelineRef.current?.setSyncPaused(isSyncPaused)
  }, [isSyncPaused])

  const loadMore = useRefCallback(() => timelineRef.current?.loadMore())

  const reconnect = useRefCallback(() => timelineRef.current?.reconnect())

  const items = useMemo(() => {
    const visible: OngoingProjectsNotificationItem[] = []

    const baseline = getCreatedFromBaseline()
    for (const { id, project, createdAt } of state.items) {
      const status = resolveProjectStatus(project)

      // Safety net: hide items older than the createdFrom baseline (primary filtering is server-side)
      if (createdAt < baseline) {
        continue
      }

      visible.push({
        href: resolveProjectHref(project),
        id,
        kind: 'project',
        projectId: project.id,
        status,
        subtitle: resolveProjectType(project),
        thumbnail: addImgHostname(project.previewThumbnail || project.resultVideoThumbnail),
        title: resolveProjectTitle(project),
      })
    }

    return visible
  }, [addImgHostname, state.items])

  const allTotal = Math.max(0, state.allTotal)
  const ongoingTotal = Math.min(Math.max(0, state.ongoingTotal), allTotal)

  return {
    allTotal,
    ongoingTotal,
    items,
    isConnected: state.isConnected,
    isLoading: state.isLoading,
    isReconnecting: state.isReconnecting,
    loadMore,
    reconnect,
    error: state.error,
  }
}

function resolveProjectHref(project: Project): string {
  if (project.isLongTake) {
    return `/story-mode/${project.id}`
  }
  return `/projects/${project.id}`
}

function resolveProjectStatus(project: Project): OngoingProjectsNotificationItem['status'] {
  if (project.stage === PROJECT_STAGE.FAILED || project.stage === PROJECT_STAGE.CANCELED) {
    return 'error'
  }
  if (project.stage === PROJECT_STAGE.EDITOR || project.stage === PROJECT_STAGE.FINISHED) {
    return 'ready'
  }
  if (project.resultVideo) {
    return 'ready'
  }
  return 'generating'
}

function resolveProjectType(project: Project): string {
  if (project.isLongTake) {
    return 'Story Mode'
  }
  return 'Video'
}
