import {
  ABSOLUTE_MAX_SCRIPT_WORDS,
  MAX_SCRIPT_CHARS,
} from '@reelmakeeasy/common/utils/script-limits-core'
import {
  STORY_MODE_MAX_AUDIO_DURATION_LABEL as STORY_MODE_MAX_AUDIO_DURATION_LABEL_SHARED,
  STORY_MODE_MAX_AUDIO_DURATION_MINUTES as STORY_MODE_MAX_AUDIO_DURATION_MINUTES_SHARED,
  STORY_MODE_MAX_AUDIO_DURATION_SECONDS as STORY_MODE_MAX_AUDIO_DURATION_SECONDS_SHARED,
} from '@reelmakeeasy/common/utils/story-mode-audio-limits'
import type { Attachment } from '@shared/types/assets/attachment'
import { cn } from '@shared/ui'
import React from 'react'

import {
  LONG_TAKE_PLACEHOLDER_TEXT,
  LONG_TAKE_PLACEHOLDER_TEXT_LEGACY,
} from '@/components/markdown-editor/constants'
import { META_TAG_REGEX } from '@/components/markdown-editor/custom-nodes/MetaTagNode'
import {
  MAX_FILE_SIZE,
  MAX_FILE_SIZE_ERROR_MESSAGE,
  MAX_STORY_MODE_AUDIO_VIDEO_SIZE_BYTES,
  MAX_STORY_MODE_AUDIO_VIDEO_SIZE_ERROR_MESSAGE,
} from '@/constants/file'
import type { UserSavedStyleInputMode } from '@/hooks/useUserSavedStyles'

export const LONG_TAKE_TAG_REGEX = /@(story-mode|long-take)\s*/g
export const META_TAG_GLOBAL_REGEX = new RegExp(META_TAG_REGEX.source, 'g')
export const STORY_MODE_MAX_SCRIPT_WORDS = ABSOLUTE_MAX_SCRIPT_WORDS
export const STORY_MODE_MAX_SCRIPT_CHARS = MAX_SCRIPT_CHARS
export const STORY_MODE_MAX_AUDIO_DURATION_SECONDS = STORY_MODE_MAX_AUDIO_DURATION_SECONDS_SHARED
export const STORY_MODE_MAX_IMAGE_ATTACHMENTS = 8
export const STORY_MODE_MAX_AUDIO_DURATION_MINUTES = STORY_MODE_MAX_AUDIO_DURATION_MINUTES_SHARED
export const STORY_MODE_MAX_AUDIO_DURATION_LABEL = STORY_MODE_MAX_AUDIO_DURATION_LABEL_SHARED
export const STORY_MODE_AUDIO_DURATION_UNIT_LABEL = 'sec'
export const STORY_MODE_AUDIO_TRANSCRIPT_MISSING_ERROR_MESSAGE =
  'The downloaded audio file does not contain a script. Please upload another file or delete the current one.'
export const STORY_MODE_AUDIO_TRANSCRIPT_TIMEOUT_ERROR_MESSAGE =
  'Transcript timed out. Remove the audio and add it again to retry.'
export const STORY_MODE_SCRIPT_PREVIEW_RETRY_MESSAGE =
  'Failed to generate script preview. Please retry.'
export const STORY_MODE_ATTACHED_IMAGE_REGEX = /\[Attached Image:\s*([^\]]+)\]/gi
export const STORY_MODE_EMPTY_STYLE_ID = 'none'

/**
 * Splits a string into chunks of specified length and returns an object with indexed keys.
 * @param value - The string to split
 * @param keyName - The base key name for the resulting object properties
 * @param chunkSize - The maximum length of each chunk (default: 255)
 * @returns An object with keys like `${keyName}_0`, `${keyName}_1`, etc.
 */
export function splitStringToChunks(
  value: string,
  keyName: string,
  chunkSize = 255,
): Record<string, string> {
  if (!value) {
    return {}
  }

  const result: Record<string, string> = {}
  let index = 0

  for (let i = 0; i < value.length; i += chunkSize) {
    result[`${keyName}_${index}`] = value.slice(i, i + chunkSize)
    index++
  }

  return result
}

