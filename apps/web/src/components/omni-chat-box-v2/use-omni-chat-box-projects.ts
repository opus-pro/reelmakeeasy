import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import { Attachment } from '@shared/types/assets/attachment'
import { toast } from '@shared/ui'
import { useCallback } from 'react'

import {
  convertVoiceOptionToApiFormat,
  type VoiceOption,
} from '@/components/voice/components/voice-over-selection'
import type { CreateUseCaseKey } from '@/constants/create-use-cases'
import { useFileUrl } from '@/hooks/use-file-url'
import { useApi } from '@/hooks/useApi'
import { useCreateProject } from '@/hooks/useCreateProject'
import { useSignedUpload } from '@/hooks/useSignedUpload'
import { resetCreationSessionId } from '@/lib/creation-session-id'
import { getErrorMessage } from '@/util/error-message'

import { resolveStoryModeShortname } from './omni-chat-box-helpers'
import { isStoreUri } from '@reelmakeeasy/common/storage/address'

const nsLogger = Logger.get('omni-chat-box')

export interface ProjectDeps {
  attachments: Attachment[]
  defaultVoiceId: string
  fetchWithProjectId: ReturnType<typeof useApi>['fetchApiDomain']
  imageUrisRef: React.MutableRefObject<Map<string, string>>
  parseUrl: ReturnType<typeof useFileUrl>['parseUrl']
  selectedRatio: AspectRatio
  selectedVoice: null | VoiceOption
  showCaptions: boolean
  uploadFile: ReturnType<typeof useSignedUpload>['uploadFile']
  // Story Mode project type chosen at creation; persisted to Project.createUseCase.
  useCaseKey?: CreateUseCaseKey
}

