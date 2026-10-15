/**
 * Avatar type definitions
 */

// ============================================================================
// Common Types
// ============================================================================

/**
 * Aspect ratio for avatar videos
 */
export type AspectRatio = '1:1' | '4:3' | '9:8' | '9:16' | '16:9'
export const DEFAULT_ASPECT_RATIO: AspectRatio = '9:16'

/**
 * Parse aspect ratio string into numeric width/height ratio
 */
export function parseAspectRatio(ratio: AspectRatio): null | number {
  const parts = ratio.split(':')
  if (parts.length !== 2) {
    return null
  }
  const width = Number.parseFloat(parts[0] || '0')
  const height = Number.parseFloat(parts[1] || '0')
  if (Number.isNaN(width) || Number.isNaN(height) || height === 0) {
    return null
  }
  return width / height
}

// ============================================================================
// Request/Response Types
// ============================================================================

/**
 * Map of scene IDs to avatar generation request info
 */
export interface AvatarRequestMap {
  [sceneId: string]: {
    /**
     * Estimated video duration in seconds. We derive this from the scene time_range
     * at submission time and persist it so retries can report usage/cost consistently.
     */
    durationSeconds?: number
    requestId: string
    submittedAt: string
  }
}

/**
 * Result from polling Veed API
 */
export interface PollResult {
  completedAt: number
  error?: string
  startedAt: number
  status: string
  videoUrl?: string
}

/**
 * Result of splitting a scene video into shot clips
 */
export interface ShotClip {
  failed?: boolean
  ratio: AspectRatio
  sceneId: string
  shotId: string
  video: string
}

/**
 * Crop area using center-based coordinates with percentage dimensions
 * Origin (0,0) = center, x/y range [-1,1], y positive upward
 */
export interface CropArea {
  hPct: number // Height as percentage of frame (0.1 to 1.0)
  ratio: AspectRatio // Target aspect ratio
  wPct: number // Width as percentage of frame (0.1 to 1.0)
  xPct: number // X center position (-1 to 1)
  yPct: number // Y center position (-1 to 1, positive up)
}

/**
 * Face detection task for a single video/shot
 */
export interface DetectTask {
  ratio?: AspectRatio
  sceneId?: string
  shotId?: string
  videoPath: string
}

/**
 * Avatar metadata for a single video
 */
export interface AvatarVideoMetadata {
  audio: string
  errorMsg?: string
  sceneId: string
  shots: Array<{
    cropArea: CropArea | null
    faceDetected?: boolean
    ratio: string
    shotId: string
    video: string
  }>
  status: 'done' | 'error'
  video: string
}

/**
 * Avatar metadata stored in storage
 */
export interface AvatarMetadata {
  avatarId: string
  createdAt: string
  image: string
  overallStatus: string
  updatedAt: string
  version: number
  videos: AvatarVideoMetadata[]
}

export interface Scene {
  avatar?: boolean // Whether this scene is selected for avatar generation (added for storyboard agent integration)
  duration: number // seconds
  scene_id: string
  text: string
  time_range: [number, number] // [start, end] in seconds
}
export interface SceneSelectionOptions {
  enableTwoStageSelection?: boolean // Enable Judge-Judge flow
  firstStageMaxCandidates?: number // Max candidates for first stage (default: 6)
  firstStageTemperature?: number // Temperature for first stage (default: 0.5)
  forceEdgeSceneSelection?: boolean // Force selection of first and last scenes + 20% middle scenes (default: false)
  forceFirstSceneSelection?: boolean // [DEPRECATED] Force selection of first scene (scene_001) (default: true) - Use forceEdgeSceneSelection instead
  maxCandidates?: number
  maxDurationSec?: number
  maxRetries?: number
  minCandidates?: number
  minDurationSec?: number
  minTemporalSpacing?: number // Minimum seconds between selected scenes (default: 10)
  preventConsecutiveScenes?: boolean // Prevent consecutive scene_ids (default: true)
  secondStageTemperature?: number // Temperature for second stage (default: 0.0)
  temperature?: number
}

/**
 * Extended scene with metadata for selection
 */
export interface SceneWithMetadata extends Scene {
  detected_shot_types?: ShotType[] // Detected content types
  heuristic_score?: number // Pre-computed score based on keywords
}
export interface SceneWithWords extends Scene {
  words: SceneWord[]
}
export interface SceneWord {
  end: number // seconds
  speaker: string
  start: number // seconds
  word: string
}
export interface SelectedScene extends Scene {
  final_score: number
  origin_phrase: string
  reason: string
  score_breakdown: {
    clarity: number // 0..1
    dialogue_directness: number // 0..1
    duration: number // 0..1
    hook_or_cta: number // 0..1
  }
}

/**
 * Shot type categories for semantic filtering
 */
export type ShotType =
  | 'b_roll'
  | 'chart'
  | 'code'
  | 'demo'
  | 'location'
  | 'product'
  | 'talking_head'
