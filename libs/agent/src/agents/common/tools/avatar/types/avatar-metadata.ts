/**
 * Avatar Metadata Types (Version 2)
 * Extended metadata schema supporting shot-level crop areas and flexible aspect ratios
 *
 * This module extends the base metadata types to support:
 * - Shot-level video clips with individual aspect ratios
 * - Percentage-based crop areas for each shot
 * - Backward compatibility with version 1 metadata
 */

import { z } from 'zod'

import { AspectRatio } from './avatar-ratio'

/**
 * Crop area using center-based coordinates with percentage dimensions
 *
 * COORDINATE SYSTEM:
 * - Uses CENTER coordinates for position (xPct, yPct)
 * - Origin (0, 0) is at the center of the frame
 * - X-axis: [-1, +1] where -1=left edge, 0=center, +1=right edge
 * - Y-axis: [-1, +1] where -1=bottom edge, 0=center, +1=top edge
 * - Y-axis is POSITIVE UPWARD (mathematical convention)
 *
 * DIMENSIONS:
 * - wPct and hPct are percentages of frame dimensions (0 to 1)
 * - To convert to coordinate units: multiply by 2
 * - Example: hPct=1.0 means full frame height, which spans 2 coordinate units (-1 to +1)
 *
 * IMPORTANT FOR 9:8 NESTED CROP CALCULATION:
 * When calculating 9:8 position within 9:16 frame:
 * 1. Convert hPct to coordinate height: coordHeight = hPct * 2
 * 2. Calculate available space: availableSpace = coordHeight916 - coordHeight98
 * 3. Apply offset: yPct98 = yPct916 + (0.5 - offset) * availableSpace
 *    - offset=0: top aligned (shift up, positive Y)
 *    - offset=0.5: centered (no shift)
 *    - offset=1: bottom aligned (shift down, negative Y)
 *
 * @example
 * ```ts
 * // Face detection result for 9:16 image
 * const crop916: CropAreaMetadata = {
 *   xPct: -0.002083,  // Center X, slightly left of center
 *   yPct: 0.0127,     // Center Y, slightly above center
 *   wPct: 0.998,      // Width as percentage (99.8% of frame width)
 *   hPct: 0.9873,     // Height as percentage (98.73% of frame height)
 *   ratio: '9:16'
 * }
 *
 * // With offset=1 (bottom aligned), 9:8 crop would be:
 * // yPct = 0.0127 + (0.5 - 1.0) * (0.9873 * 2 - 0.49365 * 2)
 * //      = 0.0127 - 0.49365 = -0.481
 * ```
 */
export const CropAreaMetadataSchema = z.object({
  /**
   * X position of crop center in coordinate system
   * Range: [-1, +1] where -1=left edge, 0=center, +1=right edge
   */
  xPct: z.number().min(-1).max(1),
  /**
   * Y position of crop center in coordinate system
   * Range: [-1, +1] where -1=bottom edge, 0=center, +1=top edge
   * Note: Y is positive upward (mathematical convention)
   */
  yPct: z.number().min(-1).max(1),
  /**
   * Width as percentage of frame width (NOT coordinate units)
   * Range: 0.1 to 1.0 (percentage of frame width)
   * To convert to coordinate units: multiply by 2
   */
  wPct: z.number().min(0.1).max(1),
  /**
   * Height as percentage of frame height (NOT coordinate units)
   * Range: 0.1 to 1.0 (percentage of frame height)
   * To convert to coordinate units: multiply by 2
   */
  hPct: z.number().min(0.1).max(1),
  /** Target aspect ratio used for this crop */
  ratio: z.string() as z.ZodType<AspectRatio>,
})

export type CropAreaMetadata = z.infer<typeof CropAreaMetadataSchema>

/**
 * Shot-level information within a scene
 * Each shot can have its own aspect ratio and crop area
 */
export const ShotInfoMetadataSchema = z.object({
  /** Shot identifier (e.g., 'S1_S1', 'S19_S2') */
  shotId: z.string(),
  /** Relative path to shot video file (e.g., 'shot_clips/scene_001_S1_S1.mp4') */
  video: z.string(),
  /** Relative path to shot preview video (e.g., 'shot_clips/scene_001_S1_S1-preview.mp4') */
  previewVideo: z.string().optional(),
  /** Target aspect ratio for this shot */
  ratio: z.string() as z.ZodType<AspectRatio>,
  /** Computed crop area based on face detection (nullable until detection completes) */
  cropArea: CropAreaMetadataSchema.nullable(),
  /** Whether face detection failed for this shot */
  faceDetected: z.boolean().optional(),
})

export type ShotInfoMetadata = z.infer<typeof ShotInfoMetadataSchema>

/**
 * Enhanced video entry with shot-level support (Version 2)
 * Extends the base VideoEntry to include shot clips
 */
export const VideoEntryV2Schema = z.object({
  // Scene-level fields (from Version 1)
  sceneId: z.string().optional(), // Scene identifier (e.g., 'scene_001')
  audio: z.string(), // Relative path to source audio file
  video: z.string(), // Relative path to scene-level video file
  status: z.enum(['pending', 'generating', 'done', 'error', 'timeout']),

  // headCenter removed - use shot-level cropArea instead

  duration: z.number().nullable().optional(),
  size: z.number().nullable().optional(),
  errorMsg: z.string().nullable().optional(),
  hash: z.string().optional(),
  frameIndex: z.number().optional(),

  // Time information
  startMs: z.number().optional(),
  endMs: z.number().optional(),
  phrase: z.string().optional(),
  reason: z.string().optional(),

  // NEW: Shot-level information
  /** Array of shot clips extracted from this scene video */
  shots: z.array(ShotInfoMetadataSchema).optional(),
})

export type VideoEntryV2 = z.infer<typeof VideoEntryV2Schema>

/**
 * Complete avatar metadata (Version 2)
 * Supports both legacy single-video format and new shot-based format
 */
export const AvatarMetadataV2Schema = z.object({
  /** Schema version for migration and compatibility */
  version: z.literal(2).default(2),

  /** Project identifier */
  projectId: z.string().optional(),

  /** User identifier */
  userId: z.string().optional(),

  overallStatus: z.enum(['idle', 'generating', 'detecting', 'complete', 'error']),
  image: z.string(), // Relative path to avatar image
  audios: z.array(z.string()).optional(), // List of input audio files (legacy)
  videos: z.array(VideoEntryV2Schema), // Per-video generation tracking with shots

  createdAt: z.string().datetime(), // ISO timestamp of workflow start
  updatedAt: z.string().datetime(), // ISO timestamp of last update
})

export type AvatarMetadataV2 = z.infer<typeof AvatarMetadataV2Schema>

/**
 * Patch object for updating video entries
 * Supports partial updates to avoid overwriting unmodified fields
 */
export interface VideoUpdatePatch {
  /** Index of the video entry to update */
  index: number
  /** Partial update object - only specified fields will be updated */
  patch: Partial<VideoEntryV2>
}

/**
 * Patch object for updating shot information within a video
 */
export interface ShotUpdatePatch {
  /** Partial update object for the shot */
  patch: Partial<ShotInfoMetadata>
  /** Index of the shot within the video.shots array */
  shotIndex: number
  /** Index of the video entry */
  videoIndex: number
}
