export const STORY_MODE_STYLE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
export const STORY_MODE_STYLE_IMAGE_MAX_LABEL = 'Max 5MB'
/** Display text for upload area: matches JPEG, PNG, WebP and 5MB limit (per requirements, not Figma). */
export const STORY_MODE_STYLE_IMAGE_FORMAT_LABEL = 'JPEG, PNG, and WebP formats, up to 5MB'
export const STORY_MODE_STYLE_IMAGE_ERROR_MESSAGE = `Image size is too large. ${STORY_MODE_STYLE_IMAGE_MAX_LABEL}`
export const STORY_MODE_STYLE_IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp'

const STORY_MODE_STYLE_IMAGE_ALLOWED_TYPES = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/webp',
])

// --- Style video file upload ---------------------------------------
// A single video FILE can be dropped/picked alongside images; its frames are
// extracted server-side (same pipeline as the YouTube/Vimeo URL flow) and added
// as reference images. The cap is 10 minutes, enforced authoritatively by the
// backend (ffprobe); the FE only pre-checks when the browser can decode the
// container.

/** Longest accepted style video, matching the backend MAX_VIDEO_DURATION_SEC. */
export const STORY_MODE_STYLE_VIDEO_MAX_DURATION_SEC = 10 * 60
/** Marketed cap shown in the drop-zone copy and the over-cap toast. */
export const STORY_MODE_STYLE_VIDEO_MAX_DURATION_LABEL = '10 minutes'

// Common, broadly browser-decodable containers. This is the VALIDATION
// allowlist (isSupportedStoryModeStyleVideo + the upload contentType fallback);
// other containers (e.g. .mkv, .avi) get the rejection toast. It is no longer
// the file-picker `accept` filter -- see STORY_MODE_STYLE_MEDIA_ACCEPT for why
// the picker uses the broad video/* wildcard instead.
const STORY_MODE_STYLE_VIDEO_ALLOWED_TYPES = new Set<string>([
  'video/mp4',
  'video/quicktime',
  'video/webm',
])
// Extension -> MIME for the accepted containers. Doubles as the support check
// (the keys are the allowed extensions) and the fallback contentType when a
// drag-dropped file arrives with an empty `File.type` (see
// getStoryModeStyleVideoUploadType).
const STORY_MODE_STYLE_VIDEO_EXTENSION_MIME: Record<string, string> = {
  mov: 'video/quicktime',
  mp4: 'video/mp4',
  webm: 'video/webm',
}

// `accept` for the file input: images plus a single video file. The video part
// is the broad video/* wildcard, NOT the specific mp4/mov/webm subtypes: iOS
// Safari's Photos picker greys out videos as unselectable unless accept
// contains video/* (recorded clips report UTIs like HEVC .mov that don't match
// listed subtypes), which made video file upload impossible on mobile while the
// URL field still worked. Format gating stays strict via
// isSupportedStoryModeStyleVideo (FE) and ffprobe (BE), so widening the picker
// hint can't let an unsupported container through -- it just surfaces the
// rejection toast instead of a silently disabled picker entry.
export const STORY_MODE_STYLE_MEDIA_ACCEPT = `${STORY_MODE_STYLE_IMAGE_ACCEPT},video/*`

const styleVideoExtensionOf = (file: File): string =>
  file.name.split('.').pop()?.toLowerCase() ?? ''

/**
 * Is this file an accepted style VIDEO? MIME-first: an allowlisted `File.type`
 * is accepted directly. The extension fallback is used ONLY when `File.type` is
 * empty (the documented drag-drop case) -- a non-empty type outside the
 * allowlist is rejected, so a mislabeled file (e.g. type `video/avi` named
 * `.mp4`) can't sneak through via its extension. Stays consistent with the
 * contentType fallback, which likewise only kicks in for an empty `File.type`.
 */
export const isSupportedStoryModeStyleVideo = (file: File): boolean => {
  if (file.type) {
    return STORY_MODE_STYLE_VIDEO_ALLOWED_TYPES.has(file.type)
  }
  return styleVideoExtensionOf(file) in STORY_MODE_STYLE_VIDEO_EXTENSION_MIME
}

