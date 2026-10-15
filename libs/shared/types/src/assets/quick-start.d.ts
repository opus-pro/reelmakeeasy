import type { ProjectVoiceOverJson } from '../api/project'

export type QuickStartBtn = {
  inputType: string
  promptList: string[]
}

export type QuickStartProjectType = 'S2V' | 'STORY_MODE'

export type QuickStartTemplate = QuickStartTemplateBase & {
  presetId?: string
  projectType: 'S2V' | 'STORY_MODE'
}

export type QuickStartTemplateAsset = {
  mimeType: string
  name: string
  url: string
}

export type S2VLandingPageMeta = {
  contentTags?: string[]
  metaDescription?: string
  metaTitle?: string
  platforms?: string[]
  transcript?: string
  videoDescription?: string
}

type QuickStartTemplateBase = {
  aspectRatio?: '1:1' | '9:16' | '16:9'
  assets: QuickStartTemplateAsset[]
  audioUrl?: null | string
  createdAt: string
  description: null | string
  displayOrder: number
  goals: string[]
  // Demo's snapshotted image model (curation-time + dominant backfill); null =
  // no image badge, undefined = not snapshotted (resolver falls back to live).
  imageModel?: null | string
  industries: string[]
  initPrompt: string
  inputType: string
  isActive: boolean
  motionDescription: null | string
  previewVideo?: null | string
  projectId: string
  resultVideo: string
  s2vLandingPageMeta?: S2VLandingPageMeta
  shotDescription: null | string
  source: string
  sourceProjectId: string
  sourceUserId: string
  styleDescription: null | string
  styleName?: null | string
  styleText?: null | string
  styleThumbnailUrl?: null | string
  thumbnail: string
  title: string
  transcript?: null | string
  updatedAt: string
  useCases: string[]
  // Demo's snapshotted transition video model (curation-time + backfill); null =
  // Seedance 1.5 default, undefined = not snapshotted (resolver falls back to live).
  videoModel?: null | string
  voiceOverJson?: null | ProjectVoiceOverJson
}
