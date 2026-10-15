import path from 'node:path'

import { MotionDesignerMessages } from '@agent-lib/agents/storyboard/types'
import { extractVideoFrame } from '@agent-lib/agents/video-crew/utils/extract-video-frame'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  isStoreUri,
  storeUriToUrl,
  storedFileExists,
  uploadToStore,
  workspaceUri,
  workspaceUrl,
} from '@reelmakeeasy/common/storage/stored-files'
import { getProjectPath } from '@reelmakeeasy/common/utils/getProjectRoot'
import { getNodeLocalScratchRoot } from '@reelmakeeasy/common/utils/path.util'
import {
  MotionSetting,
  RawStoryboardShot,
  SceneDataForCanvas,
  StoryboardScanResult,
} from '@shared/types/api'
import { ProjectForBackend } from '@shared/types/api/project'
import { existsSync } from 'fs-extra'

import { VideoScript } from './video-script-type'

export function parseToSceneDataForCanvas(
  rawStoryboard: StoryboardScanResult,
  project: ProjectForBackend,
  motionDesignerMessages: MotionDesignerMessages,
): SceneDataForCanvas[] {
  return rawStoryboard.content.map((raw, index) => {
    const imageUrl = rawStoryboard.images?.[index] ?? ''
    const videoUrl = rawStoryboard.videos?.[index] ?? ''
    const result: SceneDataForCanvas = {
      id: raw.scene_id,
      duration: raw.duration,
      imageThumbnailUrl: raw.scene_image ?? imageUrl,
      imageUrl,
      videoUrl,
      shots:
        raw.shots?.map((shot) => ({
          id: shot.shot_id,
          description: shot.shot_description,
          script: shot.voice_over,
          templateId: shot.template_id,
          duration: shot.duration,
          timeRange: {
            start: shot.time_range.start,
            end: shot.time_range.end,
          },
        })) ?? [],
      script: { text: raw.voice_over },
      voiceOver: {
        id: project.voiceOverJson?.voiceId ?? '',
        name: project.voiceOverJson?.name ?? '',
        labels: project.voiceOverJson?.labels ?? [],
      },
      motions: {
        data: shotToMotion(raw.shots, motionDesignerMessages[raw.scene_id]),
      },
      assets: {
        data: [],
      },
    }
    return result
  })
}

export async function readSceneVideoScript(
  projectId: string,
  index: number,
): Promise<undefined | VideoScript> {
  const id = (index + 1).toString().padStart(3, '0')

  const storage = await createStorage(projectId)
  const relativePath = `video-script/render/video-script-scene_${id}-history.json`

  // Check if file exists before reading to avoid 404 errors
  const exists = await storage.exists(relativePath)
  if (!exists) {
    logger.debug(`Video script history not found for scene ${id} - may not be generated yet`, {
      projectId,
      sceneId: id,
    })
    return undefined
  }
  return (await storage.readJsonFile(relativePath)) as VideoScript
}

export async function resolveAssetUriToCdnUrl(projectId: string, uri: string) {
  if (!uri) {
    return ''
  }
  if (uri.startsWith('http')) {
    return uri
  }

  if (!uri.endsWith('.mp4') && !uri.endsWith('.video')) {
    if (isStoreUri(uri)) {
      return storeUriToUrl(uri)
    }
    return uri
  }

  // Handle video files - generate thumbnails based on source
  const fileName = path.basename(uri)
  let frameFileName: string
  let frameDir: string
  let framePath: string

  if (isStoreUri(uri)) {
    // sample: store://import/YT_<videoId>/search-engine/clip/11200_19200.search_engine.mp4
    const isImporterVideo = uri.includes('/import/')
    if (isImporterVideo) {
      const videoId =
        uri.split('/').find((part) => part.startsWith('YT_') || part.startsWith('SB_')) || ''
      if (!videoId) {
        return uri
      }
      frameFileName = `video_frame.${videoId}.${fileName}.jpg`
    } else {
      // sample: store://assets/<projectId>/video/video_crew/scene_001/S1_S2/52920_62720.search_engine.mp4_credit.mp4
      const enclosedDirName = path.basename(path.dirname(uri))
      frameFileName = `video_frame.${enclosedDirName}.${fileName}.jpg`
    }
    frameDir = getProjectPath(getNodeLocalScratchRoot(), projectId, '_thumbnail')
    framePath = path.join(frameDir, frameFileName)
  } else {
    // Unknown video source, return original URI
    return uri
  }

  // Generate thumbnail for video files
  if (existsSync(framePath)) {
    return workspaceUrl(projectId, '_thumbnail', frameFileName)
  }

  try {
    const frameUri = workspaceUri(projectId, '_thumbnail', frameFileName)
    const existsInStore = await storedFileExists(frameUri)
    if (!existsInStore) {
      const extracted = await extractVideoFrame(uri, framePath)
      if (!extracted) {
        logger.warn(`Failed to extract video frame: ${uri}`)
        return uri
      }
      await uploadToStore(framePath, frameUri)
      logger.info(`Video frame uploaded: ${frameFileName}, ${frameUri}`)
    }
    return workspaceUrl(projectId, '_thumbnail', frameFileName)
  } catch (error) {
    logger.warn(ensureError(error), `Failed to upload file to storage for project ${projectId}`)
    return uri
  }
}

function shotToMotion(shots?: RawStoryboardShot[], messages?: string[]): MotionSetting[] {
  let startedAt = 0
  const result: MotionSetting[] = []
  const shotArray = shots ?? []
  for (let i = 0; i < shotArray.length; i++) {
    const item = shotArray[i]
    result.push({
      startedAt,
      title: messages?.[i] ?? '',
    })
    startedAt += item.duration
  }
  return result
}
