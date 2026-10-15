import { StoryboardShot } from '@agent-lib/agents/storyboard/types'
import { ProjectForBackend } from '@shared/types/api/project'
import { SceneDataForCanvas } from '@shared/types/api/storyboard'

import { SceneDataScannerV2Result } from './scene-data-scanner-v2'

export default function parseToSceneDataForCanvasV2(
  sceneDataScannerV2Result: SceneDataScannerV2Result,
  project: ProjectForBackend,
  sceneIndex: number,
): SceneDataForCanvas {
  const { storyboard, images, sceneAssets, motionDesignerMessages } = sceneDataScannerV2Result

  const scene = storyboard?.[sceneIndex]
  const image = images?.[sceneIndex] ?? ''

  if (!scene) {
    return {} as SceneDataForCanvas
  }

  return {
    id: scene.scene_id,
    duration: scene.duration,
    imageThumbnailUrl: scene.scene_image ?? image,
    imageUrl: image,
    shots:
      scene.shots?.map((shot) => ({
        id: shot.shot_id,
        description: shot.shot_description,
        script: shot.voice_over,
        templateId: shot.template_id,
        duration: shot.duration,
        timeRange: {
          start: shot.time_range?.start ?? 0,
          end: shot.time_range?.end ?? 0,
        },
      })) ?? [],
    script: { text: scene.voice_over },
    voiceOver: {
      id: project?.voiceOverJson?.voiceId ?? '',
      name: project?.voiceOverJson?.name ?? '',
      labels: project?.voiceOverJson?.labels ?? [],
    },
    motions: {
      data: shotToMotion(scene.shots, motionDesignerMessages?.[scene.scene_id]),
    },
    assets: {
      data: sceneAssets?.[scene.scene_id]?.filter((asset) => asset.id && asset.url) ?? [],
    },
  }
}

function shotToMotion(shots?: StoryboardShot[], messages?: string[]) {
  let startedAt = 0
  const result = []
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
