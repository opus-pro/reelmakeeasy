import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Attachment } from '@shared/types/assets/attachment'
import { toast } from '@shared/ui'
import { useCallback } from 'react'

import { getResourceTypeFromMime } from '@/components/markdown-editor/custom-nodes/utils'
import { getActiveAttachments } from '@/components/markdown-editor/md-utils'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { useStoryModeUserLimits } from '@/hooks/useStoryModeUserLimits'
import { md5FileStream } from '@/util/file-md5'
import { getAudioMetadata, getVideoMetadata, validateAudioMetadata } from '@/util/media'
import { formatSecondsToTime } from '@/util/time-utils'

import type { MarkdownEditorHandle } from '../markdown-editor/EditorContainer'

import {
  consumeAnchorAssetIndex,
  createAnchorAssetIndexMap,
  renameFileToAnchorAsset,
} from './anchor-assets/anchor-assets.utils'
import type { AnchorAssetCategory } from './anchor-assets'
import type { ProcessFilesOptions } from './omni-chat-box.types'
import {
  getStoryModeUploadMaxSize,
  isStoryModeAudioAttachment,
  isStoryModeAudioFile,
  isStoryModeVideoAudioSource,
  normalizeStoryModeSourceFile,
  STORY_MODE_MAX_IMAGE_ATTACHMENTS,
} from './omni-chat-box-helpers'
import { rejectedFilesMessage } from './story-mode-style-image'