/**
 * The contentType to send when uploading a style video. The signed-upload
 * endpoint (`/api/media/generate-temp-upload-url`) rejects a missing
 * contentType, but drag-dropped `.mp4`/`.mov`/`.webm` can arrive with an empty
 * `File.type`; in that case derive a MIME from the extension so the documented
 * drag-drop case actually uploads. Returns '' only for a file that isn't an
 * accepted video (the caller gates on isSupportedStoryModeStyleVideo first).
 */
const getStoryModeStyleVideoUploadType = (file: File): string => {
  if (file.type) {
    return file.type
  }
  return STORY_MODE_STYLE_VIDEO_EXTENSION_MIME[styleVideoExtensionOf(file)] ?? ''
}

/**
 * Ensure a style video `File` carries a non-empty MIME type before upload. The
 * signed-upload hook reads `File.type` directly for the request's contentType,
 * which the endpoint rejects when empty (the documented drag-drop case where the
 * container arrives with `File.type === ''`). If the type is already set the
 * original file is returned unchanged; otherwise it's wrapped in a new `File`
 * with the extension-derived MIME (the underlying data is not copied). Mirrors
 * normalizeStoryModeSourceFile in omni-chat-box-helpers.
 */
export const normalizeStoryModeStyleVideoFile = (file: File): File => {
  if (file.type) {
    return file
  }
  const synthesizedType = getStoryModeStyleVideoUploadType(file)
  if (!synthesizedType) {
    return file
  }
  return new File([file], file.name, { type: synthesizedType, lastModified: file.lastModified })
}

/**
 * Rejection copy that answers "which file is the problem?" instead of making
 * the user guess: names the first offender, counts the rest, then
 * states the accepted kinds, e.g.
 *   "notes.txt" can't be added. Only image, video, and audio files are supported here
 * One user action (a drop / a picker confirm) should surface at most one such
 * toast -- callers decide the single operative message, this builds its text.
 */
export const rejectedFilesMessage = (rejected: File[], acceptedKinds: string): string => {
  const [first] = rejected
  const name = first?.name || 'This file'
  const others = rejected.length - 1
  const subject = others > 0 ? `"${name}" and ${others} more` : `"${name}"`
  return `${subject} can't be added. ${acceptedKinds} are supported here`
}

export const STORY_MODE_STYLE_IMAGE_MAX_JSON_BYTES = 10 * 1024 * 1024
const STORY_MODE_STYLE_IMAGE_JSON_OVERHEAD_BYTES = 64 * 1024
const STORY_MODE_STYLE_IMAGE_MAX_RAW_BYTES_FOR_JSON = Math.max(
  0,
  Math.floor(STORY_MODE_STYLE_IMAGE_MAX_JSON_BYTES * 0.75) -
    STORY_MODE_STYLE_IMAGE_JSON_OVERHEAD_BYTES,
)

const STORY_MODE_STYLE_IMAGE_MAX_DIMENSION = 4096
const STORY_MODE_STYLE_IMAGE_INITIAL_QUALITY = 0.92
const STORY_MODE_STYLE_IMAGE_MIN_QUALITY = 0.5
const STORY_MODE_STYLE_IMAGE_QUALITY_STEP = 0.05
const STORY_MODE_STYLE_IMAGE_OUTPUT_MIME_TYPE = 'image/jpeg'
const STORY_MODE_STYLE_IMAGE_COMPRESSION_TIMEOUT_MS = 15000

export type StoryModeImageCompressionFailureReason =
  | 'compression_failed'
  | 'timeout'
  | 'unsupported'
  | 'worker_error'

export type StoryModeImageCompressionResult =
  | { blob: Blob; ok: true }
  | { ok: false; reason: StoryModeImageCompressionFailureReason }

type CompressionWorkerResponse = { blob: Blob } | { error: 'compression_failed' | 'unsupported' }

