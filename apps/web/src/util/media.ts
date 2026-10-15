import { AspectRatio } from '@reelmakeeasy/common/media/types'
import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'

export type AudioMetadata = {
  duration: number
}

export type AudioMetadataError = {
  code: number
  message: string
  type: MediaMetadataErrorType
}

export type AudioMetadataResult = {
  error?: AudioMetadataError
  metadata: AudioMetadata | null
}

export const FALLBACK_VIDEO_DURATION_LIMIT = 8

export type GetVideoMetadataOptions = {
  thumbnailTime?: number
  withThumbnail?: boolean
}

export type ImageDimensions = {
  height: number
  width: number
}

export type MediaMetadataErrorType =
  | 'aborted'
  | 'decode'
  | 'network'
  | 'src_not_supported'
  | 'timeout'
  | 'unknown'

export type VideoMetadata = {
  duration: number
  height: number
  thumbnailUrl?: string
  width: number
}

export type VideoMetadataError = {
  code: number
  message: string
  type: MediaMetadataErrorType
}

export type VideoMetadataResult = {
  error?: VideoMetadataError
  metadata: null | VideoMetadata
}

const createResolver = <T>(resolve: (value: T) => void, cleanup: () => void) => {
  let resolved = false
  return (value: T) => {
    if (resolved) {
      return
    }
    resolved = true
    cleanup()
    resolve(value)
  }
}

export function calculateAspectRatio(
  width: number,
  height: number,
  mediaType: 'image' | 'video',
): AspectRatio {
  if (width === 0 || height === 0) {
    return mediaType === 'image' ? '1:1' : '9:16'
  }

  const ratio = width / height

  if (ratio >= 0.9 && ratio <= 1.2) {
    return '1:1'
  }
  if (ratio >= 1.4 && ratio <= 1.8) {
    return '16:9'
  }
  if (ratio >= 0.5 && ratio <= 0.7) {
    return '9:16'
  }

  return mediaType === 'image' ? '1:1' : '9:16'
}

const ASPECT_RATIO_CSS: Record<string, string> = {
  '1:1': '1 / 1',
  '9:16': '9 / 16',
  '16:9': '16 / 9',
}

/** Converts an AspectRatio string ('9:16') to a CSS aspect-ratio value ('9 / 16'). */
export function aspectRatioToCss(ratio: null | string, fallback = '9 / 16'): string {
  return (ratio && ASPECT_RATIO_CSS[ratio]) || fallback
}

export function getImageDimensions(imageUrl: string): Promise<ImageDimensions> {
  return new Promise((resolve, reject) => {
    const img = new Image()

    img.crossOrigin = 'anonymous'

    img.onload = () => {
      resolve({
        height: img.naturalHeight,
        width: img.naturalWidth,
      })
    }

    img.onerror = () => {
      reject(new Error('Failed to load image'))
    }

    img.src = storeUriToUrl(imageUrl)
  })
}

export function isVideoUri(uri: string): boolean {
  const extension = uriPath(uri).split('.').pop()?.toLowerCase()
  return ['avi', 'mkv', 'mov', 'mp4', 'webm'].includes(extension ?? '')
}