// `imageAndAudioOnly` gates image + audio caps for Story Mode and /video;
// `isStoryMode` adds Story-Mode-only processing and implies imageAndAudioOnly.
export function useFileProcessing(
  attachments: Attachment[],
  imageAndAudioOnly: boolean,
  isStoryMode: boolean,
  message: string,
  editorRef: React.RefObject<MarkdownEditorHandle | null>,
  setMessage: (fn: (prev: string) => string) => void,
  setAttachments: (fn: (prev: Attachment[]) => Attachment[]) => void,
  uploadStoryModeAudioToTemp: (file: File, attachmentId: string, audioDuration?: number) => void,
  uploadImageAttachment: (
    file: File,
    attachmentId: string,
    imageCategory?: AnchorAssetCategory,
  ) => Promise<void>,
  confirmVideoAudioSource: (file: File) => Promise<boolean>,
) {
  const storyModeUserLimits = useStoryModeUserLimits()
  // Enforce against the real cap (maxAudioUploadSeconds) but show the marketed
  // figure (audioUploadDisplayMinutes): copy says "10 minutes", rejection only
  // past the 11-min technical cap.
  const maxAudioSec = storyModeUserLimits.maxAudioUploadSeconds
  const maxAudioLabel = `${storyModeUserLimits.audioUploadDisplayMinutes} minutes`

  const buildAttachmentPreview = useCallback(
    async (file: File) => {
      if (file.type.startsWith('image/')) {
        return { previewUrl: URL.createObjectURL(file), duration: undefined }
      }
      // In Story Mode, video files are treated as audio sources: skip the
      // thumbnail and just read duration when the browser can decode the
      // container (non-decodable `.mkv`/`.avi` fall back silently; server
      // ffprobe enforces the cap post-upload). Outside Story Mode, keep
      // the original video-with-thumbnail rendering.
      if (isStoryMode && isStoryModeVideoAudioSource(file)) {
        try {
          const result = await getVideoMetadata(file, { withThumbnail: false })
          if (result.metadata) {
            return { previewUrl: undefined, duration: result.metadata.duration }
          }
        } catch {
          // Non-decodable container. Let the server handle it.
        }
        return { previewUrl: undefined, duration: undefined }
      }
      if (file.type.startsWith('video/')) {
        const result = await getVideoMetadata(file, { withThumbnail: true })
        if (result.metadata) {
          return { previewUrl: result.metadata.thumbnailUrl, duration: result.metadata.duration }
        }
      }
      if (file.type.startsWith('audio/')) {
        const previewUrl = URL.createObjectURL(file)
        const result = await getAudioMetadata(file)
        if (result.metadata) {
          return { previewUrl, duration: result.metadata.duration }
        }
        return { previewUrl, duration: undefined }
      }
      return { previewUrl: undefined, duration: undefined }
    },
    [isStoryMode],
  )

  const resolveFilesToProcess = useCallback(
    (files: File[]) => {
      if (!imageAndAudioOnly) {
        return files
      }
      const imageFiles = files.filter((file) => file.type.startsWith('image/'))
      const audioFiles = files.filter(isStoryModeAudioFile)
      const unsupportedFiles = files.filter(
        (file) => !isStoryModeAudioFile(file) && !file.type.startsWith('image/'),
      )
      // One drop -> at most ONE toast, and it must name the operative problem:
      // a cap that aborts the whole add wins (nothing was added, so
      // that is what the user has to fix first); otherwise a rejection notice
      // that names the offending file. Stable ids keep retriggers of
      // the same notice to a single layer instead of stacking.
      const activeAtts = getActiveAttachments(message, attachments)
      const activeImageCount = activeAtts.filter((att) => att.type.startsWith('image/')).length
      const activeAudioCount = activeAtts.filter((att) => isStoryModeAudioAttachment(att)).length
      if (
        imageFiles.length > 0 &&
        activeImageCount + imageFiles.length > STORY_MODE_MAX_IMAGE_ATTACHMENTS
      ) {
        toast.warning(`Only ${STORY_MODE_MAX_IMAGE_ATTACHMENTS} images are supported`, {
          id: 'omni-files-image-cap',
        })
        return []
      }
      if (audioFiles.length > 0 && activeAudioCount + audioFiles.length > 1) {
        toast.warning('Only one audio or video file is supported', {
          id: 'omni-files-audio-cap',
        })
        return []
      }
      if (unsupportedFiles.length > 0) {
        toast.error(rejectedFilesMessage(unsupportedFiles, 'Only image, video, and audio files'), {
          id: 'omni-files-unsupported-type',
        })
      }
      return [...imageFiles, ...audioFiles]
    },
    [attachments, imageAndAudioOnly, message],
  )

  const getValidStoryModeAudioDuration = useCallback(
    async (file: File): Promise<{ audioDuration?: number; shouldSkip: boolean }> => {
      if (!isStoryMode) {
        return { shouldSkip: false }
      }

      // Video-as-audio sources: probe with <video>, enforce cap if decodable.
      // If not decodable (e.g. `.mkv`/`.avi`), skip client-side validation
      // silently and let server ffprobe enforce the limit.
      if (isStoryModeVideoAudioSource(file)) {
        let videoDuration: number | undefined
        try {
          const result = await getVideoMetadata(file, { withThumbnail: false })
          videoDuration = result.metadata?.duration
        } catch {
          // Non-decodable. Defer to server.
        }
        if (typeof videoDuration === 'number' && Number.isFinite(videoDuration)) {
          if (videoDuration > maxAudioSec) {
            const durationLabel = formatSecondsToTime(videoDuration)
            toast.warning(
              `Story Mode audio must be ${maxAudioLabel} or less. Selected file is ${durationLabel}.`,
              { id: 'omni-files-source-duration' },
            )
            return { shouldSkip: true }
          }
          return { audioDuration: videoDuration, shouldSkip: false }
        }
        return { shouldSkip: false }
      }

      if (!file.type.startsWith('audio/')) {
        return { shouldSkip: false }
      }
      let audioDuration: number
      try {
        const metadata = validateAudioMetadata(await getAudioMetadata(file), file)
        audioDuration = metadata.duration
      } catch (error) {
        const err = ensureError(error)
        toast.error(err.message || 'Failed to check audio duration', {
          id: 'omni-files-audio-probe',
        })
        return { shouldSkip: true }
      }
      if (audioDuration > maxAudioSec) {
        const durationLabel = formatSecondsToTime(audioDuration)
        toast.warning(
          `Story Mode audio must be ${maxAudioLabel} or less. Selected audio is ${durationLabel}.`,
          { id: 'omni-files-audio-duration' },
        )
        return { shouldSkip: true }
      }
      return { audioDuration, shouldSkip: false }
    },
    [isStoryMode, maxAudioSec, maxAudioLabel],
  )

  /**
   * Rename image files into their anchor-asset slot if story-mode
   * character consistency is enabled. Returns the original file otherwise.
   */
  const prepareImageForAnchorAssets = useCallback(
    (
      sourceFile: File,
      options: ProcessFilesOptions,
      anchorIndexMap: ReturnType<typeof createAnchorAssetIndexMap>,
    ): { file: File; metaTagTitle: string } => {
      if (!isStoryMode || !sourceFile.type.startsWith('image/')) {
        return { file: sourceFile, metaTagTitle: sourceFile.name }
      }
      const category = options.imageCategory ?? 'assets'
      const nextIndex = consumeAnchorAssetIndex(anchorIndexMap, category)
      const renamedFile = renameFileToAnchorAsset(sourceFile, category, nextIndex)
      return { file: renamedFile.file, metaTagTitle: renamedFile.displayName }
    },
    [isStoryMode],
  )

  /**
   * Insert the freshly-accepted file as a Story Mode attachment: record
   * in state, insert editor meta-tag, and kick off the appropriate upload
   * side-effect (temp audio vs image attachment).
   */
  const finalizeStoryModeAttachment = useCallback(
    (params: {
      audioDuration: number | undefined
      duration: number | undefined
      file: File
      fileMd5: string
      metaTagTitle: string
      options: ProcessFilesOptions
      previewUrl: string | undefined
    }) => {
      const { file, metaTagTitle, audioDuration, duration, previewUrl, fileMd5, options } = params
      const safeFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
      const tempId = `${safeFileName}-${fileMd5}`
      const attachmentDuration = audioDuration ?? duration
      setAttachments((prev): Attachment[] => {
        if (prev.some((att) => att.id === tempId)) {
          return prev
        }
        return [
          ...prev,
          {
            duration: attachmentDuration,
            file,
            id: tempId,
            name: file.name,
            url: previewUrl,
            size: file.size,
            type: file.type,
            md5: fileMd5,
          },
        ]
      })
      // Force an @audio[...] editor tag for video voice-over sources so
      // the audio-pill rendering branch fires instead of the video
      // thumbnail branch. The attachment's true `type` (e.g. video/mp4)
      // is preserved on the attachment; only the tag-type hint is
      // overridden.
      const editorMimeHint =
        isStoryMode && isStoryModeVideoAudioSource(file) ? 'audio/mpeg' : file.type
      if (editorRef.current) {
        editorRef.current.insertMetaTag(
          tempId,
          metaTagTitle,
          editorMimeHint,
          previewUrl,
          attachmentDuration,
          { isUserInitiated: !options.programmaticEditorInsert },
        )
      } else {
        // No live editor (the song upload card replaces it). Write the
        // serialized tag into the message state instead; the editor renders
        // it as a pill when it mounts, the same way restored drafts do.
        // Without this the attachment never becomes "active" and the UI
        // never leaves the upload card.
        const tagText = `@${getResourceTypeFromMime(editorMimeHint)}[${metaTagTitle}](${tempId})`
        setMessage((prev) => (prev.includes(tagText) ? prev : `${prev}${tagText}`))
      }
      if (isStoryMode && isStoryModeAudioFile(file)) {
        uploadStoryModeAudioToTemp(file, tempId, audioDuration)
      }
      if (imageAndAudioOnly && file.type.startsWith('image/')) {
        uploadImageAttachment(file, tempId, options.imageCategory)
      }
    },
    [
      editorRef,
      imageAndAudioOnly,
      isStoryMode,
      setAttachments,
      setMessage,
      uploadImageAttachment,
      uploadStoryModeAudioToTemp,
    ],
  )

  // The Assets surface takes images only: a video there is rejected rather than
  // silently read as a voiceover source. Returns the files that still need
  // regular processing.
  const peelAssetVideos = useRefCallback((files: File[]): File[] => {
    if (!files.some((file) => file.type.startsWith('video/'))) {
      return files
    }
    toast.error('Videos can’t be added as assets. Add images instead.', {
      id: 'omni-files-asset-video',
    })
    return files.filter((file) => !file.type.startsWith('video/'))
  })

  const processFiles = useCallback(
    async (files: File[], options: ProcessFilesOptions = {}) => {
      const classifiableFiles = options.fromAssetsSurface ? peelAssetVideos(files) : files
      if (classifiableFiles.length === 0) {
        return
      }
      const filesToProcess = resolveFilesToProcess(classifiableFiles)
      if (filesToProcess.length === 0) {
        return
      }
      const anchorIndexMap = createAnchorAssetIndexMap(attachments)
      // Story mode deliberately leaves the `assets` counter unseeded (assets
      // is hidden from ANCHOR_ASSET_CATEGORY_ORDER).
      for (const sourceFile of filesToProcess) {
        const { file: preparedFile, metaTagTitle } = prepareImageForAnchorAssets(
          sourceFile,
          options,
          anchorIndexMap,
        )
        // Synthesize a MIME type for drag-dropped `.mkv`/`.avi`/`.flac`
        // etc. where File.type is empty. The signed-upload endpoint
        // requires a non-empty contentType.
        const file =
          isStoryMode && isStoryModeAudioFile(preparedFile)
            ? normalizeStoryModeSourceFile(preparedFile)
            : preparedFile
        const { maxBytes, message } = getStoryModeUploadMaxSize(file, isStoryMode)
        if (file.size > maxBytes) {
          toast.warning(message, { id: 'omni-files-too-large' })
          continue
        }
        // Single choke point for pre-upload consent: any video-as-audio
        // source must be confirmed by the user before bytes leave the
        // client. Covers the voice-over dialog picker, drag-and-drop, and
        // any other caller that routes through processFiles.
        if (isStoryMode && isStoryModeVideoAudioSource(file)) {
          const confirmed = await confirmVideoAudioSource(file)
          if (!confirmed) {
            continue
          }
        }
        const { audioDuration, shouldSkip } = await getValidStoryModeAudioDuration(file)
        if (shouldSkip) {
          continue
        }
        const fileMd5 = await md5FileStream(file)
        const { previewUrl, duration } = await buildAttachmentPreview(file)
        finalizeStoryModeAttachment({
          file,
          metaTagTitle,
          audioDuration,
          duration,
          previewUrl,
          fileMd5,
          options,
        })
      }
    },
    [
      attachments,
      buildAttachmentPreview,
      confirmVideoAudioSource,
      finalizeStoryModeAttachment,
      getValidStoryModeAudioDuration,
      isStoryMode,
      prepareImageForAnchorAssets,
      peelAssetVideos,
      resolveFilesToProcess,
    ],
  )

  const handleFileChange = useRefCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) {
      return
    }
    await processFiles(files, { imageCategory: 'assets' })
  })

  const handleAnchorAssetUpload = useRefCallback(
    async (category: AnchorAssetCategory, files: File[]) => {
      if (!files.length) {
        return
      }
      await processFiles(files, { imageCategory: category, fromAssetsSurface: true })
    },
  )

  return {
    handleAnchorAssetUpload,
    handleFileChange,
    processFiles,
  }
}
