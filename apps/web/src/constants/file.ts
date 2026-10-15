export const MAX_FILE_SIZE = 120 * 1024 * 1024

export const MAX_FILE_SIZE_ERROR_MESSAGE = 'File size exceeds 120MB'

// Style Studio video file upload limit. Separate from the generic
// MAX_FILE_SIZE (120MB), which would reject legitimate 10-min reference videos.
// 500MB ~= 6.7Mbps over 10 min, covering typical phone / YouTube exports; the
// 10-min DURATION cap is enforced separately (FE pre-check + BE ffprobe).
export const MAX_STYLE_VIDEO_SIZE_MB = 500
export const MAX_STYLE_VIDEO_SIZE_BYTES = MAX_STYLE_VIDEO_SIZE_MB * 1024 * 1024
export const MAX_STYLE_VIDEO_SIZE_ERROR_MESSAGE = `Video must be ${MAX_STYLE_VIDEO_SIZE_MB}MB or smaller`

// Story Mode voice-over video sources. A video picked as a voice-over
// is converted to audio (server-side ffmpeg) before use, so the generic
// MAX_FILE_SIZE (120MB) would reject legitimate ~10-min clips before that
// conversion can run. 500MB ~= 6.7Mbps over 10 min; the duration cap is
// enforced separately (FE pre-check + BE ffprobe).
export const MAX_STORY_MODE_AUDIO_VIDEO_SIZE_MB = 500
export const MAX_STORY_MODE_AUDIO_VIDEO_SIZE_BYTES =
  MAX_STORY_MODE_AUDIO_VIDEO_SIZE_MB * 1024 * 1024
export const MAX_STORY_MODE_AUDIO_VIDEO_SIZE_ERROR_MESSAGE = `Video must be ${MAX_STORY_MODE_AUDIO_VIDEO_SIZE_MB}MB or smaller`

// Editor asset upload limits
export const MAX_EDITOR_VIDEO_SIZE_MB = 200 // Video and WebP
export const MAX_EDITOR_IMAGE_SIZE_MB = 20 // Other image formats
export const MAX_EDITOR_VIDEO_SIZE_BYTES = MAX_EDITOR_VIDEO_SIZE_MB * 1024 * 1024
export const MAX_EDITOR_IMAGE_SIZE_BYTES = MAX_EDITOR_IMAGE_SIZE_MB * 1024 * 1024

// Helper function: Get max file size based on file type
export function getMaxFileSizeForEditor(file: File): { maxSizeBytes: number; maxSizeMB: number } {
  const isVideo = file.type.startsWith('video/') || file.type === 'image/webp'
  return {
    maxSizeBytes: isVideo ? MAX_EDITOR_VIDEO_SIZE_BYTES : MAX_EDITOR_IMAGE_SIZE_BYTES,
    maxSizeMB: isVideo ? MAX_EDITOR_VIDEO_SIZE_MB : MAX_EDITOR_IMAGE_SIZE_MB,
  }
}
