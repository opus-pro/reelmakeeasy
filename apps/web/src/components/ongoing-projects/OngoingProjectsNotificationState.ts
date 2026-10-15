'use client'

import { CoalescingQueue } from '@reelmakeeasy/common/utils/coalescing-queue'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import { createMapFn } from '@reelmakeeasy/common/utils/memo-fn'
import { Timeline, TimelineState } from '@reelmakeeasy/common/utils/multi-source-timeline/timeline'
import { createTimelineResyncBuilder } from '@reelmakeeasy/common/utils/multi-source-timeline/timeline-builder'
import type { Project } from '@shared/types/api/project'
import { PROJECT_SEEN_FILTER, PROJECT_STAGE_FILTER } from '@shared/types/api/project'
import {
  ORG_PROJECT_STREAM_EVENT_TYPE,
  type OrgProjectEventPayload,
  OrgProjectEventResource,
} from '@shared/types/sse/org-project-event'

import {
  fetchProjectById,
  fetchProjectsPage,
  getProjectsQueryKeyPrefix,
  getProjectsV2StoryModeCountQueryKey,
  getProjectsV2VideoCountQueryKey,
  isUnseenProjectsQueryKey,
  patchProjectListPages,
  type ProjectsInfiniteData,
} from '@/hooks/projects-query-utils'
import type { SSEConnection } from '@/util/sse'

import {
  createTimelineSource,
  syncOngoingSourceWithHasMore,
} from './ongoing-projects-notification-helpers'
import {
  BASE_RECONNECT_DELAY_MS,
  createFetcherWithCoalescingQueue,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_STREAM_PATH,
  DISCONNECTED_POLL_INTERVAL_MS,
  getOldestOngoingByBuckets,
  MAX_INIT_LOAD_ATTEMPTS,
  MAX_RECONNECT_ATTEMPTS,
  MAX_RESYNC_ATTEMPTS,
  MAX_SYNC_ATTEMPTS,
  MAX_TOTALS_ATTEMPTS,
  NOTIFICATION_QUERY_STALE_TIME_MS,
  type OngoingProjectsNotificationStateOptions,
  type OngoingProjectsNotificationStateValue,
  RETRY_DELAY_MS,
  runWithRetry,
  sleep,
  type TimelineProjectItem,
  toCreatedAtStringFromTimestamp,
} from './OngoingProjectsNotificationState.utils'
import { isOngoingProject, toGlobalProjectId } from './utils'

export type {
  OngoingProjectsNotificationStateOptions,
  OngoingProjectsNotificationStateValue,
} from './OngoingProjectsNotificationState.utils'

const debugLogger = Logger.get('ongoing-projects-notification.debug', { defaultEnabled: false })