export function useProjectOperations(deps: ProjectDeps) {
  const {
    attachments,
    defaultVoiceId,
    fetchWithProjectId,
    imageUrisRef,
    parseUrl,
    selectedRatio,
    selectedVoice,
    showCaptions,
    uploadFile,
    useCaseKey,
  } = deps

  const { createProjectAsync } = useCreateProject()

  const createProjectWithPrompt = async (text: string) => {
    const project = await createProjectAsync({
      text,
      voice: selectedVoice
        ? convertVoiceOptionToApiFormat(selectedVoice, defaultVoiceId)
        : undefined,
      enableCaption: showCaptions,
    })
    resetCreationSessionId()

    return project
  }

  const uploadAttachments = async (currentProjectId: string, attachmentList: Attachment[]) => {
    // Already uploaded: no local file object, has remote url
    const alreadyUploaded = attachmentList.filter((att) => !att.file && att.url)
    // To upload: has local file object (regardless of whether it has a blob preview url)
    const toUpload = attachmentList.filter((att): att is Attachment & { file: File } => !!att.file)

    const uploadPromises = toUpload.map(async (att) => {
      try {
        const { fileUri } = await uploadFile(att.file, {
          projectId: currentProjectId,
          mediaPurpose: 'user_uploaded',
        })

        const res = await fetchWithProjectId<{ path: string }>(
          `/api/media/upload/${currentProjectId}`,
          {
            method: 'POST',
            data: {
              fileUri: fileUri,
              fileContentType: att.file.type,
              fileName: att.file.name,
            },
          },
        )
        if (!res.ok) {
          throw new Error(res.error || 'Upload failed')
        }

        return {
          ...att,
          url: parseUrl(currentProjectId, res.data.path),
        }
      } catch (err) {
        nsLogger.error('File upload error', err)
        return undefined
      }
    })

    const newlyUploaded = await Promise.all(uploadPromises)

    const successfulUploads = newlyUploaded.filter(
      (att): att is NonNullable<typeof att> => att !== undefined,
    )
    const updatedAttachments: Attachment[] = [...alreadyUploaded, ...successfulUploads]
    return updatedAttachments
  }

  const handleCreateNormalProject = async (
    msg: string,
    router: { push: (url: string) => void },
  ) => {
    const normalizedMessage = msg.trim()

    try {
      const newProject = await createProjectWithPrompt(normalizedMessage)
      await uploadAttachments(
        newProject.id,
        attachments.filter((att) => att.type.startsWith('image/')),
      )
      router.push(`/projects/${newProject.id}`)
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to create project')
      toast.warning(errorMessage, {
        className: 'w-full flex justify-center',
        position: 'top-center',
        style: {
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
        },
      })
    }
  }

  const uploadLongTakeAudio = useCallback(
    async (currentProjectId: string, audioAttachment: Attachment): Promise<string | undefined> => {
      const existingUrl = audioAttachment.url
      if (existingUrl && !existingUrl.startsWith('blob:')) {
        return existingUrl
      }
      if (audioAttachment.file) {
        const { fileUri } = await uploadFile(audioAttachment.file, {
          projectId: currentProjectId,
          mediaPurpose: 'user_uploaded',
        })
        return fileUri
      }
      return audioAttachment.url
    },
    [uploadFile],
  )

  const uploadLongTakeStyleImage = useCallback(
    async (currentProjectId: string, styleImage: File): Promise<string> => {
      const { fileUri } = await uploadFile(styleImage, {
        projectId: currentProjectId,
        mediaPurpose: 'override',
      })
      const res = await fetchWithProjectId<{ path: string }>(
        `/api/media/upload-override/${currentProjectId}`,
        {
          method: 'POST',
          data: {
            fileUri: fileUri,
            fileContentType: styleImage.type,
            path: 'storyboard',
          },
        },
      )
      if (!res.ok) {
        throw new Error(res.error || 'Failed to upload style image')
      }
      return res.data.path
    },
    [fetchWithProjectId, uploadFile],
  )

  const createLongTakeProjectForAudio = useCallback(
    async (
      normalizedScript: string,
      audioAttachment: Attachment,
      userPrompt: string,
      normalizeLongTakeScript: (value: string) => string,
    ) => {
      const project = await createProjectAsync({
        text: normalizedScript || normalizeLongTakeScript(userPrompt) || 'Story Mode audio input',
        createUseCase: useCaseKey,
        enableCaption: showCaptions,
        isLongTake: true,
        longTakeInput: 'audio',
        longTakeRatio: selectedRatio,
      })
      const audioUri = await uploadLongTakeAudio(project.id, audioAttachment)
      return { audioUri, projectId: project.id }
    },
    [createProjectAsync, selectedRatio, showCaptions, uploadLongTakeAudio, useCaseKey],
  )

  const createLongTakeProjectForTranscript = useCallback(
    async (
      normalizedScript: string,
      userPrompt: string,
      normalizeLongTakeScript: (value: string) => string,
      textOverride?: string,
    ) => {
      const project = await createProjectAsync({
        text:
          textOverride ||
          normalizedScript ||
          normalizeLongTakeScript(userPrompt) ||
          'Story Mode prompt',
        createUseCase: useCaseKey,
        enableCaption: showCaptions,
        isLongTake: true,
        longTakeInput: 'transcript',
        longTakeRatio: selectedRatio,
      })
      return project.id
    },
    [createProjectAsync, selectedRatio, showCaptions, useCaseKey],
  )

  const uploadStoryModeReferencedImages = useCallback(
    async (
      currentProjectId: string,
      userPromptText: string,
      resolveReferencedImages: (promptText: string) => {
        referencedImages: Attachment[]
        shortnameByAttachmentId: Map<string, string>
      },
    ) => {
      const { referencedImages, shortnameByAttachmentId } = resolveReferencedImages(userPromptText)
      if (!referencedImages.length) {
        return
      }

      await Promise.all(
        referencedImages.map(async (attachment) => {
          const tempSourceStorePath = imageUrisRef.current.get(attachment.id)
          const fallbackFileName = attachment.file?.name || attachment.name
          const shortname = resolveStoryModeShortname(
            shortnameByAttachmentId.get(attachment.id),
            fallbackFileName,
          )

          if (tempSourceStorePath) {
            const copyResponse = await fetchWithProjectId<{ path: string }>(
              `/api/media/upload/${currentProjectId}`,
              {
                method: 'POST',
                data: {
                  fileContentType: attachment.file?.type || attachment.type || 'image/png',
                  fileName: shortname,
                  tempFileUri: tempSourceStorePath,
                },
              },
            )

            if (!copyResponse.ok) {
              throw new Error(
                copyResponse.error || `Failed to copy referenced image: ${attachment.name}`,
              )
            }

            imageUrisRef.current.delete(attachment.id)
            return
          }

          let uploadFileSource: File | undefined = attachment.file
          if (!uploadFileSource) {
            const sourceUrl = attachment.url
            if (!sourceUrl || sourceUrl.startsWith('blob:') || isStoreUri(sourceUrl)) {
              return
            }
            const response = await fetch(sourceUrl)
            if (!response.ok) {
              throw new Error(`Failed to fetch referenced image: ${attachment.name}`)
            }
            const sourceBlob = await response.blob()
            uploadFileSource = new File(
              [sourceBlob],
              attachment.name || `story-mode-ref-${attachment.id}.png`,
              {
                type: attachment.type || sourceBlob.type || 'image/png',
              },
            )
          }

          const { fileUri } = await uploadFile(uploadFileSource, {
            projectId: currentProjectId,
            mediaPurpose: 'user_uploaded',
          })

          const res = await fetchWithProjectId<{ path: string }>(
            `/api/media/upload/${currentProjectId}`,
            {
              method: 'POST',
              data: {
                fileContentType: uploadFileSource.type,
                fileUri: fileUri,
                fileName: shortname,
              },
            },
          )

          if (!res.ok) {
            throw new Error(res.error || `Failed to upload referenced image: ${attachment.name}`)
          }
        }),
      )
    },
    [fetchWithProjectId, imageUrisRef, uploadFile],
  )

  return {
    createLongTakeProjectForAudio,
    createLongTakeProjectForTranscript,
    handleCreateNormalProject,
    uploadLongTakeAudio,
    uploadLongTakeStyleImage,
    uploadStoryModeReferencedImages,
  }
}
