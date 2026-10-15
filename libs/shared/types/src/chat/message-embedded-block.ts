import { ProjectStage } from '../api/project'

import type { EMBEDDED_BLOCK_TYPE } from './embedded-block-enum'
import type {
  ConfirmProgressiveCardContent,
  FeedbackContentExt,
  ProgressiveCardContent,
} from './embedded-block-shared'
import type { ChatBoxFrontEndExtra } from './shared'

export type { EmbeddedBlockType } from './embedded-block-enum'
export type { ConfirmProgressiveCardContent } from './embedded-block-shared'

export type BaseEmbeddedBlock = {
  /** default is agent, but there is some types, like attachment, is from user */
  from?: 'agent' | 'user'
  id?: string
  // message from where it comes from
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  raw?: any
  role: 'embedded-block'
  // type: EmbeddedBlockType
}
export type EmbeddedAttachmentBlock = BaseEmbeddedBlock & {
  content: {
    id: string
    mime: string
    previewImageUrl?: string
    refId?: string
    title: string
  }
  type: EMBEDDED_BLOCK_TYPE['ATTACHMENT'] // 'embedded-attachment'
}
export type EmbeddedBlock =
  | EmbeddedAttachmentBlock
  | EmbeddedNeedApproveBlock
  | EmbeddedSourceBlock
  | EmbeddedStoryboardBlock
  | EmbeddedTranscriptBlock
  | EmbeddedVideoBlock
  | EmbeddedVideoPlanBlock
  | EmbeddedViralHookBlock
export type EmbeddedBlockMessage = ChatBoxFrontEndExtra & EmbeddedBlock
export type EmbeddedNeedApproveBlock = BaseEmbeddedBlock & {
  content: {
    /** is agent toolCallId */
    currentStage?: null | ProjectStage
    refId: string
    text?: string
  }
  type: EMBEDDED_BLOCK_TYPE['NEED_APPROVE'] // 'embedded-need-approve'
}
export type EmbeddedSourceBlock = BaseEmbeddedBlock & {
  content: FeedbackContentExt &
    ProgressiveCardContent & {
      data: SourceContent[]
      /** is agent toolCallId */
      refId: string
    }
  type: EMBEDDED_BLOCK_TYPE['SOURCE'] // 'embedded-source'
}
export type EmbeddedStoryboardBlock = BaseEmbeddedBlock & {
  content: FeedbackContentExt &
    ProgressiveCardContent & {
      data: SceneStoryboardContent[]
      /** is agent toolCallId */
      refId: string
    }
  type: EMBEDDED_BLOCK_TYPE['STORYBOARD'] // 'embedded-storyboard'
  // first 3 to display
}
export type EmbeddedTranscriptBlock = BaseEmbeddedBlock & {
  content: ConfirmProgressiveCardContent &
    FeedbackContentExt & {
      /** is agent toolCallId */
      refId: string
      scriptExceeded?: boolean
      text: string
    }
  type: EMBEDDED_BLOCK_TYPE['TRANSCRIPT'] // 'embedded-transcript'
}
export type EmbeddedVideoBlock = BaseEmbeddedBlock & {
  content: EmbeddedVideoContent &
    FeedbackContentExt & {
      /** is agent toolCallId */
      refId: string
    }
  type: EMBEDDED_BLOCK_TYPE['VIDEO'] // 'embedded-video'
}
export type EmbeddedVideoContent = {
  id?: string
  title: string
  url: string
}

// viral hook
export type EmbeddedViralHookBlock = BaseEmbeddedBlock & {
  content: ConfirmProgressiveCardContent &
    FeedbackContentExt & {
      data: Array<ViralHookContent>
      /** is agent toolCallId */
      refId: string
    }
  type: EMBEDDED_BLOCK_TYPE['VIRAL_HOOK'] // 'embedded-viral-hook'
}
export type SceneStoryboardContent = {
  id?: string
  url: string
}
export type SourceContent = {
  description?: string
  id?: string
  name: string
  previewImageUrl?: string
  type: 'article_animation' | 'file' | 'image' | 'tweet' | 'unknown' | 'url' | 'video'
  url?: string
}
export type ViralHookContent = {
  description: string
  previewImgUrl: string
  previewVideoUrl?: string
  title: string
  videoUrl: string
}

// ============================================
// Video Plan Card Types
// ============================================

/**
 * Reference items for video plan
 */
export type VideoPlanDocReference = {
  /** File type (e.g. PDF) */
  fileType?: string
  /** Title/filename */
  title: string
  /** Original URL */
  url?: string
}

export type VideoPlanImageReference = {
  /** Preview image URL */
  previewUrl?: string
  /** Title/filename */
  title: string
  /** Material type */
  type: 'image' | 'video'
  /** Original URL */
  url?: string
}

export type VideoPlanLinkReference = {
  /** Source domain */
  domain?: string
  /** Title/label */
  title: string
  /** Original URL */
  url: string
}

/**
 * Reference material for video plan
 * Split by media type for easier rendering.
 */
export type VideoPlanReference = {
  docs: VideoPlanDocReference[]
  images: VideoPlanImageReference[]
  keywords: string[]
  links: VideoPlanLinkReference[]
}

/**
 * Transcript information for video plan
 */
export type VideoPlanTranscript = {
  /** Avatar name */
  avatarName?: string
  /** Script text content */
  content: string
  /** Whether editable */
  editable?: boolean
  /** Estimated duration (seconds) - range represented as [min, max] */
  estimatedDurationSeconds: [number, number] | number
  scriptExceeded?: boolean
  /** Voice actor name */
  voiceName: string
  /** Word count */
  wordCount: number
}

/**
 * Complete content for Video Plan Card
 *
 * Most fields are derived from UserIntent, except:
 * - `references` - extracted from user-provided links/files
 * - `transcript` - generated script content
 * - `videoPlanId` - unique identifier for this plan
 */
export type VideoPlanContent = {
  /** List of reference materials (unique to VideoPlanContent) */
  references?: VideoPlanReference
  /** Style tags array (from UserIntent.preferences.style: motionStyle, visualStyle, voiceTone) */
  styleTags?: string[]
  /** Target audience (from UserIntent.preferences.content.targetAudience) */
  targetAudience?: string
  /** Video title (from UserIntent.preferences.content.topic) */
  title?: string
  /** Transcript content (unique to VideoPlanContent) */
  transcript?: VideoPlanTranscript
  /** Video Plan unique identifier (unique to VideoPlanContent) */
  videoPlanId?: string
  /** Video type (from UserIntent.confirmationCard.nicheUseCase) */
  videoType?: string
}

/**
 * EmbeddedVideoPlanBlock
 */
export type EmbeddedVideoPlanBlock = BaseEmbeddedBlock & {
  content: {
    /** Video Plan data */
    data: VideoPlanContent
    /** Workflow reference ID */
    refId: string
  }
  type: EMBEDDED_BLOCK_TYPE['VIDEO_PLAN'] // 'embedded-video-plan'
}
