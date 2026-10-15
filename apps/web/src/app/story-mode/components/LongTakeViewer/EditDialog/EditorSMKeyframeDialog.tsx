'use client'

import { isStoreUri, storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { Button, cn, Dialog, toast, Tooltip } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { KeyframeFrameRole } from '@/atom/longtake-history.types'
import { projectAtom } from '@/atom/project'
import { Cross, Plus, SemiArrowRight } from '@/components/icons/core'
import { MAX_FILE_SIZE, MAX_FILE_SIZE_ERROR_MESSAGE } from '@/constants/file'
import { useApi } from '@/hooks/useApi'
import { useSignedUpload } from '@/hooks/useSignedUpload'

import {
  ReferencePromptEditor,
  type ReferencePromptEditorHandle,
} from '../EditBox/ReferencePromptEditor'
import { useAssetWorkflowProgress } from '../hooks/useAssetWorkflowProgress'
import { RegenLoadingShimmer } from '../RegenLoadingShimmer'

const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'] as const
const ACCEPT_ATTRIBUTE = ACCEPTED_IMAGE_TYPES.join(',')
const REFERENCE_MENTION_LABEL = 'Reference'
const REFERENCE_META_TAG_REGEX = /@img\[Reference\]\([^)]+\)\s*/g

export interface EditorSMKeyframeDialogProps {
  frameRole: KeyframeFrameRole
  imageUrl: string
  initialPrompt: string
  keyframeId: string
  onCancel?: (workflowId: string) => Promise<void>
  onKeyframeConfirm?: (nextImageUrl: string, nextThumbnailUrl?: string) => void
  onOpenChange: (open: boolean) => void
  open: boolean
  projectId: string
  transitionId: string
}

export interface EditorSMKeyframeDialogReferenceImage {
  file: File
  fileUri: string
  previewUrl: string
}

