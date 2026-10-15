import { MotionDesignerMessages, Storyboard } from '@agent-lib/agents/storyboard/types'
import { OUTPUT_PATHS, STORYBOARD_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { TemplateAssetTrack, VideoScript } from '@reelmakeeasy/common/types/video-script'

import { resolveAssetUriToCdnUrl } from './parseSceneDataForCanvas'

export type SceneDataScannerV2Result = {
  images?: string[]
  motionDesignerMessages?: MotionDesignerMessages
  sceneAssets?: Record<string, Array<{ id: string; url: string }>>
  storyboard?: Storyboard
}

export default async function sceneDataScannerV2(projectId: string) {
  const storage = await createStorage(projectId)
  const storyboard = (await storage.exists(STORYBOARD_PATHS.shotsBaseInfoPath))
    ? await storage.readJsonFile<Storyboard>(STORYBOARD_PATHS.shotsBaseInfoPath)
    : undefined

  const images = await Promise.all(
    storyboard?.map(async (scene) => {
      const sceneId = scene.scene_id
      if (!(await storage.exists(OUTPUT_PATHS.scenePreviewImagePath(sceneId)))) {
        return ''
      }
      const gsUrl = storage.getFullPath(OUTPUT_PATHS.scenePreviewImagePath(sceneId))
      return await resolveAssetUriToCdnUrl(projectId, gsUrl)
    }) ?? [],
  )

  const videoScript = (await storage.exists(STORYBOARD_PATHS.videoScriptPath))
    ? await storage.readJsonFile<VideoScript>(STORYBOARD_PATHS.videoScriptPath)
    : undefined

  // Extract assets from template-asset track
  const sceneAssetsMap: Record<string, Array<{ id: string; url: string }>> = {}
  const templateAssetTrack = videoScript?.tracks?.find(
    (track): track is TemplateAssetTrack =>
      track.id === 'track-template-asset' && track.type === 'template-asset',
  )

  if (templateAssetTrack) {
    await Promise.all(
      templateAssetTrack.segments.map((segment) =>
        extractAssetsFromSegment(projectId, segment, sceneAssetsMap),
      ),
    )
  }

  const motionDesignerMessages = (await storage.exists(STORYBOARD_PATHS.motionDesignerMessagesPath))
    ? await storage.readJsonFile<MotionDesignerMessages>(
        STORYBOARD_PATHS.motionDesignerMessagesPath,
      )
    : undefined

  return {
    images,
    sceneAssets: sceneAssetsMap,
    storyboard,
    motionDesignerMessages,
  }
}

/**
 * Extract assets from a single segment and add them to the scene assets map
 */
async function extractAssetsFromSegment(
  projectId: string,
  segment: TemplateAssetTrack['segments'][number],
  sceneAssetsMap: Record<string, Array<{ id: string; url: string }>>,
): Promise<void> {
  const sceneNumber = extractSceneNumberFromSegmentId(segment.id)
  if (!sceneNumber) {
    return
  }

  const sceneId = sceneNumberToSceneId(sceneNumber)

  if (segment.content.params?.images && Array.isArray(segment.content.params.images)) {
    for (const image of segment.content.params.images) {
      if (image.uri) {
        const url = await resolveAssetUriToCdnUrl(projectId, image.uri)
        if (!sceneAssetsMap[sceneId]) {
          sceneAssetsMap[sceneId] = []
        }
        sceneAssetsMap[sceneId].push({
          id: image.uri,
          url,
        })
      }
    }
  }
}

/**
 * Extract scene number from segment id (e.g., "S1_S1_I0" -> "1")
 */
function extractSceneNumberFromSegmentId(segmentId: string): null | number {
  const match = segmentId.match(/^S(\d+)_/)
  if (!match) {
    return null
  }
  return Number.parseInt(match[1], 10)
}

/**
 * Convert scene number to scene_id format (e.g., 1 -> "scene_001")
 */
function sceneNumberToSceneId(sceneNumber: number): string {
  return `scene_${sceneNumber.toString().padStart(3, '0')}`
}