/** Target blob size for requests through Cloudflare (e.g. ~1MB body limit). Base64 adds ~33%, so 400KB blob + JSON stays under limit. */
export const CLOUDFLARE_SAFE_BLOB_BYTES = 400 * 1024
const STYLE_PREVIEW_SAVE_MAX_DIMENSION = 512

function runCompressionWorker(
  blob: Blob,
  options: {
    maxBytes: number
    maxDimension: number
  },
): Promise<StoryModeImageCompressionResult> {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') {
    return Promise.resolve({ ok: false, reason: 'unsupported' })
  }

  return new Promise((resolve) => {
    let worker: Worker
    try {
      worker = new Worker(new URL('story-mode-image-compress.worker.ts', import.meta.url), {
        type: 'module',
      })
    } catch {
      resolve({ ok: false, reason: 'unsupported' })
      return
    }

    let isSettled = false
    const settle = (result: StoryModeImageCompressionResult) => {
      if (isSettled) {
        return
      }
      isSettled = true
      worker.terminate()
      resolve(result)
    }

    const timeoutId = window.setTimeout(
      () => settle({ ok: false, reason: 'timeout' }),
      STORY_MODE_STYLE_IMAGE_COMPRESSION_TIMEOUT_MS,
    )

    worker.onmessage = (event: MessageEvent<CompressionWorkerResponse>) => {
      window.clearTimeout(timeoutId)
      const data = event.data
      if (data && 'error' in data) {
        settle({ ok: false, reason: data.error })
        return
      }
      if (data?.blob) {
        settle({ ok: true, blob: data.blob })
        return
      }
      settle({ ok: false, reason: 'worker_error' })
    }

    worker.onerror = () => {
      window.clearTimeout(timeoutId)
      settle({ ok: false, reason: 'worker_error' })
    }

    worker.postMessage({
      file: blob,
      initialQuality: STORY_MODE_STYLE_IMAGE_INITIAL_QUALITY,
      maxBytes: options.maxBytes,
      maxDimension: options.maxDimension,
      mimeType: STORY_MODE_STYLE_IMAGE_OUTPUT_MIME_TYPE,
      minQuality: STORY_MODE_STYLE_IMAGE_MIN_QUALITY,
      qualityStep: STORY_MODE_STYLE_IMAGE_QUALITY_STEP,
    })
  })
}

/**
 * Compresses a style preview data URL for the save-style API so the request body stays under
 * typical gateway limits (e.g. Cloudflare ~1MB), avoiding 413 Content Too Large.
 */
export async function compressStylePreviewForSave(
  dataUrl: string,
): Promise<StoryModeImageCompressionResult> {
  let blob: Blob
  try {
    const res = await fetch(dataUrl)
    blob = await res.blob()
  } catch {
    return { ok: false, reason: 'compression_failed' }
  }
  return runCompressionWorker(blob, {
    maxBytes: CLOUDFLARE_SAFE_BLOB_BYTES,
    maxDimension: STYLE_PREVIEW_SAVE_MAX_DIMENSION,
  })
}

/**
 * Compresses an image file for any API request (e.g. generate-style-text) so the request body
 * stays under Cloudflare limits. Use when sending imageDataUrl in JSON.
 */
export async function compressImageForApiRequest(
  file: File,
): Promise<StoryModeImageCompressionResult> {
  return runCompressionWorker(file, {
    maxBytes: CLOUDFLARE_SAFE_BLOB_BYTES,
    maxDimension: 1024,
  })
}

export const canSendUncompressedStoryModeStyleImage = (fileSizeBytes: number): boolean =>
  fileSizeBytes <= STORY_MODE_STYLE_IMAGE_MAX_RAW_BYTES_FOR_JSON

export const isSupportedStoryModeStyleImage = (file: File): boolean =>
  STORY_MODE_STYLE_IMAGE_ALLOWED_TYPES.has(file.type)

export const compressStoryModeStyleImage = (file: File): Promise<StoryModeImageCompressionResult> =>
  runCompressionWorker(file, {
    maxBytes: STORY_MODE_STYLE_IMAGE_MAX_BYTES,
    maxDimension: STORY_MODE_STYLE_IMAGE_MAX_DIMENSION,
  })