/** A URI without its query or fragment (`clips.mp4?v=3` -> `clips.mp4`), for extension checks. */
export function uriPath(uri: string): string {
  return uri.split(/[?#]/, 1)[0] ?? uri
}

const getErrorType = (code: number): MediaMetadataErrorType => {
  switch (code) {
    case 1: {
      return 'aborted'
    }
    case 2: {
      return 'network'
    }
    case 3: {
      return 'decode'
    }
    case 4: {
      return 'src_not_supported'
    }
    default: {
      return 'unknown'
    }
  }
}

export const getVideoMetadata = (
  source: File | string,
  options: GetVideoMetadataOptions = {},
): Promise<VideoMetadataResult> => {
  const { withThumbnail = false, thumbnailTime = 0 } = options
  const TIMEOUT_MS = 30000

  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true

    const isUrl = typeof source === 'string'
    let objectURL: null | string = null
    let videoSrc: string

    if (isUrl) {
      videoSrc = source
      video.crossOrigin = 'anonymous'
    } else {
      objectURL = URL.createObjectURL(source)
      videoSrc = objectURL
    }

    let timeoutId: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      if (objectURL) {
        URL.revokeObjectURL(objectURL)
      }
      video.remove()
    }

    let resolved = false
    const resolveOnce = (value: VideoMetadataResult) => {
      if (resolved) {
        return
      }
      resolved = true
      cleanup()
      resolve(value)
    }

    const resolveWithError = (error: VideoMetadataError) => resolveOnce({ error, metadata: null })

    const resolveWithMetadata = (metadata: VideoMetadata) => resolveOnce({ metadata })

    timeoutId = setTimeout(() => {
      resolveWithError({
        code: 0,
        message: 'Video metadata loading timeout',
        type: 'timeout',
      })
    }, TIMEOUT_MS)

    video.onloadedmetadata = () => {
      if (resolved) {
        return
      }
      if (!withThumbnail) {
        const metadata: VideoMetadata = {
          duration: video.duration,
          height: video.videoHeight,
          width: video.videoWidth,
        }
        resolveWithMetadata(metadata)
        return
      }

      video.currentTime = thumbnailTime
    }

    video.onseeked = () => {
      if (resolved) {
        return
      }
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const ctx = canvas.getContext('2d')

      let thumbnailUrl: string | undefined
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        thumbnailUrl = canvas.toDataURL('image/jpeg', 0.8)
      }

      resolveWithMetadata({
        duration: video.duration,
        height: video.videoHeight,
        thumbnailUrl,
        width: video.videoWidth,
      })
    }

    video.onerror = () => {
      const error = video.error
      const errorCode = error?.code ?? 0
      const errorMessage = error?.message || 'Unknown video error'

      resolveWithError({
        code: errorCode,
        message: errorMessage,
        type: getErrorType(errorCode),
      })
    }

    video.src = videoSrc
  })
}

export const formatVideoMetadataError = (
  error: VideoMetadataError,
  file?: File | string,
): string => {
  const fileInfo =
    file instanceof File
      ? `File: ${file.name}, Size: ${file.size} bytes, Type: ${file.type}`
      : typeof file === 'string'
        ? `URL: ${file}`
        : 'Unknown source'
  const { code, message, type } = error

  switch (type) {
    case 'decode': {
      return `Video file appears to be corrupted. ${fileInfo}. Error: ${message} (code: ${code})`
    }
    case 'network': {
      return `Network error while checking video duration. ${fileInfo}. Error: ${message} (code: ${code})`
    }
    case 'src_not_supported': {
      return `Video format not supported. ${fileInfo}. Please use MP4, WebM, or MOV format.`
    }
    case 'timeout': {
      return `Failed to check video duration: timeout after 30 seconds. ${fileInfo}`
    }
    default: {
      return `Failed to check video duration. ${fileInfo}. Error: ${message} (code: ${code})`
    }
  }
}

export const validateVideoMetadata = (
  result: VideoMetadataResult,
  file: File | string,
  maxDuration: number = FALLBACK_VIDEO_DURATION_LIMIT,
): VideoMetadata => {
  if (result.error) {
    throw new Error(formatVideoMetadataError(result.error, file))
  }

  if (!result.metadata) {
    const fileInfo =
      file instanceof File
        ? `File: ${file.name}, Size: ${file.size} bytes, Type: ${file.type}`
        : `URL: ${file}`
    throw new Error(
      `Failed to check video duration. ${fileInfo}. The video file may be corrupted, unsupported format, or invalid encoding.`,
    )
  }

  const { metadata } = result

  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
    const fileInfo =
      file instanceof File ? `File: ${file.name}, Type: ${file.type}` : `URL: ${file}`
    throw new Error(
      `Invalid video duration: ${metadata.duration}. ${fileInfo}. The video file may be corrupted or incomplete.`,
    )
  }

  if (metadata.duration > maxDuration + 0.3) {
    const fileName = file instanceof File ? file.name : file
    throw new Error(
      `Video duration (${metadata.duration.toFixed(2)}s) exceeds maximum allowed duration (${maxDuration.toFixed(2)}s). File: ${fileName}`,
    )
  }

  return metadata
}

