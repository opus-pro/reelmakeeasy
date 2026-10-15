import { AspectRatio } from '@reelmakeeasy/common/media/types'
import type { Position } from '@reelmakeeasy/common/types/video-script'
import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Button, cn, Textarea, toast } from '@shared/ui'
import { useAtom, useAtomValue } from 'jotai'
import { memo, useMemo, useRef, useState } from 'react'

import RiveCanvas from '@/components/animated/RiveCanvas'
import { Ai, CircleArrow, Reframe } from '@/components/icons/core'
import { useProjectId } from '@/contexts/ProjectContext'
import { useRefCallback } from '@/hooks/use-ref-callback'
import { type GenerateProgress, useAssetGeneration } from '@/hooks/useAssetGeneration'
import { getPublicCdnUrl } from '@/util/cdn-utils'

import { useAssetUpload } from '../../hooks/useAssetMutations'
import { useCurrentShotMedia } from '../../hooks/useCurrentShotMedia'
import { useShotPrompt } from '../../hooks/useShotPrompt'
import { useShotUpdate } from '../../hooks/useShotUpdate'
import { renderMainEngineStore } from '../../render-engine-sdk'
import { currentShotAtom } from '../../stores/editor-core.store'
import { editorHistoryStore } from '../../stores/editor-history.store'
import { editorUiStore, GeneratingShotInfo } from '../../stores/editor-ui.store'
import { type KeyframeOption, KeyframeSelectionDialog } from '../KeyframeSelectionDialog'

import { ReframeCropDialog, useReframe } from './ReframeCropDialog'
import { ReplaceShotDialog } from './ReplaceShotDialog'
import { useTrim } from './useTrim'
import { VideoTrimDialog } from './VideoTrimDialog'

interface EditShotPanelProps {
  className?: string
  disabled?: boolean
  onUserInteract: () => void
}

type KeyframeRequest = {
  options: KeyframeOption[]
  progress: GenerateProgress | null
  workflowId: string
}

