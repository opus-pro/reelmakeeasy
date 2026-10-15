'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { usePathname, useRouter } from 'next/navigation'
import { useMemo } from 'react'

import { shouldShowOngoingNotificationByRoute } from '@/components/global-floating/route-policy'
import { useIsMobile } from '@/util/browserUtils'

import type { OngoingProjectsNotificationItem } from './OngoingProjectsNotificationView'
import { OngoingProjectsNotificationView } from './OngoingProjectsNotificationView'
import { useBgmActivityItems } from './useBgmActivityItems'
import { useOngoingProjectsNotificationItems } from './useOngoingProjectsNotificationItems'
import {
  getConnectedFallbackPollingEnabled,
  getOngoingNotificationEnabled,
  resolveJobRollupTotals,
} from './utils'

const SEE_ALL_PROJECTS_PATH = '/projects'

const nsLogger = Logger.get('ongoing-projects-notification')

type OngoingProjectsNotificationProps = {
  visible?: boolean
}

export function OngoingProjectsNotification({ visible = true }: OngoingProjectsNotificationProps) {
  const isMobile = useIsMobile()
  const pathname = usePathname()

  const isEnabledLocally = getOngoingNotificationEnabled()
  const connectedFallbackPollingEnabled = getConnectedFallbackPollingEnabled()

  const isEnabled = isEnabledLocally ?? false

  nsLogger.log('enable_ongoing_projects_notification', {
    connectedFallbackPollingEnabled,
    isEnabled,
    isEnabledLocally,
  })

  const normalizedPathname =
    pathname && pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const isDebugPage = normalizedPathname?.endsWith('/debug')

  if (!isEnabled || isMobile || isDebugPage) {
    return null
  }

  return (
    <OngoingProjectsNotificationInner
      enableConnectedFallbackPolling={connectedFallbackPollingEnabled}
      visible={visible}
    />
  )
}

function OngoingProjectsNotificationInner({
  enableConnectedFallbackPolling,
  visible,
}: {
  enableConnectedFallbackPolling: boolean
  visible: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()
  const shouldShowByRoute = shouldShowOngoingNotificationByRoute(pathname)
  const isVisible = shouldShowByRoute && visible
  const isSyncPaused = !isVisible
  const {
    allTotal,
    ongoingTotal,
    items: runningProjects,
    isConnected,
    isLoading,
    isReconnecting,
    loadMore,
    reconnect,
  } = useOngoingProjectsNotificationItems({
    enableConnectedFallbackPolling,
    isSyncPaused,
  })
  // A project whose own video is generating already says so on its
  // own row -- its BGM row is suppressed there.
  const generatingProjectIds = useMemo(
    () =>
      new Set(
        runningProjects
          .filter((item) => item.status === 'generating' && item.projectId !== undefined)
          .map((item) => item.projectId as string),
      ),
    [runningProjects],
  )
  const bgmItems = useBgmActivityItems({ generatingProjectIds, paused: isSyncPaused })
  const jobItems = bgmItems
  const jobTotals = useMemo(
    () => resolveJobRollupTotals(jobItems, allTotal, ongoingTotal),
    [allTotal, jobItems, ongoingTotal],
  )
  // Job rows lead the list: they are the thing currently happening.
  const items = useMemo(() => [...jobItems, ...runningProjects], [jobItems, runningProjects])

  if (!isVisible) {
    return null
  }

  // A job row stands on its own -- it shows even when the project timeline is
  // still loading or has nothing recent to report.
  if (jobItems.length === 0 && (isLoading || runningProjects.length === 0)) {
    return null
  }

  const handleSeeAllClick = () => {
    router.push(SEE_ALL_PROJECTS_PATH)
  }

  const handleItemClick = (item: OngoingProjectsNotificationItem) => {
    router.push(item.href)
  }

  return (
    <OngoingProjectsNotificationView
      // Job rows are work the server totals know nothing about, so they are
      // folded in here to keep the collapsed badge honest while one runs.
      allTotal={jobTotals.allTotal}
      animateGeneratingIcon
      isConnected={isConnected}
      isReconnecting={isReconnecting}
      items={items}
      maxVisibleItems={10}
      ongoingTotal={jobTotals.ongoingTotal}
      onItemClick={handleItemClick}
      onReachBottom={loadMore}
      onReconnect={reconnect}
      onSeeAllClick={handleSeeAllClick}
    />
  )
}