export function createOngoingProjectsNotificationState(
  options: OngoingProjectsNotificationStateOptions,
) {
  const { fetchApiDomain } = options

  // ISO string derived from the createdFrom baseline; applied to every query as a lower-bound floor.
  const createdFromString = toCreatedAtStringFromTimestamp(options.createdFromBaseline)

  let cancelResync: (() => void) | null = null
  let isDisposed = false
  let isFetchingOlder = false
  let isResyncing = false
  let isStarted = false
  const countTotalsQueue = new CoalescingQueue<void>()
  const fetchNewerQueue = new CoalescingQueue<void>()
  const refreshOngoingStatusesQueue = new CoalescingQueue<void>()
  const stageUpdateQueue = new CoalescingQueue<void>()
  const pendingStageUpdates = new Map<
    string,
    { projectId: string; resource: OrgProjectEventPayload['resource'] }
  >()
  let pollTimer: null | ReturnType<typeof setInterval> = null
  let pollTimerIntervalMs: null | number = null
  const projectRefreshQueueByKey = new Map<string, CoalescingQueue<null | Project>>()
  let reconnectAttempts = 0
  let reconnectTimer: null | ReturnType<typeof setTimeout> = null
  let resyncGen = 0
  let sawSSEConnected = false
  let sse: null | SSEConnection = null
  let sseHeldEvents: OrgProjectEventPayload[] = []
  let isSyncPaused = options.isSyncPaused ?? false
  let deferredRefreshSignalCount = 0

  const timelineSourceOpts = {
    createdFromBaseline: options.createdFromBaseline,
    createdFromString,
    fetchApiDomain,
    pageSize: options.pageSize,
  }

  // Sources shared across timeline instances and the resync builder
  const sources = {
    project: createTimelineSource('project', timelineSourceOpts),
  }

  // Track state explicitly so the resync builder can reference the previous state
  let timelineState = new TimelineState<TimelineProjectItem>(Object.keys(sources))
  let timeline = new Timeline<TimelineProjectItem>(sources, timelineState)

  let state: OngoingProjectsNotificationStateValue = {
    allTotal: 0,
    error: null,
    isConnected: false,
    isLoading: false,
    isReconnecting: false,
    items: [],
    ongoingTotal: 0,
  }

  const commonProjectOpts = {
    q: 'me',
    sort: 'createdAt',
  } as const

  const commonProjectPageOpts = {
    ...commonProjectOpts,
    page: 1,
    pageSize: 0,
    createdFrom: createdFromString,
    seenFilter: PROJECT_SEEN_FILTER.UNSEEN,
  } as const

  const loadOngoingProjectCount = createFetcherWithCoalescingQueue(() =>
    fetchProjectsPage(fetchApiDomain, {
      ...commonProjectPageOpts,
      stageFilter: PROJECT_STAGE_FILTER.ONGOING,
    }),
  )

  const loadProjectById = createMapFn((projectId: string) =>
    createFetcherWithCoalescingQueue(() => fetchProjectById(fetchApiDomain, projectId)),
  )

  const loadProjectCount = createFetcherWithCoalescingQueue(() =>
    fetchProjectsPage(fetchApiDomain, commonProjectPageOpts),
  )

  function dispose() {
    if (isDisposed) {
      return
    }
    debugLogger.log('state.dispose', state)
    isStarted = false

    cancelResync?.()
    cancelResync = null
    sseHeldEvents = []

    stopPolling()
    clearReconnectTimer()

    sse?.close()
    sse = null
    setState({ isConnected: false, isReconnecting: false })
    isDisposed = true
  }

  function getState(): OngoingProjectsNotificationStateValue {
    return state
  }

  function runRefresh() {
    if (deferredRefreshSignalCount <= 0) {
      return
    }

    deferredRefreshSignalCount = 0
    queueFetchNewerItems()
    queueCountTotals()
    queueRefreshOngoingStatuses()
  }

  function runResumeSync() {
    if (isDisposed || isSyncPaused || isResyncing) {
      return
    }

    flushHeldEvents()
    runRefresh()
  }

  function setSyncPaused(nextSyncPaused: boolean) {
    if (isDisposed || isSyncPaused === nextSyncPaused) {
      return
    }
    isSyncPaused = nextSyncPaused
    refreshPollingSchedulers()
    if (!isSyncPaused) {
      runResumeSync()
    }
  }

  async function loadMore(): Promise<void> {
    if (isDisposed || isFetchingOlder || isResyncing) {
      return
    }

    const currentTimeline = timeline
    const snapshot = currentTimeline.snapshot()
    if (!snapshot.hasMore) {
      return
    }

    isFetchingOlder = true
    try {
      await runWithRetry(
        () => currentTimeline.loadMore(),
        MAX_SYNC_ATTEMPTS,
        RETRY_DELAY_MS,
        () => isDisposed || timeline !== currentTimeline,
      )
      syncProjects()
    } catch (error) {
      if (isDisposed) {
        return
      }
      setState({ error })
    } finally {
      isFetchingOlder = false
    }
  }

  function reconnect() {
    if (isDisposed || sse || state.isConnected || state.isReconnecting) {
      return
    }
    debugLogger.log('reconnect.requested', state)
    reconnectAttempts = 0
    clearReconnectTimer()
    setState({ isReconnecting: false })
    connectSSE()
  }

  function start() {
    if (isStarted || isDisposed) {
      return
    }
    debugLogger.log('state.start', state)
    isStarted = true
    setState({ error: null, isLoading: true, isReconnecting: false })

    refreshPollingSchedulers()
    connectSSE()

    void initializeState()
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) {
      return
    }
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }

  function connectSSE() {
    if (isDisposed || !isStarted) {
      return
    }
    if (!options.createSSEConnection) {
      return
    }

    sse?.close()
    sse = null

    const nextSse = options.createSSEConnection(
      options.streamPath ?? DEFAULT_STREAM_PATH,
      {
        message: () => void 0,
        hello: () => {
          if (isDisposed) {
            return
          }
          debugLogger.log('sse.hello', state)
          sawSSEConnected = true
          reconnectAttempts = 0
          setState({ isConnected: true, isReconnecting: false })
          void onSSEHello()
        },
        [ORG_PROJECT_STREAM_EVENT_TYPE]: handleSSEEvent,
        error: handleSSEConnectionError,
      },
      {
        timeoutMs: 10_000,
        withCredentials: false,
      },
    )

    sse = nextSse
    void nextSse.start().catch(handleSSEConnectionError)
  }

  function handleSSEConnectionError() {
    if (isDisposed) {
      return
    }
    const willRetry = scheduleReconnect()
    debugLogger.log('sse.error', { willRetry }, state)
    setState(willRetry ? { isReconnecting: true } : { isConnected: false, isReconnecting: false })
  }

  function getTotal(page: { pagination?: { total?: number } }): number {
    return page.pagination?.total ?? 0
  }

  // Flush SSE events that were held while sync was paused or a resync was in progress.
  // Optional `gen` guard ensures we only flush for the owning resync.
  function flushHeldEvents(gen?: number) {
    if (isDisposed) {
      return
    }
    if (gen !== undefined && resyncGen !== gen) {
      return
    }
    const held = sseHeldEvents
    sseHeldEvents = []
    for (const event of held) {
      processSSEEvent(event)
    }
  }

  function handleSSEEvent(payload: { data: string }) {
    let parsed: OrgProjectEventPayload
    try {
      parsed = JSON.parse(payload.data) as OrgProjectEventPayload
    } catch {
      return
    }

    debugLogger.log('sse.event.received', parsed, state)

    // Hold events while paused or while the timeline is being resynced;
    // they will be flushed in order once sync resumes on a stable timeline.
    if (isSyncPaused || isResyncing) {
      sseHeldEvents.push(parsed)
      return
    }

    processSSEEvent(parsed)
  }

  function processSSEEvent(parsed: OrgProjectEventPayload) {
    if (parsed.action === 'seen-changed') {
      handleSeenChangedEvent(parsed)
      return
    }

    handleProjectEvent(parsed)
  }

  function handleProjectEvent(parsed: Exclude<OrgProjectEventPayload, { action: 'seen-changed' }>) {
    const { projectId } = parsed
    const timelineId = toGlobalProjectId(parsed.resource, projectId)

    if (parsed.action === 'created') {
      queueFetchNewerItems()
      queueCountTotals()
      invalidateProjectCollectionQueries(parsed.resource)
      return
    }

    if (parsed.action === 'deleted') {
      if (!timeline.has(timelineId)) {
        return
      }

      timeline.remove(timelineId)
      syncProjects()
      queueCountTotals()
      removeProjectFromCollectionCaches(parsed.resource, projectId)
      invalidateProjectV2CountQueries()
      return
    }

    if (parsed.action === 'stage-changed') {
      if (!timeline.has(timelineId)) {
        return
      }
      queueStageUpdate(projectId, parsed.resource)
    }
  }

  function handleSeenChangedEvent(
    parsed: Extract<OrgProjectEventPayload, { action: 'seen-changed' }>,
  ) {
    if (parsed.lastSeenAt === null) {
      // lastSeenAt cleared: projects may now qualify as unseen - fetch newer
      queueFetchNewerItems()
      queueCountTotals()
      invalidateProjectCollectionQueries(parsed.resource)
      return
    }

    // Projects marked as seen: no longer belong in the unseen list.
    // Remove immediately rather than waiting for the next fetch.
    let removed = false
    for (const projectId of parsed.projectIds) {
      const timelineId = toGlobalProjectId(parsed.resource, projectId)
      if (!timeline.has(timelineId)) {
        continue
      }
      timeline.remove(timelineId)
      removed = true
    }
    if (!removed) {
      return
    }
    syncProjects()
    queueCountTotals()
    removeProjectIdsFromUnseenCollectionCaches(parsed.resource, parsed.projectIds)
  }

  function invalidateProjectV2CountQueries() {
    options.queryClient.invalidateQueries({ queryKey: getProjectsV2VideoCountQueryKey() })
    options.queryClient.invalidateQueries({ queryKey: getProjectsV2StoryModeCountQueryKey() })
  }

  function invalidateProjectCollectionQueries(_resource: OrgProjectEventResource) {
    options.queryClient.invalidateQueries({ queryKey: getProjectsQueryKeyPrefix() })
    invalidateProjectV2CountQueries()
  }

  function patchProjectCollectionCaches(
    _resource: OrgProjectEventResource,
    transform: (item: Project) => null | Project,
  ) {
    options.queryClient.setQueriesData<ProjectsInfiniteData<Project>>(
      { queryKey: getProjectsQueryKeyPrefix() },
      (oldData) => patchProjectListPages(oldData, transform),
    )
  }

  function removeProjectFromCollectionCaches(resource: OrgProjectEventResource, projectId: string) {
    patchProjectCollectionCaches(resource, (item) => (item.id === projectId ? null : item))
  }

  function removeProjectIdsFromUnseenCollectionCaches(
    _resource: OrgProjectEventResource,
    projectIds: readonly string[],
  ) {
    const ids = new Set(projectIds)
    options.queryClient.setQueriesData<ProjectsInfiniteData<Project>>(
      {
        predicate: (query) => isUnseenProjectsQueryKey(query.queryKey),
        queryKey: getProjectsQueryKeyPrefix(),
      },
      (oldData) => patchProjectListPages(oldData, (item) => (ids.has(item.id) ? null : item)),
    )
  }

  async function loadInitialState() {
    const currentTimeline = timeline
    await Promise.all([
      requestTotalsSnapshot().then(setState),
      currentTimeline.loadNew().then(() => {
        if (isDisposed || timeline !== currentTimeline) {
          return
        }
        syncProjects()
      }),
    ])
  }

  async function initializeState() {
    try {
      await runWithRetry(
        () => loadInitialState(),
        MAX_INIT_LOAD_ATTEMPTS,
        RETRY_DELAY_MS,
        () => isDisposed,
      )
      if (isDisposed) {
        return
      }
      setState({ isLoading: false })
    } catch (error) {
      if (isDisposed) {
        return
      }
      setState({ error, isLoading: false })
    }
  }

  // Handles each SSE hello event by resyncing the timeline against the previous
  // state. SSE events received during the resync are held and replayed afterward.
  // If a newer hello arrives, the in-flight resync is cancelled and the newer one
  // takes over; the stale held events are discarded.
  async function onSSEHello() {
    debugLogger.log('resync.hello.received', state)
    // Cancel any resync already in progress and start fresh
    cancelResync?.()
    cancelResync = null

    const gen = ++resyncGen
    const prevState = timelineState

    isResyncing = true
    sseHeldEvents = []

    // Build the resync plan from the previous timeline state
    const builder = createTimelineResyncBuilder(sources, prevState)
    cancelResync = () => builder.cancel()
    debugLogger.log('resync.builder.created', state)

    // Execute the resync with retries for transient failures
    let resyncOk = false
    let lastError: unknown
    for (let attempt = 0; attempt < MAX_RESYNC_ATTEMPTS; attempt++) {
      if (isDisposed || resyncGen !== gen) {
        return
      }
      if (attempt > 0) {
        await sleep(RETRY_DELAY_MS)
        if (isDisposed || resyncGen !== gen) {
          return
        }
      }

      try {
        const result = await builder.resync()

        if (isDisposed || resyncGen !== gen) {
          return
        }

        // cancelled, do not retry
        if (result.interrupted) {
          break
        }

        if (result.ok) {
          // Swap in the freshly resynced timeline state
          timelineState = result.state
          timeline = new Timeline<TimelineProjectItem>(sources, result.state)
          syncProjects()
          resyncOk = true
          break
        }

        // Has source errors but was not interrupted; retry
        lastError = result.errors[0]?.error ?? new Error('[timeline] Resync failed')
      } catch (error) {
        lastError = error
      }
    }

    cancelResync = null

    // A newer hello arrived while we were waiting - it owns the state now
    if (isDisposed || resyncGen !== gen) {
      return
    }

    if (!resyncOk && lastError !== undefined) {
      setState({ error: lastError })
    }

    isResyncing = false

    if (isSyncPaused) {
      return
    }

    flushHeldEvents(gen)

    // Load items created after the resync window and refresh counts for the new timeline.
    queueFetchNewerItems()
    queueCountTotals()
    runRefresh()
  }

  function createMicrotaskBatch(block: () => unknown) {
    let isScheduled = false
    return () => {
      if (isScheduled) {
        return
      }
      isScheduled = true

      queueMicrotask(() => {
        isScheduled = false
        if (isDisposed) {
          return
        }
        block()
      })
    }
  }

  const queueFetchNewerItems = createMicrotaskBatch(() =>
    fetchNewerQueue.push(() => runFetchNewerCycle()),
  )

  const queueCountTotals = createMicrotaskBatch(() =>
    countTotalsQueue.push(() => runCountTotalsCycle()),
  )

  function queueRefreshProject(projectId: string, resource: OrgProjectEventPayload['resource']) {
    const queueKey = toGlobalProjectId(resource, projectId)
    const existingQueue = projectRefreshQueueByKey.get(queueKey)
    const queue = existingQueue ?? new CoalescingQueue<null | Project>()
    if (!existingQueue) {
      projectRefreshQueueByKey.set(queueKey, queue)
    }

    const detailQueryKey = ['project', projectId] as const
    const loadProject = loadProjectById(projectId)

    return queue.push(async () =>
      options.queryClient.fetchQuery({
        queryFn: () => loadProject(),
        queryKey: detailQueryKey,
        staleTime: NOTIFICATION_QUERY_STALE_TIME_MS,
      }),
    )
  }

  function queueStageUpdate(projectId: string, resource: OrgProjectEventPayload['resource']) {
    const timelineId = toGlobalProjectId(resource, projectId)
    pendingStageUpdates.set(timelineId, { projectId, resource })
    scheduleStageUpdateProcessing()
  }

  async function requestTotalsSnapshot(): Promise<{ allTotal: number; ongoingTotal: number }> {
    const [allPage, ongoingPage] = await Promise.all([
      loadProjectCount(),
      loadOngoingProjectCount(),
    ])

    const allTotal = getTotal(allPage)
    const ongoingTotal = Math.max(0, Math.min(getTotal(ongoingPage), allTotal))

    return { allTotal, ongoingTotal }
  }

  async function runCountTotalsCycle() {
    debugLogger.log('totals.cycle.start', state)
    try {
      const snapshot = await runWithRetry(
        () => requestTotalsSnapshot(),
        MAX_TOTALS_ATTEMPTS,
        RETRY_DELAY_MS,
        () => isDisposed,
      )

      if (isDisposed) {
        return
      }
      setState(snapshot)
      debugLogger.log('totals.cycle.done', snapshot, state)
    } catch (error) {
      if (isDisposed) {
        return
      }
      setState({ error })
    }
  }

  async function runFetchNewerCycle() {
    debugLogger.log('newer.cycle.start', state)
    try {
      const currentTimeline = timeline
      const before = currentTimeline.snapshot().all.length
      await runWithRetry(
        () => currentTimeline.loadNew(),
        MAX_SYNC_ATTEMPTS,
        RETRY_DELAY_MS,
        () => isDisposed || isResyncing || timeline !== currentTimeline,
      )

      // Skip sync if a resync replaced the timeline while we were loading
      if (isDisposed || isResyncing || timeline !== currentTimeline) {
        return
      }

      const after = currentTimeline.snapshot().all.length
      if (after > before) {
        debugLogger.log('newer.cycle.changed', { added: after - before }, state)
        syncProjects()
        queueCountTotals()
      }
    } catch (error) {
      if (isDisposed) {
        return
      }
      setState({ error })
    }
  }

  function queueRefreshOngoingStatuses() {
    void refreshOngoingStatusesQueue.push(() => runRefreshOngoingStatusesCycle())
  }

  async function runRefreshOngoingStatusesCycle() {
    const currentTimeline = timeline
    const oldestOngoingBySource = getOldestOngoingByBuckets(timelineState.captureSnapshotBuckets())
    debugLogger.log('ongoing.sync.cycle.start', { sourceCount: oldestOngoingBySource.size }, state)
    let changed = false
    let error: unknown
    try {
      if (oldestOngoingBySource.size === 0) {
        return
      }

      const sourceResults = await Promise.all(
        [...oldestOngoingBySource.entries()].map(([sourceKey, oldestOngoing]) =>
          syncOngoingSourceWithHasMore(
            currentTimeline,
            sourceKey,
            oldestOngoing.createdAt,
            fetchApiDomain,
            options.pageSize,
            () => isDisposed,
            () => timeline !== currentTimeline,
            getTimelineProjectById,
            debugLogger.log.bind(debugLogger),
            state,
          ),
        ),
      )
      if (isDisposed || timeline !== currentTimeline) {
        return
      }
      changed = sourceResults.some(Boolean)

      if (!changed || isDisposed || timeline !== currentTimeline) {
        return
      }
      debugLogger.log('ongoing.sync.changed', state)
      syncProjects()
      queueCountTotals()
    } catch (nextError) {
      error = nextError
      if (!isDisposed) {
        setState({ error: nextError })
      }
    } finally {
      debugLogger.log(
        'ongoing.sync.cycle.done',
        { changed, error, sourceCount: oldestOngoingBySource.size },
        state,
      )
    }
  }

  async function runStageUpdateBatch() {
    if (pendingStageUpdates.size === 0) {
      return
    }
    const pending = new Map(pendingStageUpdates)
    pendingStageUpdates.clear()

    let shouldRecount = false
    const updatedProjectsByResource = new Map<OrgProjectEventResource, Map<string, Project>>()

    for (const [timelineId, value] of pending) {
      const oldTimelineItem = getTimelineProjectById(timelineId)
      if (!oldTimelineItem) {
        continue
      }

      const wasOngoing = isOngoingProject(oldTimelineItem.project)
      const updatedProject = await queueRefreshProject(value.projectId, value.resource)
      if (!updatedProject || isDisposed) {
        continue
      }

      timeline.update({
        ...oldTimelineItem,
        createdAt: oldTimelineItem.createdAt,
        project: updatedProject,
      })

      if (wasOngoing !== isOngoingProject(updatedProject)) {
        shouldRecount = true
      }

      let updatedById = updatedProjectsByResource.get(value.resource)
      if (!updatedById) {
        updatedProjectsByResource.set(value.resource, (updatedById = new Map()))
      }
      updatedById.set(value.projectId, updatedProject)
    }

    syncProjects()
    if (shouldRecount) {
      queueCountTotals()
    }
    for (const [resource, updatedById] of updatedProjectsByResource) {
      patchProjectCollectionCaches(resource, (item) => updatedById.get(item.id) ?? item)
    }
  }

  function scheduleReconnect(): boolean {
    if (isDisposed || !isStarted) {
      return false
    }
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      return false
    }
    if (reconnectTimer) {
      return true
    }

    const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts, 60_000)
    debugLogger.log('sse.reconnect.schedule', { delay, reconnectAttempts }, state)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnectAttempts++
      connectSSE()
    }, delay)
    return true
  }

  function scheduleStageUpdateProcessing() {
    void stageUpdateQueue.push(() => runStageUpdateBatch())
  }

  function setState(partial: Partial<OngoingProjectsNotificationStateValue>) {
    if (isDisposed) {
      return
    }
    state = { ...state, ...partial }
    if (isStarted) {
      refreshPollingSchedulers()
    }
    options.onStateChange?.(state)
  }

  function refreshPollingSchedulers() {
    if (isDisposed || !isStarted) {
      return
    }
    startPolling()
  }

  function startPolling() {
    if (isDisposed || !isStarted) {
      return
    }
    const nextIntervalMs = resolvePollingIntervalMs()
    if (nextIntervalMs === null) {
      stopPolling()
      return
    }
    if (pollTimer && pollTimerIntervalMs === nextIntervalMs) {
      return
    }
    debugLogger.log(
      'polling.interval.update',
      {
        from: pollTimerIntervalMs,
        to: nextIntervalMs,
      },
      state,
    )
    if (pollTimer) {
      clearInterval(pollTimer)
    }

    pollTimerIntervalMs = nextIntervalMs
    pollTimer = setInterval(() => {
      if (isSyncPaused) {
        deferredRefreshSignalCount += 1
      } else {
        runRefresh()
      }
    }, nextIntervalMs)
  }

  function stopPolling() {
    if (!pollTimer) {
      return
    }
    clearInterval(pollTimer)
    pollTimer = null
    pollTimerIntervalMs = null
  }

  function resolvePollingIntervalMs(): null | number {
    const baseIntervalMs = options.pollingIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
    const isDisconnected = state.isReconnecting || !state.isConnected

    if (sawSSEConnected && !isDisconnected && options.enableConnectedFallbackPolling === false) {
      return null
    }

    if (sawSSEConnected && isDisconnected) {
      return Math.min(DISCONNECTED_POLL_INTERVAL_MS, baseIntervalMs)
    }
    return baseIntervalMs
  }

  function syncProjects() {
    setState({ items: [...timeline.snapshot().visible] })
  }

  function getTimelineProjectById(timelineId: string): null | TimelineProjectItem {
    return timeline.snapshot().all.find((item) => item.id === timelineId) ?? null
  }

  return {
    dispose,
    getState,
    loadMore,
    reconnect,
    setSyncPaused,
    start,
  }
}
