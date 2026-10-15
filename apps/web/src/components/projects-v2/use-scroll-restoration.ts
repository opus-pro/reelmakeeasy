'use client'

import { useEffect, useRef, useState } from 'react'

const STORAGE_KEY = 'ao:projects-v2:scroll-restoration'
const PROJECT_SCROLL_ANCHOR_ATTR = 'data-project-scroll-anchor'
const NATIVE_SCROLL_RESTORATION_TOLERANCE_PX = 24

export interface ProjectListScrollRestorationContext {
  activeFilter: string
  isSearchMode: boolean
  routeBase: string
  searchQuery: string
}

type StoredProjectListScrollRestoration = ProjectListScrollRestorationContext & {
  projectId: string
  scrollY: number
}

interface UseProjectListScrollRestorationArgs {
  cardIds: ReadonlyArray<string>
  context: ProjectListScrollRestorationContext
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isReady: boolean
  onLoadMore: () => void
}

interface UseProjectListScrollRestorationResult {
  persistProjectAnchor: (projectId: string) => void
}

export function clearProjectListScrollRestoration() {
  if (typeof window === 'undefined' || window.sessionStorage === undefined) {
    return
  }

  window.sessionStorage.removeItem(STORAGE_KEY)
}

export function getProjectScrollAnchorAttribute(projectId: string) {
  return {
    [PROJECT_SCROLL_ANCHOR_ATTR]: projectId,
  }
}

export function readProjectListScrollRestoration(
  context: ProjectListScrollRestorationContext,
): null | StoredProjectListScrollRestoration {
  if (typeof window === 'undefined' || window.sessionStorage === undefined) {
    return null
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<StoredProjectListScrollRestoration>
    if (!isStoredProjectListScrollRestoration(parsed)) {
      clearProjectListScrollRestoration()
      return null
    }

    if (!matchesProjectListScrollRestorationContext(parsed, context)) {
      clearProjectListScrollRestoration()
      return null
    }

    return parsed
  } catch {
    clearProjectListScrollRestoration()
    return null
  }
}

export function useProjectListScrollRestoration({
  cardIds,
  context,
  hasNextPage,
  isFetchingNextPage,
  isReady,
  onLoadMore,
}: UseProjectListScrollRestorationArgs): UseProjectListScrollRestorationResult {
  const [pendingRestoration, setPendingRestoration] =
    useState<null | StoredProjectListScrollRestoration>(() =>
      readProjectListScrollRestoration(context),
    )
  const hasRequestedPageRef = useRef(false)

  useEffect(() => {
    if (hasRequestedPageRef.current && !isFetchingNextPage) {
      hasRequestedPageRef.current = false
    }
  }, [isFetchingNextPage])

  useEffect(() => {
    if (!pendingRestoration || !isReady) {
      return
    }

    const projectId = pendingRestoration.projectId
    const hasAnchorCard = cardIds.includes(projectId)

    if (!hasAnchorCard) {
      if (hasNextPage && !isFetchingNextPage && !hasRequestedPageRef.current) {
        hasRequestedPageRef.current = true
        onLoadMore()
        return
      }

      if (!hasNextPage && !isFetchingNextPage) {
        clearProjectListScrollRestoration()
        setPendingRestoration(null)
      }
      return
    }

    let cancelled = false
    const frameId = window.requestAnimationFrame(() => {
      if (cancelled) {
        return
      }

      const anchorElement = findProjectScrollAnchor(projectId)
      if (!anchorElement) {
        return
      }

      if (isNativeScrollRestorationNearStoredPosition(pendingRestoration.scrollY)) {
        clearProjectListScrollRestoration()
        setPendingRestoration(null)
        return
      }

      anchorElement.scrollIntoView({
        block: 'center',
        inline: 'nearest',
      })
      clearProjectListScrollRestoration()
      setPendingRestoration(null)
    })

    return () => {
      cancelled = true
      window.cancelAnimationFrame(frameId)
    }
  }, [cardIds, hasNextPage, isFetchingNextPage, isReady, onLoadMore, pendingRestoration])

  return {
    persistProjectAnchor(projectId: string) {
      writeProjectListScrollRestoration(context, projectId)
    },
  }
}

export function writeProjectListScrollRestoration(
  context: ProjectListScrollRestorationContext,
  projectId: string,
) {
  if (typeof window === 'undefined' || window.sessionStorage === undefined) {
    return
  }

  const trimmedProjectId = projectId.trim()
  if (trimmedProjectId.length === 0) {
    return
  }

  const payload: StoredProjectListScrollRestoration = {
    ...normalizeProjectListScrollRestorationContext(context),
    projectId: trimmedProjectId,
    scrollY: typeof window.scrollY === 'number' ? window.scrollY : 0,
  }
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
}

function findProjectScrollAnchor(projectId: string) {
  const elements = document.querySelectorAll<HTMLElement>(`[${PROJECT_SCROLL_ANCHOR_ATTR}]`)
  return Array.from(elements).find((element) => element.dataset.projectScrollAnchor === projectId)
}

function isNativeScrollRestorationNearStoredPosition(scrollY: number) {
  if (typeof window === 'undefined' || !Number.isFinite(scrollY)) {
    return false
  }

  return Math.abs(window.scrollY - scrollY) <= NATIVE_SCROLL_RESTORATION_TOLERANCE_PX
}

function isStoredProjectListScrollRestoration(
  value: Partial<StoredProjectListScrollRestoration>,
): value is StoredProjectListScrollRestoration {
  return (
    typeof value.activeFilter === 'string' &&
    typeof value.isSearchMode === 'boolean' &&
    typeof value.projectId === 'string' &&
    typeof value.routeBase === 'string' &&
    typeof value.scrollY === 'number' &&
    typeof value.searchQuery === 'string'
  )
}

function matchesProjectListScrollRestorationContext(
  stored: ProjectListScrollRestorationContext,
  current: ProjectListScrollRestorationContext,
) {
  const normalizedStored = normalizeProjectListScrollRestorationContext(stored)
  const normalizedCurrent = normalizeProjectListScrollRestorationContext(current)

  return (
    normalizedStored.activeFilter === normalizedCurrent.activeFilter &&
    normalizedStored.isSearchMode === normalizedCurrent.isSearchMode &&
    normalizedStored.routeBase === normalizedCurrent.routeBase &&
    normalizedStored.searchQuery === normalizedCurrent.searchQuery
  )
}

function normalizeProjectListScrollRestorationContext(
  context: ProjectListScrollRestorationContext,
): ProjectListScrollRestorationContext {
  return {
    activeFilter: context.activeFilter,
    isSearchMode: context.isSearchMode,
    routeBase: context.routeBase,
    searchQuery: context.searchQuery.trim(),
  }
}
