import { getTemplateAssetSegId } from '@reelmakeeasy/common/adapters/template-adapter'
import { CODEGEN_LAYOUT_ID, remotionType } from '@reelmakeeasy/common/template/consts'
import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useState } from 'react'

import { useProjectId } from '@/contexts/ProjectContext'
import { useCdnOrigin } from '@/hooks/useCdnOrigin'
import { isVideoUri } from '@/util/media'

import { useHookVideoMetaData } from '../../hooks/useShotItems'
import { TemplateSegmentDel } from '../instances/template/segment'
import { editorCoreStore } from '../stores/editor-core.store'

import { getRemotionPreviewVideoUrl } from './useRenderPlan'

export type CurrentShotMedia = {
  isRemotion: boolean
  isVideo: boolean
  previewUri: string
  segment: TemplateSegmentDel
  uri: string
}

export function useCurrentShotMedia(): CurrentShotMedia | null {
  const currentSegments = useAtomValue(editorCoreStore.currentSegments)
  const { projectId } = useProjectId()
  const cdnOrigin = useCdnOrigin()
  const hookVideoMetaData = useHookVideoMetaData(projectId)

  const [remotionPreviewUrl, setRemotionPreviewUrl] = useState<null | string>(null)

  // Find the first available segment
  const candidateSegment = useMemo(() => {
    if (!currentSegments?.length) {
      return null
    }

    for (const seg of currentSegments) {
      const layoutId = seg.content.layoutId
      const params = seg.content.params
      const isRemotionSeg = remotionType.includes(layoutId) || layoutId === CODEGEN_LAYOUT_ID

      if (isRemotionSeg) {
        return { isRemotion: true, segment: seg }
      }

      const firstAsset = [params?.images, params?.background]
        ?.flat()
        .find((image) => image && !isDefaultAsset(image.uri))
      if (firstAsset?.uri) {
        return {
          isRemotion: false,
          previewUri: firstAsset.previewSourceUri || firstAsset.uri,
          segment: seg,
          uri: firstAsset.uri,
        }
      }
    }
    return null
  }, [currentSegments])

  // Asynchronously get remotion preview URL
  useEffect(() => {
    if (!candidateSegment?.isRemotion || !projectId) {
      setRemotionPreviewUrl(null)
      return
    }

    const seg = candidateSegment.segment
    const segId = getTemplateAssetSegId(seg.id, seg.content.layoutId, seg.content.id)

    getRemotionPreviewVideoUrl(projectId, segId, cdnOrigin).then(setRemotionPreviewUrl)
  }, [candidateSegment, projectId, cdnOrigin])

  // Assemble final result
  return useMemo(() => {
    if (!candidateSegment) {
      return null
    }

    if (candidateSegment.isRemotion) {
      if (!remotionPreviewUrl) {
        return null
      }
      return {
        isRemotion: true,
        isVideo: true,
        previewUri: remotionPreviewUrl,
        segment: candidateSegment.segment,
        uri: remotionPreviewUrl,
      }
    }

    if ('uri' in candidateSegment && candidateSegment.uri) {
      const segmentEndSec = candidateSegment.segment.timeRange.timelineOut / 1000
      const isHookVideoShot =
        hookVideoMetaData?.videoUrl &&
        hookVideoMetaData.duration &&
        segmentEndSec <= hookVideoMetaData.duration

      if (isHookVideoShot) {
        return {
          isRemotion: false,
          isVideo: true,
          previewUri: hookVideoMetaData.thumbnailUrl,
          uri: hookVideoMetaData.videoUrl,
          // use the original segment for updating the shot
          segment: candidateSegment.segment,
        }
      }

      return {
        isRemotion: false,
        isVideo: isVideoUri(candidateSegment.uri),
        previewUri: storeUriToUrl(candidateSegment.previewUri),
        segment: candidateSegment.segment,
        uri: storeUriToUrl(candidateSegment.uri),
      }
    }
    return null
  }, [candidateSegment, remotionPreviewUrl, hookVideoMetaData])
}

function isDefaultAsset(uri: string): boolean {
  return uri.includes('default_background') || uri.includes('ae-template/lottie')
}
