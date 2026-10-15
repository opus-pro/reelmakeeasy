import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import { IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUrl } from 'class-validator'

export class GenerateAssetDto {
  @IsNumber()
  @IsOptional()
  duration?: number

  @IsString()
  projectId!: string

  @IsString()
  prompt!: string

  @IsIn(['1:1', '16:9', '9:16'])
  @IsOptional()
  ratio?: AspectRatio

  @IsOptional()
  @IsUrl()
  referenceUrl?: string

  /**
   * Scene ID for context-aware regeneration.
   * When provided along with shotId, the backend will retrieve narrative context
   * (voice_over, shot_description) from storyboard.json to enhance the prompt.
   */
  @IsOptional()
  @IsString()
  sceneId?: string

  /**
   * Shot ID for context-aware regeneration.
   * When provided along with sceneId, the backend will retrieve narrative context
   * (voice_over, shot_description) from storyboard.json to enhance the prompt.
   */
  @IsOptional()
  @IsString()
  shotId?: string

  @IsEnum(['image', 'video'])
  @IsOptional()
  type?: 'image' | 'video'
}

/**
 * Async response DTO for non-blocking asset generation
 * Returns immediately with workflowId for SSE subscription
 */
export class GenerateAssetAsyncResponseDto {
  /** Human-readable message */
  message: string
  /** Current status: 'queued' means the workflow has started */
  status: 'queued'
  /** Workflow ID for SSE subscription */
  workflowId: string

  constructor(workflowId: string, message = 'Asset generation queued') {
    this.workflowId = workflowId
    this.status = 'queued'
    this.message = message
  }
}

/**
 * Select a keyframe candidate for Human-in-the-Loop video generation
 */
export class SelectKeyframeDto {
  /**
   * Selected last-frame URI (typically `store://...`).
   * Note: not validated as URL because `store://` is not a standard HTTP URL.
   */
  @IsString()
  selectedLastFrameUri!: string
}

export class SelectKeyframeResponseDto {
  message: string
  ok = true as const

  constructor(message = 'Selection received') {
    this.message = message
  }
}
