/**
 * Avatar Ratio Types - Re-exports from scene.ts and avatar-metadata.ts
 * This file exists for backward compatibility
 */

// Re-export from scene.ts
export type { AspectRatio, CropArea, DetectTask } from './scene'
export { DEFAULT_ASPECT_RATIO, parseAspectRatio } from './scene'

// Re-export from avatar-metadata for convenience
export type {
  AvatarMetadataV2,
  CropAreaMetadata,
  ShotInfoMetadata,
  ShotUpdatePatch,
  VideoEntryV2,
  VideoUpdatePatch,
} from './avatar-metadata'
export {
  AvatarMetadataV2Schema,
  CropAreaMetadataSchema,
  ShotInfoMetadataSchema,
  VideoEntryV2Schema,
} from './avatar-metadata'