export function EditorSMKeyframeDialog({
  frameRole,
  imageUrl,
  initialPrompt,
  keyframeId,
  onCancel,
  onKeyframeConfirm,
  onOpenChange,
  open,
  projectId,
  transitionId,
}: EditorSMKeyframeDialogProps) {
  const [draftPrompt, setDraftPrompt] = useState(initialPrompt)
  const [referenceImage, setReferenceImage] = useState<EditorSMKeyframeDialogReferenceImage | null>(
    null,
  )
  const [pendingImageUrl, setPendingImageUrl] = useState<null | string>(null)
  const [pendingThumbnailUrl, setPendingThumbnailUrl] = useState<string | undefined>(undefined)
  const [isRegeneratingKeyframe, setIsRegeneratingKeyframe] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const editorRef = useRef<null | ReferencePromptEditorHandle>(null)
  const objectUrlRef = useRef<null | string>(null)
  const workflowIdRef = useRef<null | string>(null)
  const { createSSEConnection, fetchApiDomain } = useApi()
  const {
    connect: connectKeyframeProgress,
    reset: resetKeyframeProgress,
    statusText: keyframeProgressText,
  } = useAssetWorkflowProgress<{ fileUri?: string; thumbnailStorePath?: string }>({
    createSSEConnection,
    workflowKind: 'keyframe_regen',
  })

  const { uploadFile, isUploading: isImageUploading } = useSignedUpload({
    module: 'media-temp',
    onError: () => {
      toast.error('Image upload failed. Please re-attach the image.')
    },
  })
  const regenStartTimeRef = useRef<null | number>(null)
  const frameType = frameRole === 'firstFrame' ? ('first' as const) : ('last' as const)

  const projectInfo = useAtomValue(projectAtom)
  const aspectRatio = (projectInfo?.longTakeRatio ?? '9:16').replace(':', '/')
  const isLandscape = projectInfo?.longTakeRatio === '16:9'

  const isBusy = isRegeneratingKeyframe || isImageUploading
  const previewImageUrl = pendingImageUrl ?? imageUrl
  const isReviewingGeneratedKeyframe = Boolean(pendingImageUrl)
  const isPromptEmpty = !draftPrompt.trim()
  const isGenerateDisabled = isBusy || isPromptEmpty

  const closeSSEConnection = useCallback(() => {
    resetKeyframeProgress()
    setIsRegeneratingKeyframe(false)
  }, [resetKeyframeProgress])

  const removeReferenceMentions = useCallback((value: string): string => {
    return value
      .replace(REFERENCE_META_TAG_REGEX, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }, [])

  const cleanupObjectUrl = useCallback(() => {
    if (objectUrlRef.current?.startsWith('blob:')) {
      URL.revokeObjectURL(objectUrlRef.current)
    }
    objectUrlRef.current = null
  }, [])

  const resetLocalState = useCallback(() => {
    setDraftPrompt(initialPrompt)
    editorRef.current?.reset(initialPrompt)
    setPendingImageUrl(null)
    setPendingThumbnailUrl(undefined)
    setReferenceImage(null)
    cleanupObjectUrl()
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [cleanupObjectUrl, initialPrompt])

  useEffect(() => {
    if (open) {
      resetLocalState()
    } else {
      closeSSEConnection()
      cleanupObjectUrl()
    }
  }, [cleanupObjectUrl, closeSSEConnection, open, resetLocalState])

  useEffect(
    () => () => {
      closeSSEConnection()
      cleanupObjectUrl()
    },
    [cleanupObjectUrl, closeSSEConnection],
  )

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        const wfId = workflowIdRef.current
        workflowIdRef.current = null
        if (wfId) {
          regenStartTimeRef.current = null
          onCancel?.(wfId)
        }
        closeSSEConnection()
        resetLocalState()
      }
      onOpenChange(nextOpen)
    },
    [closeSSEConnection, frameType, onCancel, onOpenChange, resetLocalState, transitionId],
  )

  const validateSelectedFile = useCallback((file: File) => {
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
      toast.error('Only PNG, JPG, JPEG, and WebP images are supported.')
      return false
    }

    if (file.size > MAX_FILE_SIZE) {
      toast.warning(MAX_FILE_SIZE_ERROR_MESSAGE)
      return false
    }

    return true
  }, [])

  const handleUploadButtonClick = useCallback(() => {
    if (isBusy) {
      return
    }
    fileInputRef.current?.click()
  }, [isBusy])

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0]
      if (!file) {
        return
      }

      if (!validateSelectedFile(file)) {
        event.target.value = ''
        return
      }

      cleanupObjectUrl()

      const previewUrl = URL.createObjectURL(file)
      objectUrlRef.current = previewUrl
      try {
        const { fileUri } = await uploadFile(file, { tempScope: 'story-mode-images' })
        setReferenceImage({ file, fileUri, previewUrl })
      } catch {
        cleanupObjectUrl()
        setReferenceImage(null)
      } finally {
        event.target.value = ''
      }
    },
    [cleanupObjectUrl, uploadFile, validateSelectedFile],
  )

  const runGenerate = useCallback(async () => {
    regenStartTimeRef.current = Date.now()

    try {
      setIsRegeneratingKeyframe(true)
      const res = await fetchApiDomain<{ workflowId: string }>(
        `/api/long-take-videos/${projectId}/keyframes/${keyframeId}/regenerate`,
        {
          data: {
            keyframeUrl: previewImageUrl,
            prompt: draftPrompt,
            referenceImageUrl: referenceImage?.fileUri,
          },
          method: 'POST',
        },
      )

      if (!res.ok) {
        throw new Error(res.error || 'Failed to regenerate keyframe')
      }

      workflowIdRef.current = res.data?.workflowId ?? null

      connectKeyframeProgress(
        `/api/long-take-videos/${projectId}/keyframes/${keyframeId}/regenerate/stream`,
        {
          onCompleted: (result) => {
            workflowIdRef.current = null
            const nextStorePath = result?.fileUri
            if (!nextStorePath) {
              closeSSEConnection()
              toast.error('Regenerated keyframe URL is missing')
              return
            }

            regenStartTimeRef.current = null

            const nextImageUrl = isStoreUri(nextStorePath)
              ? storeUriToUrl(nextStorePath)
              : nextStorePath

            const nextThumbnailStorePath = result?.thumbnailStorePath
            const nextThumbnailUrl = isStoreUri(nextThumbnailStorePath)
              ? storeUriToUrl(nextThumbnailStorePath)
              : nextThumbnailStorePath

            setPendingImageUrl(nextImageUrl)
            setPendingThumbnailUrl(nextThumbnailUrl)
            toast.success('New keyframe is generated.')
            closeSSEConnection()
          },
          onConnectionError: (failReason) => {
            regenStartTimeRef.current = null
            workflowIdRef.current = null
            closeSSEConnection()
            toast.error(failReason, { duration: Infinity })
          },
          onFailed: (error) => {
            regenStartTimeRef.current = null
            workflowIdRef.current = null
            closeSSEConnection()
            toast.error(error?.message || 'Keyframe regeneration failed', { duration: Infinity })
          },
          onParseError: () => {
            workflowIdRef.current = null
            closeSSEConnection()
            toast.error('Failed to parse keyframe regeneration status', { duration: Infinity })
          },
        },
      )
    } catch (error) {
      regenStartTimeRef.current = null
      setIsRegeneratingKeyframe(false)
      const failReason = error instanceof Error ? error.message : 'Failed to regenerate keyframe'
      toast.error(failReason, { duration: Infinity })
    }
  }, [
    closeSSEConnection,
    draftPrompt,
    fetchApiDomain,
    frameType,
    keyframeId,
    connectKeyframeProgress,
    previewImageUrl,
    projectId,
    referenceImage,
    transitionId,
  ])

  const handleGenerate = useCallback(() => {
    if (isGenerateDisabled) {
      return
    }
    void runGenerate()
  }, [isGenerateDisabled, runGenerate])

  const handleConfirm = useCallback(() => {
    if (!pendingImageUrl || isBusy) {
      return
    }

    onKeyframeConfirm?.(pendingImageUrl, pendingThumbnailUrl)
    resetLocalState()
    onOpenChange(false)
  }, [
    isBusy,
    onKeyframeConfirm,
    onOpenChange,
    pendingImageUrl,
    pendingThumbnailUrl,
    resetLocalState,
  ])

  const handleRemoveReferenceImage = useCallback(() => {
    cleanupObjectUrl()
    setReferenceImage(null)
    setDraftPrompt((currentPrompt) => {
      const nextPrompt = removeReferenceMentions(currentPrompt)
      editorRef.current?.reset(nextPrompt)
      return nextPrompt
    })
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [cleanupObjectUrl, removeReferenceMentions])

  const referenceOption = useMemo(
    () =>
      referenceImage
        ? {
            previewUrl: referenceImage.previewUrl,
            resourceId: referenceImage.fileUri,
            title: REFERENCE_MENTION_LABEL,
          }
        : null,
    [referenceImage],
  )

  const referenceTileContent = useMemo(() => {
    if (referenceImage) {
      return (
        <>
          <img
            alt="Reference upload preview"
            className="size-full rounded-lg object-cover"
            src={referenceImage.previewUrl}
          />
          <div className="pointer-events-none absolute inset-0 rounded-lg bg-black/10" />
        </>
      )
    }

    if (isImageUploading) {
      return (
        <div className="flex flex-col items-center justify-center gap-1 text-secondary">
          <span className="size-4 animate-spin rounded-full border-[1.5px] border-white/20 border-t-white/80" />
          <span className="sr-only">Uploading reference image</span>
        </div>
      )
    }

    return (
      <>
        <Plus className="size-4.5 text-secondary" />
        <span className="sr-only">Upload reference image</span>
      </>
    )
  }, [isImageUploading, referenceImage])

  const renderComparisonCard = (label: string, src: string) => (
    <div
      className={cn(
        'relative min-w-0 overflow-hidden rounded-md',
        isLandscape ? 'flex-1' : 'h-[267px] max-sm:h-[214px]',
      )}
      key={label}
      style={{ aspectRatio }}
    >
      <img alt={label} className="size-full object-cover" src={src} />
      <div className="absolute inset-0 rounded-md bg-gradient-to-b from-transparent from-[86%] to-black/40" />
      <p className="absolute bottom-2 left-2 text-xs font-medium text-primary">{label}</p>
    </div>
  )

  const renderPlaceholderCard = () => (
    <div
      className={cn(
        'relative min-w-0 overflow-hidden rounded-md bg-fill-secondary',
        isLandscape ? 'flex-1' : 'h-[267px] max-sm:h-[214px]',
      )}
      style={{ aspectRatio }}
    >
      <RegenLoadingShimmer roundedClassName="rounded-md" />
      <p className="absolute bottom-2 left-2 z-[2] text-xs font-medium text-primary">
        {keyframeProgressText ?? 'Generating...'}
      </p>
    </div>
  )

  const renderRegeneratedKeyframeCard = () => {
    if (!pendingImageUrl) {
      return null
    }
    return (
      <div
        className={cn(
          'relative min-w-0 overflow-hidden rounded-md',
          isLandscape ? 'flex-1' : 'h-[267px] max-sm:h-[214px]',
        )}
        key="regenerated"
        style={{ aspectRatio }}
      >
        <img alt="Regenerated" className="size-full object-cover" src={pendingImageUrl} />
        <div className="absolute inset-0 rounded-md bg-gradient-to-b from-transparent from-[86%] to-black/40" />
        {isRegeneratingKeyframe ? <RegenLoadingShimmer roundedClassName="rounded-md" /> : null}
        <p className="absolute bottom-2 left-2 z-[2] text-xs font-medium text-primary">
          {isRegeneratingKeyframe ? (keyframeProgressText ?? 'Generating...') : 'Regenerated'}
        </p>
      </div>
    )
  }

  const renderComparisonPreview = () => (
    <div className="flex w-full items-center justify-center gap-4">
      {renderComparisonCard('Original', imageUrl)}
      <SemiArrowRight className="size-5 shrink-0 text-secondary" />
      {pendingImageUrl ? renderRegeneratedKeyframeCard() : renderPlaceholderCard()}
    </div>
  )

  const renderSinglePreview = () => (
    <div className="flex w-full justify-center">
      <div
        className="relative h-[267px] overflow-hidden rounded-md max-sm:h-[214px]"
        style={{ aspectRatio }}
      >
        <img alt="Keyframe preview" className="size-full object-cover" src={previewImageUrl} />
      </div>
    </div>
  )

  const renderPromptEditor = () => (
    <div
      className={cn(
        'flex w-full items-stretch gap-2 rounded-sm border border-subtle bg-black/15 p-2.5 transition-opacity max-sm:gap-2',
        isRegeneratingKeyframe && 'pointer-events-none opacity-50',
      )}
    >
      <input
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        disabled={isBusy}
        onChange={handleFileChange}
        ref={fileInputRef}
        type="file"
      />
      <div className={cn('relative shrink-0 h-[86px] w-[86px] max-sm:h-[76px] max-sm:w-[76px]')}>
        <button
          aria-label={referenceImage ? 'Reference image uploaded' : 'Upload reference image'}
          className={cn(
            'relative flex h-full w-full items-center justify-center overflow-hidden rounded-sm bg-fill-secondary transition-colors hover:bg-fill-hover',
            isRegeneratingKeyframe && 'pointer-events-none',
            isBusy && !referenceImage && 'pointer-events-none',
            isImageUploading && 'cursor-wait',
          )}
          disabled={isBusy}
          onClick={handleUploadButtonClick}
          type="button"
        >
          {referenceTileContent}
        </button>

        {referenceImage && (
          <button
            aria-label="Remove reference image"
            className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-black/55 text-primary transition-colors hover:bg-black/70"
            disabled={isBusy}
            onClick={handleRemoveReferenceImage}
            type="button"
          >
            <Cross className="size-3" />
          </button>
        )}
      </div>

      <div className="relative flex-1">
        <ReferencePromptEditor
          className={cn(
            'h-[86px] min-h-[78px] max-sm:h-[76px] max-sm:min-h-[68px]',
            'overflow-y-auto border-0 bg-transparent p-1 text-sm text-primary caret-primary outline-none disabled:text-white/25 disabled:cursor-not-allowed',
            '[&_p]:text-sm [&_p]:text-primary',
          )}
          disabled={isRegeneratingKeyframe}
          initValue={draftPrompt}
          onChange={setDraftPrompt}
          placeholder="Edit keyframe prompt..."
          placeholderClassName="p-1 text-sm text-secondary"
          ref={editorRef}
          referenceOption={referenceOption}
        />
      </div>
    </div>
  )

  const tooltipContent = useMemo(() => {
    if (isPromptEmpty) {
      return 'Enter a prompt to generate'
    }
    return null
  }, [isPromptEmpty])

  const renderFooterButtons = () => {
    if (!isReviewingGeneratedKeyframe) {
      return (
        <Tooltip
          className="bg-overlay rounded-xs text-primary backdrop-blur-xl"
          content={tooltipContent}
          side="top"
        >
          <div className="w-full">
            <Button
              className={cn(
                'w-full h-9 rounded-sm bg-fill px-2.5 text-sm font-medium text-primary-foreground hover:bg-white/90',
                'disabled:bg-fill-secondary disabled:text-secondary',
              )}
              disabled={isGenerateDisabled}
              onClick={handleGenerate}
              type="button"
            >
              {isRegeneratingKeyframe ? 'Generating...' : 'Regenerate keyframe'}
            </Button>
          </div>
        </Tooltip>
      )
    }

    return (
      <div className="flex items-center gap-2 w-full">
        <Tooltip
          className="bg-overlay rounded-xs text-primary backdrop-blur-xl"
          content={tooltipContent}
          side="top"
        >
          <div className="w-full">
            <Button
              className="size-full h-9 rounded-sm bg-fill-secondary px-2.5 text-sm font-medium text-primary hover:bg-fill-hover"
              disabled={isGenerateDisabled}
              onClick={handleGenerate}
            >
              Regenerate keyframe
            </Button>
          </div>
        </Tooltip>
        <Button
          className={cn(
            'h-9 rounded-sm bg-fill px-2.5 text-sm font-medium text-primary-foreground hover:bg-white/90',
            'disabled:bg-fill-secondary disabled:text-secondary max-sm:w-full',
          )}
          disabled={isBusy}
          onClick={handleConfirm}
        >
          Generate shot using new keyframe
        </Button>
      </div>
    )
  }

  const renderFooter = () => (
    <div className="flex w-full flex-col items-stretch gap-2">
      <div className="flex flex-row w-full items-center justify-end gap-2">
        {renderFooterButtons()}
      </div>
    </div>
  )

  return (
    <Dialog
      classNames={{
        content:
          'w-[720px] max-w-[calc(100vw-32px)] rounded-2xl border border-tertiary bg-menu/50 p-6 font-sans backdrop-blur-[40px] max-sm:w-[90dvw] max-sm:max-w-[90dvw] max-sm:gap-4 max-sm:p-4',
        description: 'w-full min-w-0 text-sm text-secondary',
        footer:
          'flex items-center justify-end max-sm:flex-col max-sm:items-stretch max-sm:justify-stretch',
        header: 'w-full min-w-0 space-y-1.5 pr-5 max-sm:pr-12',
        overlay: 'bg-overlay/80 backdrop-blur-sm',
        title: 'w-full min-w-0 text-[18px] font-semibold text-primary max-sm:text-base',
      }}
      closeIcon={
        <div className="flex size-7 items-center justify-center rounded-full bg-fill-secondary transition-colors hover:bg-fill-hover max-sm:size-9">
          <Cross className="size-3.5 text-primary" />
        </div>
      }
      description="Edit the prompt to regenerate this keyframe. Style stays unchanged when regenerating keyframes to keep consistency."
      footer={renderFooter()}
      header={undefined}
      ignoreInteractOutside={isRegeneratingKeyframe}
      onOpenChange={handleOpenChange}
      open={open}
      title="Edit keyframe"
    >
      <div className="flex flex-col items-center gap-4">
        {isRegeneratingKeyframe || isReviewingGeneratedKeyframe
          ? renderComparisonPreview()
          : renderSinglePreview()}
        {renderPromptEditor()}
      </div>
    </Dialog>
  )
}
