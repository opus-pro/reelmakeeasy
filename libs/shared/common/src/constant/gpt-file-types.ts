/**
 * Centralized configuration for GPT API supported file types.
 * This is the single source of truth for MIME type mappings and validation.
 *
 * @see https://platform.openai.com/docs/guides/images-vision
 */

/**
 * GPT-supported image MIME types and their file extensions.
 */
export const GPT_IMAGE_TYPES = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
  'image/gif': ['.gif'],
  'image/heic': ['.heic'],
  'image/heif': ['.heif'],
} as const

/**
 * GPT-supported video MIME types and their file extensions.
 */
export const GPT_VIDEO_TYPES = {
  'video/mp4': ['.mp4'],
  'video/mpeg': ['.mpeg', '.mpg'],
  'video/quicktime': ['.mov'],
  'video/x-msvideo': ['.avi'],
  'video/x-flv': ['.flv'],
  'video/webm': ['.webm'],
  'video/x-ms-wmv': ['.wmv'],
  'video/3gpp': ['.3gp', '.3gpp'],
} as const

/**
 * Document file extensions supported by the application.
 * Note: These use file extensions rather than MIME types for HTML accept attribute.
 */
export const GPT_DOCUMENT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.md'] as const

/**
 * Audio MIME types and their file extensions.
 */
export const GPT_AUDIO_TYPES = {
  'audio/mpeg': ['.mp3'],
  'audio/wav': ['.wav'],
  'audio/ogg': ['.ogg'],
  'audio/mp4': ['.m4a'],
  'audio/webm': ['.weba'],
} as const

export type GptImageMimeType = keyof typeof GPT_IMAGE_TYPES
export type GptMediaMimeType = GptImageMimeType | GptVideoMimeType
export type GptVideoMimeType = keyof typeof GPT_VIDEO_TYPES

// Pre-computed sets for fast lookup
const GPT_IMAGE_MIME_SET = new Set<string>(Object.keys(GPT_IMAGE_TYPES))
const GPT_VIDEO_MIME_SET = new Set<string>(Object.keys(GPT_VIDEO_TYPES))

// Pre-computed extension to MIME type map
const EXTENSION_TO_MIME_MAP: Record<string, string> = {}
for (const [mimeType, extensions] of Object.entries(GPT_IMAGE_TYPES)) {
  for (const ext of extensions) {
    EXTENSION_TO_MIME_MAP[ext.toLowerCase()] = mimeType
  }
}
for (const [mimeType, extensions] of Object.entries(GPT_VIDEO_TYPES)) {
  for (const ext of extensions) {
    EXTENSION_TO_MIME_MAP[ext.toLowerCase()] = mimeType
  }
}

/**
 * Check if a MIME type is a GPT-supported image format.
 */
export function isGptSupportedImage(mimeType: string): boolean {
  return GPT_IMAGE_MIME_SET.has(mimeType)
}

/**
 * Check if a MIME type is a GPT-supported video format.
 */
export function isGptSupportedVideo(mimeType: string): boolean {
  return GPT_VIDEO_MIME_SET.has(mimeType)
}

/**
 * Check if a MIME type is any GPT-supported media format.
 */
export function isGptSupportedMedia(mimeType: string): boolean {
  return isGptSupportedImage(mimeType) || isGptSupportedVideo(mimeType)
}

/**
 * Get the MIME type from a file extension.
 * @param extension - File extension with or without leading dot (e.g., '.png' or 'png')
 * @returns The MIME type or null if not supported
 */
export function getMimeTypeFromExtension(extension: string): null | string {
  const normalizedExt = extension.startsWith('.')
    ? extension.toLowerCase()
    : `.${extension.toLowerCase()}`
  return EXTENSION_TO_MIME_MAP[normalizedExt] || null
}

/**
 * Get the MIME type from a URL by examining its file extension.
 * Handles URLs with query strings and fragments.
 * @param url - The URL to extract MIME type from (supports http://, https://, store://, and file paths)
 * @returns The MIME type or null if not supported
 */
export function getMimeTypeFromUrl(url: string): null | string {
  // Remove query string and fragment
  const cleanUrl = url.split('?')[0].split('#')[0]
  // Extract the file extension
  const lastDotIndex = cleanUrl.lastIndexOf('.')
  if (lastDotIndex === -1) {
    return null
  }

  const extension = cleanUrl.slice(lastDotIndex).toLowerCase()
  return EXTENSION_TO_MIME_MAP[extension] || null
}

/**
 * Extract MIME type from a data URI.
 * @param dataUri - The data URI (e.g., 'data:image/png;base64,...')
 * @returns The MIME type or null if invalid
 */
export function getMimeTypeFromDataUri(dataUri: string): null | string {
  const match = dataUri.match(/^data:([^;,]+)/)
  return match ? match[1] : null
}

/**
 * Generate an HTML accept attribute string for file inputs.
 * @param type - The type of media to accept ('image' | 'video' | 'audio' | 'document' | 'all')
 * @returns A comma-separated string of MIME types suitable for the HTML accept attribute
 */
export function getGptAcceptAttribute(
  type: 'all' | 'audio' | 'document' | 'image' | 'video',
): string {
  const imageMimes = Object.keys(GPT_IMAGE_TYPES)
  const videoMimes = Object.keys(GPT_VIDEO_TYPES)
  const audioMimes = Object.keys(GPT_AUDIO_TYPES)
  const documentExts = GPT_DOCUMENT_EXTENSIONS

  switch (type) {
    case 'all': {
      return [...imageMimes, ...videoMimes, ...audioMimes, ...documentExts].join(',')
    }
    case 'audio': {
      return audioMimes.join(',')
    }
    case 'document': {
      return documentExts.join(',')
    }
    case 'image': {
      return imageMimes.join(',')
    }
    case 'video': {
      return videoMimes.join(',')
    }
  }
}

/**
 * Get a human-readable list of supported formats.
 * @param type - The type of media ('image' | 'video')
 * @returns A formatted string like "PNG, JPEG, WebP, GIF, HEIC, HEIF"
 */
export function getSupportedFormatsDisplay(type: 'image' | 'video'): string {
  if (type === 'image') {
    return 'PNG, JPEG, WebP, GIF, HEIC, HEIF'
  }
  return 'MP4, MOV, WebM, AVI, MPEG, 3GPP'
}

/**
 * Validate a MIME type against GPT-supported formats.
 * Returns an error message if invalid, or null if valid.
 * @param mimeType - The MIME type to validate
 * @param expectedType - The expected type ('image' | 'video')
 * @returns Error message or null
 */
export function validateGptMimeType(
  mimeType: string,
  expectedType: 'image' | 'video',
): null | string {
  if (expectedType === 'image') {
    if (!isGptSupportedImage(mimeType)) {
      return `Unsupported image format. Supported: ${getSupportedFormatsDisplay('image')}`
    }
  } else {
    if (!isGptSupportedVideo(mimeType)) {
      return `Unsupported video format. Supported: ${getSupportedFormatsDisplay('video')}`
    }
  }
  return null
}