export const getFileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf('.')
  return lastDot === -1 ? '' : fileName.slice(lastDot + 1).toLowerCase()
}

export const normalizeAttachmentReferenceName = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().toLowerCase()

export const stripFileExtension = (value: string): string => {
  const trimmed = value.trim()
  const lastDot = trimmed.lastIndexOf('.')
  if (lastDot <= 0) {
    return trimmed
  }
  return trimmed.slice(0, lastDot)
}

export const buildAttachmentNameTokens = (value: string): string[] => {
  const normalized = normalizeAttachmentReferenceName(value)
  if (!normalized) {
    return []
  }
  const withoutExtension = normalizeAttachmentReferenceName(stripFileExtension(normalized))
  if (!withoutExtension || withoutExtension === normalized) {
    return [normalized]
  }
  return [normalized, withoutExtension]
}

export const sanitizeStoryModeShortname = (value: string): string =>
  value
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()

export const resolveStoryModeShortname = (
  candidate: string | undefined,
  fallbackFileName: string,
): string => {
  const fallback = sanitizeStoryModeShortname(fallbackFileName) || fallbackFileName
  const cleanedCandidate = sanitizeStoryModeShortname(candidate || '')
  if (!cleanedCandidate) {
    return fallback
  }

  const fallbackExt = getFileExtension(fallback)
  const candidateExt = getFileExtension(cleanedCandidate)
  if (candidateExt) {
    return cleanedCandidate
  }
  return fallbackExt ? `${cleanedCandidate}.${fallbackExt}` : cleanedCandidate
}

/**
 * Video containers accepted as Story Mode audio sources. Ffmpeg demuxes
 * audio from any of these on the server side. Extension-based because
 * File.type is often empty for `.mkv` / `.avi` from drag-drop.
 */
export const STORY_MODE_AUDIO_VIDEO_EXTENSIONS: ReadonlySet<string> = new Set([
  'avi',
  'm4v',
  'mkv',
  'mov',
  'mp4',
  'mpeg',
  'mpg',
])

/**
 * Audio file extensions accepted as Story Mode audio sources. Extension
 * fallback for File.type=='' cases.
 */
export const STORY_MODE_AUDIO_EXTENSIONS: ReadonlySet<string> = new Set([
  'aac',
  'flac',
  'm4a',
  'mp3',
  'ogg',
  'wav',
  'weba',
])

/**
 * Comma-separated `accept=` string for the Story Mode voice-over <input>.
 * Extension-scoped on purpose: the server-side extraction path
 * (`prepareStoryModeAudioForAsr` in `apps/services/api`) keys off the
 * same extension allowlist, so accepting `video/*` at large here would
 * let containers like `.wmv` upload but then skip ffmpeg extraction on
 * the server and fail ASR with a raw unsupported container.
 */
export const STORY_MODE_AUDIO_ACCEPT = [
  ...[...STORY_MODE_AUDIO_EXTENSIONS].map((ext) => `.${ext}`),
  ...[...STORY_MODE_AUDIO_VIDEO_EXTENSIONS].map((ext) => `.${ext}`),
].join(',')

/**
 * Audio-only variant (no video extensions) for the mobile Song card. Dropping
 * the video extensions keeps iOS from offering the "Photo Library" option in the
 * file picker, so it goes straight to Files. Songs are audio, so video-as-audio
 * sources aren't needed here (they remain available in the audio-to-video flow).
 */
export const STORY_MODE_AUDIO_ONLY_ACCEPT = [...STORY_MODE_AUDIO_EXTENSIONS]
  .map((ext) => `.${ext}`)
  .join(',')

/**
 * Is this a video file being used as an audio source? The client check
 * is intentionally extension-based (not MIME-based) so it stays in sync
 * with the server's `isVideoExtension` allowlist. A `video/wmv` MIME
 * alone must not pass because the server cannot extract it today.
 * Drag-drops that arrive with an empty extension also correctly fall
 * through to the unsupported path, where the regular
 * `resolveFilesToProcess` rejection toast fires.
 */
