import type { ProjectVoiceOverJson } from './project'

export interface DemoAsset {
  mimeType: string
  name: string
  url: string
}

export interface DemoProject {
  aspectRatio: null | string
  assets: DemoAsset[]
  audioUrl: null | string
  createdAt: Date
  description: null | string
  displayOrder: number
  goals: string[]
  // Source project's image model, snapshotted at curation time; null = no image
  // badge. Optional so existing fixtures/consumers compile; the transform
  // always provides it (the column is non-undefined on the row).
  imageModel?: null | string
  industries: string[]
  initPrompt: string
  inputType: null | string
  isActive: boolean
  motionDescription: null | string
  presetId: null | string
  projectId: string
  projectType: DemoProjectType
  resultVideo: string
  s2vLandingPageMeta?: S2vLandingPageMeta
  shotDescription: null | string
  source: DemoProjectSource
  sourceProjectId: null | string
  sourceUserId: null | string
  styleDescription: null | string
  styleName: null | string
  styleText: null | string
  styleThumbnailUrl: null | string
  thumbnail: string
  title: null | string
  transcript: null | string
  // Source project's transition video model, snapshotted at curation time;
  // null = Seedance 1.5 default. Optional for back-compat (see imageModel).
  transitionVideoModel?: null | string
  updatedAt: Date
  useCases: string[]
  voiceOverJson?: null | ProjectVoiceOverJson
}

export type DemoProjectSource = 'external' | 'internal'
export type DemoProjectType = 'S2V' | 'STORY_MODE'

export interface S2vLandingPageMeta {
  contentTags?: string[]
  metaDescription?: string
  metaTitle?: string
  platforms?: string[]
  sharedProjectId?: string
  transcript?: string
  videoDescription?: string
  videoDuration?: number
}