export const EditShotPanel = memo(({ className, disabled, onUserInteract }: EditShotPanelProps) => {
  const { projectId } = useProjectId()
  const currentShot = useAtomValue(currentShotAtom)
  const currentTime = useAtomValue(renderMainEngineStore.currentTimeWithLowFrequency) / 1000

  const [isReframeUploading, setIsReframeUploading] = useState(false)

  // Replace dialog state
  const [replaceDialogOpen, setReplaceDialogOpen] = useState(false)

  // Prompt state
  const promptTextareaRef = useRef<HTMLTextAreaElement>(null)

  const { uploadMutation, isUploading } = useAssetUpload()
  const {
    generateAssetAsync,
    submitSelection,
    cancelGeneration,
    isLoading: isGeneratingAsset,
  } = useAssetGeneration()

  const currentShotMedia = useCurrentShotMedia()
  const { updateShotWithFullscreen } = useShotUpdate()
  const [generatingShots, setGeneratingShots] = useAtom(editorUiStore.generatingShots)
  const shotMeta = useAtomValue(editorHistoryStore.shotMetaAtom)
  const [keyframeRequest, setKeyframeRequest] = useState<KeyframeRequest | null>(null)
  const keyframeConfirmingRef = useRef(false)
  const keyframeDialogOpen = keyframeRequest !== null
  const keyframeOptions = keyframeRequest?.options ?? []
  const keyframeProgress = keyframeRequest?.progress ?? null
  const workflowId = keyframeRequest?.workflowId ?? null

  const isGenerating = useMemo(
    () =>
      Boolean(
        isGeneratingAsset &&
          currentShot?.id &&
          generatingShots.some((s) => s.id === currentShot.id),
      ),
    [generatingShots, currentShot?.id, isGeneratingAsset],
  )

  // Reframe logic
  const reframe = useReframe()

  const shotDuration = currentShot?.duration

  const shotId = currentShot?.id ?? null
  const { markPromptSynced, prompt, setPrompt } = useShotPrompt(
    shotId,
    currentShot?.description,
    shotId ? shotMeta[shotId]?.prompt : undefined,
  )

  const trim = useTrim({
    currentShot,
    projectId,
    shotDuration,
    onUploadSuccess: async (result) => {
      if (!currentShot) {
        return
      }
      await updateShotWithFullscreen({
        mediaUri: result.cdnUrl,
        previewUri: result.previewCdnUrl,
        shotMetaPatch: {
          shotId: currentShot.id,
          thumbnail: result.thumbnailCdnUrl,
        },
        shotOverride: currentShot,
      })
    },
    uploadMutation,
  })

  const handleFileSelect = useRefCallback(async (file: File) => {
    if (!projectId || !currentShot) {
      return
    }

    try {
      const isVideo = file.type.startsWith('video/')
      const isImage = file.type.startsWith('image/')

      // For images, show reframe dialog first
      if (isImage) {
        reframe.setPendingForUpload(file)
        setReplaceDialogOpen(false)
        return
      }

      if (isVideo) {
        const isValidVideo = await trim.openTrimForFile(file)
        if (isValidVideo) {
          setReplaceDialogOpen(false)
          return
        }
      }
    } catch (error) {
      const err = ensureError(error)
      toast.warning(err.message || 'Failed to upload file')
    }
  })

  const handleReplaceDialogCancel = useRefCallback(() => {
    setReplaceDialogOpen(false)
  })

  const handleOpenReplaceDialog = useRefCallback(() => {
    onUserInteract()
    setReplaceDialogOpen(true)
  })

  const handleUploadConfirm = useRefCallback(async (position: Position) => {
    if (!projectId || !currentShot || !reframe.pendingImage || isReframeUploading) {
      return
    }
    const shot = currentShot
    const pendingImage = reframe.pendingImage
    if (pendingImage.type === 'current') {
      return
    }
    const uploadFile =
      pendingImage.type === 'upload' && pendingImage.imageSource instanceof File
        ? pendingImage.imageSource
        : null

    setIsReframeUploading(true)

    try {
      if (pendingImage.type === 'upload') {
        if (!uploadFile) {
          throw new Error('No upload file available')
        }

        const result = await uploadMutation.mutateAsync({
          file: uploadFile,
          maxDuration: shotDuration,
          mediaType: 'image',
        })

        await updateShotWithFullscreen({
          cropPosition: position,
          mediaUri: result.cdnUrl,
          previewUri: result.previewCdnUrl,
          shotMetaPatch: {
            shotId: shot.id,
            thumbnail: result.thumbnailCdnUrl,
          },
          shotOverride: shot,
        })
      }

      if (pendingImage.type === 'library') {
        await updateShotWithFullscreen({
          cropPosition: position,
          mediaUri: pendingImage.imageSource,
          shotMetaPatch: {
            shotId: shot.id,
            thumbnail: pendingImage.imageSource,
          },
          shotOverride: shot,
        })
      }

      reframe.clearPending()
      reframe.closeDialog()
      toast.success('Shot updated successfully')
    } catch (error) {
      const err = ensureError(error)
      reframe.clearPending()
      reframe.closeDialog()
      toast.warning(err.message || 'Failed to apply asset')
    } finally {
      setIsReframeUploading(false)
    }
  })

  const handleWorkflowStarted = useRefCallback((workflowId: string) => {
    // Open dialog immediately when workflow starts, with no options yet (loading state)
    setKeyframeRequest({ workflowId, options: [], progress: null })
  })

  const handleProgress = useRefCallback((progress: GenerateProgress) => {
    setKeyframeRequest((prev) => (prev ? { ...prev, progress } : null))

    // Update phase in generating shots state
    const shotId = currentShot?.id
    const phase = progress.phase
    if (shotId && phase) {
      setGeneratingShots((prev: GeneratingShotInfo[]) => {
        const existing = prev.find((s) => s.id === shotId)
        if (existing?.phase === phase) {
          return prev
        }
        if (existing) {
          return prev.map((s) => (s.id === shotId ? { ...s, phase } : s))
        }
        return prev
      })
    }
  })

  const handleInteractionNeeded = useRefCallback(
    (request: { candidates: string[]; workflowId: string }) => {
      const { candidates, workflowId } = request
      const options: KeyframeOption[] = candidates.map((fileUri, index) => ({
        imageUrl: storeUriToUrl(fileUri),
        label: `Option ${index + 1}`,
      }))
      // Update existing request with options when candidates are ready
      setKeyframeRequest((prev) => ({
        workflowId,
        options,
        progress: prev?.progress ?? null,
      }))
    },
  )

  const handleKeyframeConfirm = useRefCallback(async (selectedIndex: number) => {
    if (!workflowId || !keyframeOptions[selectedIndex]) {
      return
    }

    keyframeConfirmingRef.current = true
    try {
      const selectedCdnUrl = keyframeOptions[selectedIndex].imageUrl
      await submitSelection(workflowId, selectedCdnUrl)
      setKeyframeRequest(null)
    } catch (error) {
      const err = ensureError(error)
      toast.warning(`Failed to submit keyframe selection: ${err.message}`)
    } finally {
      keyframeConfirmingRef.current = false
    }
  })

  const handleKeyframeCancel = useRefCallback(async () => {
    try {
      workflowId && (await cancelGeneration(workflowId, currentShot?.id))
    } catch (error) {
      const err = ensureError(error)
      toast.warning(`Failed to cancel workflow: ${err.message}`)
    } finally {
      setKeyframeRequest(null)
    }
  })

  const handleKeyframeDialogOpenChange = useRefCallback((open: boolean) => {
    if (!open && workflowId && !keyframeConfirmingRef.current) {
      handleKeyframeCancel()
    }
    if (open) {
      keyframeConfirmingRef.current = false
    }
  })

  const handleReframeClick = useRefCallback(() => {
    onUserInteract()
    if (!reframe.canReframe) {
      toast.warning('No image available for reframe')
      return
    }
    reframe.openReframe()
  })

  const handleGenerate = useRefCallback(async () => {
    onUserInteract()
    if (!prompt.trim() || !projectId || !currentShot) {
      return
    }

    // Capture generation context to avoid issues when user switches shots during generation
    const context = {
      shot: currentShot,
      currentTime,
      shotDuration,
      referenceUrl: currentShotMedia?.previewUri ?? '',
      prompt,
      ratio: '9:16' as AspectRatio,
    }

    // Immediately add to generating state for instant UI feedback (start with keyframe phase)
    setGeneratingShots((prev: GeneratingShotInfo[]) =>
      prev.some((s) => s.id === context.shot.id)
        ? prev
        : [...prev, { id: context.shot.id, phase: 'keyframe' }],
    )

    try {
      const result = await generateAssetAsync({
        duration: context.shotDuration,
        onInteractionNeeded: handleInteractionNeeded,
        onProgress: handleProgress,
        onWorkflowStarted: handleWorkflowStarted,
        prompt: context.prompt,
        projectId,
        ratio: context.ratio,
        referenceUrl: context.referenceUrl,
        sceneId: context.shot.sceneId ?? '',
        shotId: context.shot.id,
      })

      await updateShotWithFullscreen({
        mediaUri: storeUriToUrl(result.fileUri),
        shotMetaPatch: {
          shotId: context.shot.id,
          thumbnail: storeUriToUrl(result.previewThumbnail || result.fileUri),
          prompt: context.prompt,
        },
        shotOverride: context.shot,
      })

      markPromptSynced(context.prompt)
      toast.success('Shot updated successfully')
    } catch (error) {
      const err = ensureError(error)
      if ('errorCategory' in err && err.errorCategory === 'CANCELLED') {
        // If the generation is cancelled, do not show an error toast
        return
      }
      toast.warning('Failed to generate video. Please try again.')
    } finally {
      // Remove from generating state
      setGeneratingShots((prev) => prev.filter((s) => s.id !== context.shot.id))
    }
  })

  return (
    <>
      <div className={cn('flex flex-col gap-4 w-full items-center', className)}>
        <div className="flex items-center justify-center gap-2">
          <Button
            className="h-8 px-2.5 gap-1.5 rounded-sm text-sm font-medium bg-fill-secondary hover:bg-fill-hover hover:text-primary"
            disabled={disabled || isUploading || isGenerating}
            onClick={handleOpenReplaceDialog}
            variant="ghost"
          >
            <CircleArrow className="size-4" />
            <span>Replace</span>
          </Button>

          <Button
            className={cn(
              'h-8 px-2.5 gap-1.5 rounded-sm text-sm font-medium bg-fill-secondary hover:bg-fill-hover hover:text-primary',
              !reframe.canReframe && 'opacity-50',
            )}
            disabled={
              disabled ||
              !reframe.canReframe ||
              reframe.isProcessing ||
              isReframeUploading ||
              isGenerating
            }
            loading={reframe.isProcessing || isReframeUploading}
            onClick={handleReframeClick}
            variant="ghost"
          >
            <Reframe className="size-4" />
            <span>Reframe</span>
          </Button>
        </div>

        {/* Prompt Section */}
        <div
          className={cn(
            'w-[800px] h-32 p-3 rounded-2xl',
            'min-[1920px]:w-[1000px] min-[1920px]:h-40',
            'bg-fill-tertiary shadow-2xl',
            'border border-transparent focus-within:border-ring',
            'flex flex-col',
          )}
        >
          <Textarea
            className={cn(
              'flex-1 resize-none bg-transparent border-0 rounded-none',
              'text-sm placeholder:text-tertiary',
              'focus-visible:ring-0 focus-visible:outline-none',
              'p-0',
              disabled ? 'text-tertiary' : 'text-primary',
              isGenerating && 'shine-text',
            )}
            disabled={disabled || isGenerating}
            onChange={(value) => setPrompt(value)}
            onFocus={onUserInteract}
            placeholder="Describe the video you want to generate..."
            ref={promptTextareaRef}
            value={disabled ? 'Loading the prompt of each shot...' : prompt}
          />

          <div className="mt-2 flex items-center justify-end gap-2.5">
            <Button
              className="h-8 px-2.5"
              disabled={disabled || !prompt.trim() || isGenerating}
              onClick={handleGenerate}
              variant="primary"
            >
              <Ai className={cn('size-4', isGenerating && 'hidden')} />
              <RiveCanvas
                autoplay
                className={cn('size-4', !isGenerating && 'hidden')}
                showLoadingSkeleton={false}
                src={getPublicCdnUrl('agent/rive/ai_icon.riv')}
                stateMachines="State Machine"
              />
              <span>{isGenerating ? 'Generating...' : 'Generate'}</span>
            </Button>
          </div>
        </div>

        {reframe.dialogOpen && (
          <ReframeCropDialog
            imageSource={reframe.pendingImage?.imageSource ?? null}
            isLoading={reframe.isProcessing || isReframeUploading}
            mode={reframe.mode}
            onCancel={reframe.cancel}
            onConfirm={reframe.mode === 'upload' ? handleUploadConfirm : undefined}
            onPositionConfirm={reframe.mode === 'position' ? reframe.confirmPosition : undefined}
            open={reframe.dialogOpen}
          />
        )}

        {trim.pendingVideoFile && shotDuration && (
          <VideoTrimDialog
            clipDurationSec={shotDuration}
            file={trim.pendingVideoFile}
            isLoading={trim.isTrimProcessing}
            onCancel={trim.handleTrimCancel}
            onConfirm={trim.handleTrimConfirm}
            open={trim.trimDialogOpen}
            videoDurationSec={trim.videoDurationSec}
          />
        )}
      </div>
      <KeyframeSelectionDialog
        onConfirm={handleKeyframeConfirm}
        onOpenChange={handleKeyframeDialogOpenChange}
        open={keyframeDialogOpen}
        options={keyframeOptions}
        progress={keyframeProgress}
      />
      <ReplaceShotDialog
        isUploading={isUploading}
        onCancel={handleReplaceDialogCancel}
        onFileSelect={handleFileSelect}
        open={replaceDialogOpen}
      />
    </>
  )
})

EditShotPanel.displayName = 'EditShotPanel'