export const isStoryModeVideoAudioSource = (input: { name: string }): boolean => {
  const ext = getFileExtension(input.name)
  return STORY_MODE_AUDIO_VIDEO_EXTENSIONS.has(ext)
}

/**
 * Pick the upload size cap for a freshly-picked file. A Story Mode video
 * voice-over source gets the larger video cap (it is converted to audio
 * server-side, so the generic 120MB cap would reject legitimate ~10-min
 * clips); everything else keeps the generic cap. Returns the matching
 * user-facing message so the caller can show the right toast.
 */
export const getStoryModeUploadMaxSize = (
  file: { name: string },
  isStoryMode: boolean,
): { maxBytes: number; message: string } => {
  if (isStoryMode && isStoryModeVideoAudioSource(file)) {
    return {
      maxBytes: MAX_STORY_MODE_AUDIO_VIDEO_SIZE_BYTES,
      message: MAX_STORY_MODE_AUDIO_VIDEO_SIZE_ERROR_MESSAGE,
    }
  }
  return { maxBytes: MAX_FILE_SIZE, message: MAX_FILE_SIZE_ERROR_MESSAGE }
}

/**
 * Map a Story Mode file extension to a plausible MIME type. Used to
 * synthesize `File.type` for containers the browser leaves empty
 * (commonly `.mkv`, `.avi`, `.flac` on drag-and-drop or system pickers).
 * The backend re-probes content via ffmpeg/ffprobe anyway, so any
 * plausible MIME is sufficient to satisfy the `/generate-temp-upload-url`
 * `contentType` requirement.
 */
const STORY_MODE_EXTENSION_MIME: Record<string, string> = {
  aac: 'audio/aac',
  avi: 'video/x-msvideo',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  m4v: 'video/mp4',
  mkv: 'video/x-matroska',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  mpeg: 'video/mpeg',
  mpg: 'video/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  weba: 'audio/webm',
  webm: 'video/webm',
}

/**
 * Ensure a Story Mode source `File` carries a non-empty MIME type. Some
 * containers (`.mkv`, `.avi`, occasionally `.flac`) arrive from
 * drag-and-drop with `File.type === ''`, which makes the signed-upload
 * request fail server-side. If the type is already set, the original
 * file is returned unchanged. Otherwise we wrap the file in a new `File`
 * with a synthesized type derived from its extension. The underlying
 * data is not copied.
 */
export const normalizeStoryModeSourceFile = (file: File): File => {
  if (file.type) {
    return file
  }
  const ext = getFileExtension(file.name)
  const synthesizedType = STORY_MODE_EXTENSION_MIME[ext]
  if (!synthesizedType) {
    return file
  }
  return new File([file], file.name, { type: synthesizedType, lastModified: file.lastModified })
}

/**
 * File-level: can this newly-picked File be accepted as a Story Mode audio
 * source? Combines MIME sniffing with an extension fallback so drag-and-drop
 * of `.mkv`/`.avi` (which may arrive with empty File.type) still works.
 */
export const isStoryModeAudioFile = (file: File): boolean => {
  if (file.type.startsWith('audio/')) {
    return true
  }
  if (isStoryModeVideoAudioSource(file)) {
    return true
  }
  const ext = getFileExtension(file.name)
  return STORY_MODE_AUDIO_EXTENSIONS.has(ext)
}

/**
 * Attachment-level: is this attachment acting as THE Story Mode audio slot?
 * Replaces scattered `att.type.startsWith('audio/')` checks across the
 * omnichatbox so that video-backed voice-overs aren't dropped by late gates.
 */
export const isStoryModeAudioAttachment = (att: { name: string; type: string }): boolean => {
  if (att.type.startsWith('audio/')) {
    return true
  }
  if (isStoryModeVideoAudioSource(att)) {
    return true
  }
  const ext = getFileExtension(att.name)
  return STORY_MODE_AUDIO_EXTENSIONS.has(ext)
}

