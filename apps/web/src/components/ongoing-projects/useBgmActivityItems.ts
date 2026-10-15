'use client'

import { LOCAL_LOGIN_ID } from '@reelmakeeasy/common/auth/local-identity'
import { useAtom } from 'jotai'
import { useEffect, useMemo, useRef } from 'react'

import { useFileUrl } from '@/hooks/use-file-url'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useApi } from '@/hooks/useApi'

import {
  BGM_ACTIVITY_POLL_MS,
  bgmActivityEntriesAtom,
  confirmBgmActivityEntry,
  isBgmActivityExpired,
  pruneBgmActivityEntries,
  pruneForeignBgmActivityEntries,
  removeBgmActivityEntry,
  shouldSettleBgmActivity,
  toBgmActivityItem,
} from './bgm-activity'
import type { OngoingProjectsNotificationItem } from './OngoingProjectsNotificationView'

export type UseBgmActivityItemsParams = {
  /**
   * Projects whose own video is generating. Their BGM row is suppressed: the
   * project row already reports that generation, and a BGM run is only ever
   * surfaced for a delivered video.
   */
  generatingProjectIds?: ReadonlySet<string>
  /** Skip the settle poll while the widget is not on screen. */
  paused?: boolean
}

/**
 * The Activity rows for in-flight BGM (re)generations.
 *
 * The rows are armed by the project detail page (useBgmActivityPublisher) and
 * settled here: the viewer that started the run is unmounted by the time the
 * row is visible, so this hook re-reads the run's server truth on a cadence and
 * drops the row once the run is no longer generating. A failed read keeps the
 * row -- only a definite not-generating answer (or the age backstop) clears it.
 */
export function useBgmActivityItems(
  params: UseBgmActivityItemsParams = {},
): OngoingProjectsNotificationItem[] {
  const { generatingProjectIds, paused = false } = params
  const { addImgHostname } = useFileUrl()
  const { fetchApiDomain: rawFetchApiDomain } = useApi()
  const fetchApiDomain = useRefCallback(rawFetchApiDomain)
  const [entries, setEntries] = useAtom(bgmActivityEntriesAtom)
  const ownerId = LOCAL_LOGIN_ID

  // Mirror for the poll: it reads the latest entries without re-arming the
  // interval on every write.
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  // Another identity's leftovers (logout / account switch / impersonation on
  // this browser) are dropped as soon as this one is known -- they are never
  // rendered, and nothing here should keep polling a project it cannot read.
  useEffect(() => {
    setEntries((prev) => pruneForeignBgmActivityEntries(prev, ownerId))
  }, [ownerId, setEntries])

  // Membership, not identity: the interval re-arms when a run is added or
  // settled, not on every write to an unchanged set of runs.
  const trackedKey = useMemo(() => Object.keys(entries).sort().join(','), [entries])

  useEffect(() => {
    if (paused || trackedKey === '') {
      return
    }
    let disposed = false

    const settle = async () => {
      // Writes go through the updater form throughout: the ref only catches up
      // on the next render, so computing a new map from it mid-pass would
      // resurrect a row another iteration just settled.
      for (const projectId of Object.keys(entriesRef.current)) {
        // Never read a project on behalf of an identity that does not own the
        // row (the prune effect is clearing it in the same pass).
        if (entriesRef.current[projectId]?.ownerId !== ownerId) {
          continue
        }
        const response = await fetchApiDomain<{
          data?: { generating?: boolean; regenOutcome?: string }
        }>(`/api/long-take-videos/${projectId}/bgm-settings`, {
          method: 'GET',
          noThrowError: true,
        })
        if (disposed) {
          return
        }
        // Keep the row on a failed read: a transport error says nothing about
        // the run, and dropping it would hide a generation still in flight.
        if (!response.ok || !response.data?.data) {
          continue
        }
        const entry = entriesRef.current[projectId]
        if (!entry) {
          continue
        }
        const generating = response.data.data.generating ?? false
        if (generating) {
          // Affirmative server truth outranks the age backstop: a long run
          // keeps its row for as long as the server says it is running.
          setEntries((prev) => confirmBgmActivityEntry(prev, projectId, Date.now()))
          continue
        }
        if (
          shouldSettleBgmActivity({
            generating,
            now: Date.now(),
            outcome: response.data.data.regenOutcome,
            startedAt: entry.startedAt,
          })
        ) {
          setEntries((prev) => removeBgmActivityEntry(prev, projectId))
        }
      }

      // Reap last, so an affirmative read above gets to stamp its row first.
      // Pruning ahead of the reads would drop a run that outlived the age cap
      // while the poll was paused (the normal state on the detail route, where
      // the widget is not even rendered) and the confirm could not restore it.
      const prunedAt = Date.now()
      if (pruneBgmActivityEntries(entriesRef.current, prunedAt) !== entriesRef.current) {
        setEntries((prev) => pruneBgmActivityEntries(prev, prunedAt))
      }
    }

    void settle()
    const timer = window.setInterval(() => void settle(), BGM_ACTIVITY_POLL_MS)
    return () => {
      disposed = true
      window.clearInterval(timer)
    }
  }, [fetchApiDomain, ownerId, paused, setEntries, trackedKey])

  return useMemo(() => {
    const now = Date.now()
    return Object.values(entries)
      .filter((entry) => Boolean(ownerId) && entry.ownerId === ownerId)
      .filter((entry) => !isBgmActivityExpired(entry, now))
      .filter((entry) => !generatingProjectIds?.has(entry.projectId))
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((entry) => toBgmActivityItem(entry, addImgHostname(entry.thumbnail) || undefined))
  }, [addImgHostname, entries, generatingProjectIds, ownerId])
}
