export type ImageAsset = {
  cdnUri?: string
  description?: string
  id: string
  url: string
}
export type MotionSetting = {
  startedAt: number
  title: string
}
export type RawStoryboardScene = {
  duration: number

  scene_description: string
  scene_id: string
  scene_image?: string
  // TODO: remove this after we have a better way to handle this
  shot_description?: string
  shot_id: number
  shot_visual_instructions_path?: string
  shots?: RawStoryboardShot[]

  voice_over: string
}
export type RawStoryboardShot = {
  data_path: string
  duration: number
  shot_description: string
  shot_id: string
  template_id: string
  time_range: {
    end: number
    start: number
  }
  visual_elements: string[]
  voice_over: string
}
export type ReportBadCaseRequestBody = {
  assetsToUse: string
  fullScript: string
  genAiFinalPreview: string
  motionDescription?: string
  projectId: string
  reason?: string
  shotDescription: string
  shotId: string
  shotTimestamp: string
  shotVoiceOver: string
  topicAbstractness?: string
  userName?: string
}
export type SceneDataForCanvas = {
  assets: {
    data: ImageAsset[]
    version?: string
  }
  description?: string
  /** starts from scene_001 */
  duration: number
  id: string
  imageThumbnailUrl?: string
  imageUrl?: string

  motions: {
    data: MotionSetting[]
    version?: string
  }

  script: {
    text: string
    version?: string
  }
  shots: Shot[]
  videoUrl?: string

  /** copied from project info */
  voiceOver: {
    id: string
    labels: string[]
    name: string
    version?: string
  }
}
export type SceneItemResponse = {
  data: null | SceneDataForCanvas
}
export type SceneListResponse = {
  data: SceneDataForCanvas[]
}
export type Shot = {
  description: string
  duration: number
  id: string
  sceneId?: string
  script: string
  templateId: string
  timeRange: {
    end: number
    start: number
  }
}

export type StoryboardScanResult = {
  content: RawStoryboardScene[]
  images?: string[]
  videos?: string[]
}