export const normalizeLongTakeScript = (value: string): string => {
  return value
    .replace(LONG_TAKE_TAG_REGEX, '')
    .replace(META_TAG_GLOBAL_REGEX, '')
    .replace(new RegExp(STORY_MODE_ATTACHED_IMAGE_REGEX.source, 'gi'), '')
    .replaceAll(LONG_TAKE_PLACEHOLDER_TEXT, '')
    .replaceAll(LONG_TAKE_PLACEHOLDER_TEXT_LEGACY, '')
    .trim()
}

const PLACEHOLDER_CONTENT_META_TAG_REGEX = /@(img|video|audio|pdf|file)\[[^\]]*\]\(([^)]+)\)/i

const hasMetaTagContent = (value: string): boolean => PLACEHOLDER_CONTENT_META_TAG_REGEX.test(value)

export const hasOmniChatBoxContent = ({
  message,
  storyModeLayoutEnabled,
}: {
  message: string
  storyModeLayoutEnabled: boolean
}): boolean =>
  storyModeLayoutEnabled
    ? hasMetaTagContent(message) || normalizeLongTakeScript(message).length > 0
    : hasMetaTagContent(message) || message.trim().length > 0

// Label shown on the custom-style chip/tab when the user's active pick is
// their own unsaved custom style (vs a preset/saved style or Auto). Split out
// of OmniChatBox.tsx (rather than an inline useMemo there) to keep that file
// under the max-lines cap without adding to its cognitive complexity.
export const resolveCustomStyleLabel = (
  isCustomStoryStyleActive: boolean,
  committedStoryModeStyle: null | { styleName?: string },
): string | undefined =>
  isCustomStoryStyleActive && committedStoryModeStyle
    ? committedStoryModeStyle.styleName || 'Custom'
    : undefined

export const readFileAsDataUrl = (file: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result)
      } else {
        reject(new Error('Failed to read file'))
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })

export const normalizeSavedStyleText = (value: string): string =>
  value.replace(/\s+/g, ' ').trim().toLowerCase()

export const createAutoSavedStyleBaseName = (
  styleText: string,
  styleInputMode: UserSavedStyleInputMode,
): string => {
  const normalized = styleText.replace(/\s+/g, ' ').trim()
  const fallback = styleInputMode === 'image' ? 'Image style' : 'Text style'
  if (!normalized) {
    return fallback
  }

  const snippet = normalized.split(' ').slice(0, 6).join(' ')
  const snippetText = snippet.length > 50 ? `${snippet.slice(0, 50).trimEnd()}...` : snippet
  return `${fallback}: ${snippetText}`
}

export const buildUniqueStyleName = (baseName: string, existingNamesLower: Set<string>): string => {
  const normalizedBase = baseName.trim().slice(0, 80) || 'Style'
  if (!existingNamesLower.has(normalizedBase.toLowerCase())) {
    return normalizedBase
  }

  for (let suffix = 2; suffix <= 999; suffix += 1) {
    const marker = ` (${suffix})`
    const trimmedBase = normalizedBase.slice(0, Math.max(1, 80 - marker.length)).trimEnd()
    const candidate = `${trimmedBase}${marker}`
    if (!existingNamesLower.has(candidate.toLowerCase())) {
      return candidate
    }
  }

  return `${normalizedBase.slice(0, 68)} ${Date.now()}`
}

export const getSubmitIsSending = (
  _longTakeEnabled: boolean,
  isSending: boolean,
  _isStoryModeAudioUploading: boolean,
) => isSending

export const getStoryModeLayoutClassNames = ({
  className,
  chatBoxMode,
  isStoryModeLayout,
}: {
  chatBoxMode: string
  className: string
  isStoryModeLayout: boolean
  textareaClassName: string
}) => {
  const actionClassName = isStoryModeLayout
    ? cn(
        '!items-end !px-0 !pt-4 !pb-0 [&>div:first-child]:ml-0',
        'max-sm:[&>div:last-child]:w-full',
      )
    : 'h-[38px] overflow-x-auto px-0 pt-0 pb-0 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&>div:first-child]:ml-0'
  const baseLayoutClassName = cn(
    className,
    chatBoxMode === 'enhance-review' && 'enhance-review-border',
    'min-h-[76px] !backdrop-blur-[50px] !rounded-[24px]',
  )
  const storyModeTextareaClassName = cn(
    '!leading-[26px] !max-h-[284px] placeholder:text-secondary scrollbar-thin',
  )

  return { actionClassName, baseLayoutClassName, storyModeTextareaClassName }
}