const getAudioMetadataBySource = (
  audioSrc: string,
  options?: { crossOrigin?: null | string; onCleanup?: () => void },
): Promise<AudioMetadataResult> => {
  const TIMEOUT_MS = 30000

  return new Promise((resolve) => {
    const audio = document.createElement('audio')
    if (options?.crossOrigin) {
      audio.crossOrigin = options.crossOrigin
    }
    audio.preload = 'metadata'

    let timeoutId: NodeJS.Timeout | null = null

    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      options?.onCleanup?.()
      audio.remove()
    }

    const resolveOnce = createResolver(resolve, cleanup)

    const resolveWithError = (error: AudioMetadataError) => resolveOnce({ error, metadata: null })

    const resolveWithMetadata = (metadata: AudioMetadata) => resolveOnce({ metadata })

    timeoutId = setTimeout(() => {
      resolveWithError({
        code: 0,
        message: 'Audio metadata loading timeout',
        type: 'timeout',
      })
    }, TIMEOUT_MS)

    audio.onloadedmetadata = () => {
      resolveWithMetadata({ duration: audio.duration })
    }

    audio.onerror = () => {
      const error = audio.error
      const errorCode = error?.code ?? 0
      const errorMessage = error?.message || 'Unknown audio error'

      resolveWithError({
        code: errorCode,
        message: errorMessage,
        type: getErrorType(errorCode),
      })
    }

    audio.src = audioSrc
  })
}

export const getAudioMetadata = (file: File): Promise<AudioMetadataResult> => {
  const objectURL = URL.createObjectURL(file)
  return getAudioMetadataBySource(objectURL, {
    onCleanup: () => URL.revokeObjectURL(objectURL),
  })
}

export const getAudioMetadataFromUrl = (audioUrl: string): Promise<AudioMetadataResult> => {
  return getAudioMetadataBySource(audioUrl, {
    crossOrigin: 'anonymous',
  })
}

export const formatAudioMetadataError = (error: AudioMetadataError, file: File): string => {
  const fileInfo = `File: ${file.name}, Size: ${file.size} bytes, Type: ${file.type}`
  const { code, message, type } = error

  switch (type) {
    case 'decode': {
      return `Audio file appears to be corrupted. ${fileInfo}. Error: ${message} (code: ${code})`
    }
    case 'network': {
      return `Network error while checking audio duration. ${fileInfo}. Error: ${message} (code: ${code})`
    }
    case 'src_not_supported': {
      return `Audio format not supported. ${fileInfo}. Please use MP3, WAV, M4A, OGG, or WebM format.`
    }
    case 'timeout': {
      return `Failed to check audio duration: timeout after 30 seconds. ${fileInfo}`
    }
    default: {
      return `Failed to check audio duration. ${fileInfo}. Error: ${message} (code: ${code})`
    }
  }
}

export const validateAudioMetadata = (result: AudioMetadataResult, file: File): AudioMetadata => {
  if (result.error) {
    throw new Error(formatAudioMetadataError(result.error, file))
  }

  if (!result.metadata) {
    const fileInfo = `File: ${file.name}, Size: ${file.size} bytes, Type: ${file.type}`
    throw new Error(
      `Failed to check audio duration. ${fileInfo}. The audio file may be corrupted, unsupported format, or invalid encoding.`,
    )
  }

  const { metadata } = result

  if (!Number.isFinite(metadata.duration) || metadata.duration <= 0) {
    throw new Error(
      `Invalid audio duration: ${metadata.duration}. File: ${file.name}, Type: ${file.type}. The audio file may be corrupted or incomplete.`,
    )
  }

  return metadata
}
