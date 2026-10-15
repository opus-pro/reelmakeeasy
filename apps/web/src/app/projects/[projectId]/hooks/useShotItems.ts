import { SceneDataForCanvas, Shot } from '@shared/types/api'
import { useAtomValue } from 'jotai'
import { useCallback, useMemo } from 'react'

import { useFileUrl } from '@/hooks/use-file-url'
import { useCdnOrigin } from '@/hooks/useCdnOrigin'
import { getHookPreviewVideoUrl, getHookThumbnailUrl, getShotThumbnailUrl } from '@/util/cdn-utils'

import { currentShotAtom, editorCoreStore } from '../editor/stores/editor-core.store'
import { editorHistoryStore } from '../editor/stores/editor-history.store'

export interface ShotListItem extends Shot {
  sceneIndex: number
  sceneThumbnailUrl: string
  thumbnailUrl: string
}

interface UseShotItemsOptions {
  isLoading: boolean
  projectId?: string
  sceneList: SceneDataForCanvas[]
}

interface UseShotItemsReturn {
  activeShotIndex: number
  activeShotItem: null | ShotListItem
  navigateShot: (shotItems: ShotListItem[], direction: -1 | 1) => null | ShotListItem
  shotItems: ShotListItem[]
}

export function useShotItems({
  isLoading,
  projectId,
  sceneList,
}: UseShotItemsOptions): UseShotItemsReturn {
  const { addImgHostname } = useFileUrl()
  const currentShot = useAtomValue(currentShotAtom)
  const shotMeta = useAtomValue(editorHistoryStore.shotMetaAtom)
  const cdnOrigin = useCdnOrigin()

  const ready = useMemo(() => {
    return !isLoading && sceneList.length > 0
  }, [isLoading, sceneList])

  const hookVideoMetaData = useHookVideoMetaData(projectId)

  const shotItems = useMemo<ShotListItem[]>(() => {
    if (!ready || !projectId) {
      return []
    }
    const items: ShotListItem[] = []
    for (const [sceneIndex, scene] of sceneList.entries()) {
      const thumbPath = scene.imageThumbnailUrl ?? scene.imageUrl ?? ''
      const sceneThumbnailUrl = thumbPath ? addImgHostname(thumbPath) : ''
      for (const shot of scene.shots ?? []) {
        if (!shot.timeRange) {
          continue
        }
        let shotThumbnailUrl = ''
        const overrideThumbnail = shotMeta[shot.id]?.thumbnail
        if (overrideThumbnail) {
          shotThumbnailUrl = overrideThumbnail
        } else if (
          hookVideoMetaData?.thumbnailUrl &&
          hookVideoMetaData.duration &&
          shot.timeRange.end <= hookVideoMetaData.duration
        ) {
          shotThumbnailUrl = hookVideoMetaData.thumbnailUrl
        } else {
          shotThumbnailUrl = getShotThumbnailUrl(cdnOrigin, projectId, scene.id, shot.id)
        }

        items.push({
          id: shot.id,
          description: shot.description,
          duration: shot.duration,
          templateId: shot.templateId,
          timeRange: shot.timeRange,
          thumbnailUrl: shotThumbnailUrl,
          sceneThumbnailUrl,
          sceneId: scene.id,
          sceneIndex,
          script: shot.script,
        })
      }
    }
    items.sort((a, b) => a.timeRange.start - b.timeRange.start)
    return items
  }, [addImgHostname, ready, sceneList, projectId, cdnOrigin, hookVideoMetaData, shotMeta])

  const activeShotIndex = useMemo(() => {
    if (!currentShot?.id) {
      return -1
    }
    return shotItems.findIndex((s) => s.id === currentShot.id)
  }, [currentShot?.id, shotItems])

  const activeShotItem = useMemo(() => {
    if (activeShotIndex < 0) {
      return null
    }
    return shotItems[activeShotIndex] ?? null
  }, [activeShotIndex, shotItems])

  const navigateShot = useCallback(
    (items: ShotListItem[], direction: -1 | 1): null | ShotListItem => {
      if (items.length === 0) {
        return null
      }
      const currentIndex = Math.max(activeShotIndex, 0)
      const nextIndex = Math.max(0, Math.min(items.length - 1, currentIndex + direction))
      if (nextIndex === currentIndex) {
        return null
      }
      return items[nextIndex] ?? null
    },
    [activeShotIndex],
  )

  return {
    activeShotIndex,
    activeShotItem,
    navigateShot,
    shotItems,
  }
}

export const useHookVideoMetaData = (projectId?: string) => {
  const cdnOrigin = useCdnOrigin()
  const hookTrack = useAtomValue(editorCoreStore.hookTrack)
  const hookSegment = hookTrack?.segments?.at(0)
  return useMemo(() => {
    if (!projectId || !hookSegment) {
      return undefined
    }
    return {
      thumbnailUrl: getHookThumbnailUrl(cdnOrigin, projectId),
      videoUrl: getHookPreviewVideoUrl(cdnOrigin, projectId),
      duration: (hookSegment.duration?.eO ?? 0) / 1000,
    }
  }, [cdnOrigin, projectId, hookSegment])
}
