import { Area, Position } from '@reelmakeeasy/common/types/video-script'
import type { Shot } from '@shared/types/api'
import { Getter, Setter, useAtomValue, useSetAtom } from 'jotai'

import { useRefAtomCallback } from '@/hooks/use-ref-callback'

import { TemplateSegmentDel } from '../instances/template/segment'
import { UpdateManager } from '../instances/update-manager'
import { currentShotAtom } from '../stores/editor-core.store'
import { editorCoreStore } from '../stores/editor-core.store'
import { editorHistoryStore, ShotMetaMap } from '../stores/editor-history.store'

export type UpdateShotWithFullscreenParams = {
  cropPosition?: Position
  mediaUri: string
  previewUri?: string
  shotMetaPatch?: ShotMetaPatch
  shotOverride?: null | Shot
}

type ShotMetaPatch = {
  prompt?: string
  shotId: string
  thumbnail?: string
}

const invalidateHookTrackIfCovered = (
  get: Getter,
  set: Setter,
  startTimeMs: number,
  endTimeMs: number,
): boolean => {
  const hookTrack = get(editorCoreStore.hookTrack)
  if (!hookTrack || hookTrack.segments.length === 0) {
    return false
  }

  const overlapsHook = hookTrack.segments.some((segment) => {
    const hookStart = segment.timeline?.in ?? 0
    const hookEnd = segment.timeline?.out ?? 0
    return startTimeMs < hookEnd && endTimeMs > hookStart
  })

  if (overlapsHook) {
    set(editorCoreStore.hookTrack, {
      ...hookTrack,
      segments: [],
    })
    return true
  }

  return false
}

export function useShotUpdate() {
  const currentShot = useAtomValue(currentShotAtom)
  const recordSnapshot = useSetAtom(editorHistoryStore.recordSnapshotAtom)

  const toCropArea = (position: Position): Area => ({
    frameTime: 0,
    mode: 'linear',
    position: {
      xPct: position.xPct ?? 0,
      yPct: position.yPct ?? 0,
      wPct: position.wPct ?? 1,
      hPct: position.hPct ?? 1,
    },
  })

  const updateShotWithFullscreen = useRefAtomCallback(
    async (
      get,
      set,
      {
        cropPosition,
        mediaUri,
        previewUri,
        shotMetaPatch,
        shotOverride,
      }: UpdateShotWithFullscreenParams,
    ) => {
      const targetShot = shotOverride ?? get(currentShotAtom)
      const templateTrackInstance = get(editorCoreStore.templateTrackInstance)

      if (!targetShot?.timeRange || !templateTrackInstance) {
        throw new Error('No current shot or template track available')
      }

      const shotStartMs = targetShot.timeRange.start * 1000
      const shotEndMs = targetShot.timeRange.end * 1000

      const segmentsInShot = templateTrackInstance.findSegmentsByTimeRange(shotStartMs, shotEndMs)

      if (segmentsInShot.length === 0) {
        throw new Error('No segments found in current shot')
      }

      // Sort segments by start time to ensure we keep the earliest one
      segmentsInShot.sort((a, b) => a.timeRange.timelineIn - b.timeRange.timelineIn)
      const firstSegment = segmentsInShot[0]

      // Update the first segment to cover the entire shot
      firstSegment.timeRange.timelineIn = shotStartMs
      firstSegment.timeRange.timelineOut = shotEndMs

      // Convert to fullscreen with optional crop
      firstSegment.content.convertToFullscreen({
        uri: mediaUri,
        previewUri,
        cropAreas: cropPosition ? [toCropArea(cropPosition)] : undefined,
      })

      // Remove other segments in the shot
      for (let i = 1; i < segmentsInShot.length; i++) {
        templateTrackInstance.removeItem(segmentsInShot[i])
      }

      UpdateManager.getInstance().flushSync()

      const invalidated = invalidateHookTrackIfCovered(get, set, shotStartMs, shotEndMs)

      const currentVideoScript = get(editorCoreStore.videoScript)
      const currentShotMeta = get(editorHistoryStore.shotMetaAtom)
      const nextShotMeta = mergeShotMeta(currentShotMeta, shotMetaPatch)

      await recordSnapshot({
        videoScript: currentVideoScript,
        description: invalidated
          ? `Update shot ${targetShot.id}:${targetShot.templateId} to fullscreen${
              cropPosition ? ' with crop' : ''
            }, hook track invalidated`
          : `Update shot ${targetShot.id}:${targetShot.templateId} to fullscreen${
              cropPosition ? ' with crop' : ''
            }`,
        shotMeta: nextShotMeta,
      })
    },
  )

  const updateShotPosition = useRefAtomCallback(
    async (get, set, position: Position, segment: TemplateSegmentDel) => {
      const templateTrackInstance = get(editorCoreStore.templateTrackInstance)

      if (!templateTrackInstance) {
        throw new Error('No template track available')
      }

      const updated = segment.content.updateImagesCropAreas([toCropArea(position)])
      if (!updated) {
        throw new Error('Failed to update cropAreas: no images found in segment')
      }

      UpdateManager.getInstance().flushSync()

      const invalidated = invalidateHookTrackIfCovered(
        get,
        set,
        segment.timeRange.timelineIn,
        segment.timeRange.timelineOut,
      )

      const currentVideoScript = get(editorCoreStore.videoScript)
      await recordSnapshot({
        videoScript: currentVideoScript,
        description: invalidated
          ? `Reframe ${segment.id}:${segment.content.layoutId} cropAreas, hook track invalidated`
          : `Reframe ${segment.id}:${segment.content.layoutId} cropAreas`,
      })
    },
  )

  return {
    updateShotWithFullscreen,
    updateShotPosition,
    currentShot,
  }
}

const mergeShotMeta = (current: ShotMetaMap, patch?: ShotMetaPatch): ShotMetaMap => {
  if (!patch) {
    return current
  }
  const existing = current[patch.shotId] ?? {}
  const next = { ...existing }
  if (patch.prompt !== undefined) {
    next.prompt = patch.prompt
  }
  if (patch.thumbnail !== undefined) {
    next.thumbnail = patch.thumbnail
  }
  return {
    ...current,
    [patch.shotId]: next,
  }
}