export const getBaseLayoutContentClassName = ({
  baseLayoutClassName,
  showAnchorAssetsBox,
}: {
  baseLayoutClassName: string
  showAnchorAssetsBox: boolean
}) => cn(baseLayoutClassName, showAnchorAssetsBox ? '!pl-[76px]' : '')

// Song-to-video entry: declare the uploaded audio as music so the backend
// pins is_music on the session and skips genre detection. Only meaningful
// when the submission actually carries audio.
export function buildSongIsMusicField(
  useCaseKey: CreateUseCaseKey | undefined,
  audioUri: string | undefined,
): { isMusic?: true } {
  return useCaseKey === 'song-to-video' && audioUri ? { isMusic: true } : {}
}

/** First occurrence wins: drop attachments whose id (or url) was already seen. */
export function dedupeAttachmentsByIdOrUrl(attachments: Attachment[]): Attachment[] {
  const deduped: Attachment[] = []
  const seen = new Set<string>()
  for (const attachment of attachments) {
    const key = attachment.id || attachment.url || ''
    if (!key || seen.has(key)) {
      continue
    }
    seen.add(key)
    deduped.push(attachment)
  }
  return deduped
}

/** Resolver mapping @shortname prompt references onto uploaded attachments. */
export type ResolveReferencedImagesFn = (promptText: string) => {
  referencedImages: Attachment[]
  shortnameByAttachmentId: Map<string, string>
  unresolvedReferences: string[]
}

// Music-funnel segmentation props for project.long.take.submitted:
// which omnibox use case submitted, and whether it declares music audio.
export function buildLongTakeSubmittedTrackingProps(
  useCaseKey: CreateUseCaseKey | undefined,
  hasStoryModeAudio: boolean,
): Record<string, boolean | string> {
  return {
    ...(useCaseKey ? { use_case: useCaseKey } : {}),
    is_music: useCaseKey === 'song-to-video' && hasStoryModeAudio,
  }
}

export function buildVoiceTrackingProps(
  voice: null | undefined | VoiceOption,
  options: { hasUploadedAudio?: boolean } = {},
): Record<string, string> {
  if (options.hasUploadedAudio) {
    return {
      selectedVoiceType: 'upload_audio',
      voiceType: 'upload_audio',
    }
  }

  if (!voice) {
    return {
      selectedVoiceId: 'none',
      selectedVoiceType: 'none',
      voiceId: 'none',
      voiceType: 'none',
    }
  }

  const trackingProps: Record<string, string> = {}
  if (voice.provider) {
    trackingProps.selectedVoiceProvider = voice.provider
    trackingProps.voiceProvider = voice.provider
  }

  if (voice.value === 'auto-select') {
    return {
      ...trackingProps,
      selectedVoiceId: voice.value,
      selectedVoiceType: 'presets',
      voiceId: voice.value,
      voiceType: 'presets',
    }
  }

  if (voice.voiceCloneId) {
    return {
      ...trackingProps,
      selectedVoiceCloneId: voice.voiceCloneId,
      selectedVoiceId: voice.value,
      selectedVoiceType: 'voice_clone',
      voiceCloneId: voice.voiceCloneId,
      voiceId: voice.value,
      voiceType: 'voice_clone',
    }
  }

  return {
    ...trackingProps,
    selectedVoiceId: voice.value,
    selectedVoiceType: 'presets',
    voiceId: voice.value,
    voiceType: 'presets',
  }
}

// Type imports needed for helper functions
import type { VoiceOption } from '@/components/voice/components/voice-over-selection'
import type { CreateUseCaseKey } from '@/constants/create-use-cases'
