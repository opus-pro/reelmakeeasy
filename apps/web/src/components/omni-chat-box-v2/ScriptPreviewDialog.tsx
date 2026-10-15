'use client'

import { AspectRatio } from '@reelmakeeasy/common/media/types'
import { cn, Dialog, Textarea } from '@shared/ui'
import { useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import RiveCanvas from '@/components/animated/RiveCanvas'
import { Cross, Loading } from '@/components/icons/core'
import { AudioPlaybackPill } from '@/components/shared/AudioPlaybackPill'
import { PrimaryPillButton } from '@/components/shared/PrimaryPillButton'
import type { VoiceOption } from '@/components/voice/components/voice-over-selection'
import { resolvePlayableAudioUrl, useAudioPlayback } from '@/hooks/useAudioPlayback'
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock'
import { getPublicCdnUrl } from '@/util/cdn-utils'

import { VoiceSelectionDialog } from '../voice'

import type { AnchorAssetPromptItem } from './anchor-assets/anchor-assets.types'
import { AnchorAssetPreview } from './anchor-assets/AnchorAssetPreview'
import { AspectRatioButton } from './AspectRatioButton'
import { StoryModeVoiceButton } from './StoryModeVoiceButton'

type AsyncStatus = 'error' | 'idle' | 'pending' | 'ready'

type ScriptPreviewActionBarProps = {
  audioAttachmentName?: null | string
  audioAttachmentUrl?: null | string
  isConfirmDisabled: boolean
  isSubmitting: boolean
  isTextEditable: boolean
  onConfirm: () => void
  onOpenVoiceDialog: () => void
  onRatioChange: (ratio: AspectRatio) => void
  selectedRatio: AspectRatio
  selectedVoice: null | VoiceOption
  showVoiceOption: boolean
}

type ScriptPreviewDialogProps = {
  anchorAssets: AnchorAssetPromptItem[]
  audioAttachmentName?: null | string
  audioAttachmentUrl?: null | string
  audioUploadStatus?: AsyncStatus
  estimatedDurationSeconds: null | number
  isSubmitting: boolean
  isTextEditable?: boolean
  isTranscriptPending?: boolean
  isWordOverLimit: boolean
  maxScriptWords: number
  onClose: () => void
  onConfirm: () => void
  onRatioChange: (ratio: AspectRatio) => void
  onRetry?: () => void
  onTextChange: (value: string) => void
  onVoiceSelect: (voice: null | VoiceOption) => void
  open: boolean
  previewErrorMessage?: null | string
  previewHasError?: boolean
  scriptStatus: AsyncStatus
  selectedRatio: AspectRatio
  selectedVoice: null | VoiceOption
  showVoiceOption?: boolean
  styleName?: string
  styleThumbnailUrl?: null | string
  text: string
  wordCount: number
}

type ScriptPreviewTranscriptPanelProps = {
  errorMessage?: null | string
  estimatedDurationLabel: null | string
  hideWordLimit?: boolean
  isAudioUploading: boolean
  isScriptError: boolean
  isScriptPending: boolean
  isSubmitting: boolean
  isTextEditable: boolean
  isTranscriptPending: boolean
  isWordOverLimit: boolean
  maxScriptWords: number
  onRetry?: () => void
  onTextChange: (value: string) => void
  styleName?: string
  styleThumbnailUrl?: null | string
  text: string
  wordCount: number
}

const scriptPreviewVoiceDialogClassNames = { content: 'z-[95]', overlay: 'z-[94]' }

const formatEstimatedDurationLabel = (seconds: null | number): null | string => {
  if (seconds === null) {
    return null
  }
  const normalizedSeconds = Math.max(0, Math.round(seconds))
  return `${Math.floor(normalizedSeconds / 60)}:${String(normalizedSeconds % 60).padStart(2, '0')}`
}

const getIsConfirmDisabled = ({
  isSubmitting,
  isWordOverLimit,
  scriptStatus,
  text,
}: {
  isSubmitting: boolean
  isWordOverLimit: boolean
  scriptStatus: AsyncStatus
  text: string
}): boolean => scriptStatus !== 'ready' || isSubmitting || isWordOverLimit || !text.trim().length

export function ScriptPreviewDialog({
  anchorAssets,
  audioAttachmentName,
  audioAttachmentUrl,
  audioUploadStatus = 'idle',
  estimatedDurationSeconds,
  isSubmitting,
  isTranscriptPending = false,
  isTextEditable = true,
  isWordOverLimit,
  maxScriptWords,
  onClose,
  onConfirm,
  onRatioChange,
  onRetry,
  onTextChange,
  onVoiceSelect,
  open,
  selectedRatio,
  selectedVoice,
  showVoiceOption = true,
  scriptStatus,
  previewHasError = false,
  styleName,
  styleThumbnailUrl,
  text,
  previewErrorMessage = null,
  wordCount,
}: ScriptPreviewDialogProps) {
  const [isVoiceDialogOpen, setIsVoiceDialogOpen] = useState(false)
  useBodyScrollLock(open, { lockBody: true, lockHtml: true })

  const isScriptPending = scriptStatus === 'pending'
  const isAudioUploading = audioUploadStatus === 'pending'
  // For audio uploads, hide only the max-cap segment ("/450 ..."), keep the "words" unit visible.
  const hideWordLimit = Boolean(audioAttachmentUrl)
  const effectiveIsWordOverLimit = isWordOverLimit && !hideWordLimit
  const isConfirmDisabled = getIsConfirmDisabled({
    isSubmitting,
    isWordOverLimit: effectiveIsWordOverLimit,
    scriptStatus,
    text,
  })
  const estimatedDurationLabel = formatEstimatedDurationLabel(estimatedDurationSeconds)

  return (
    <Dialog
      classNames={{
        content:
          'z-[85] bg-transparent p-0 w-[800px] max-w-[96vw] h-[100dvh] max-h-[100dvh] border-0 !border-none',
      }}
      footer={null}
      header={null}
      ignoreInteractOutside={true}
      modal={false}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !isSubmitting) {
          onClose()
        }
      }}
      open={open}
      overlay={<ScriptPreviewOverlay />}
      showClose={false}
    >
      <div className="flex h-full min-h-0 flex-col gap-6 py-6">
        <ScriptPreviewCloseButtonPortal isSubmitting={isSubmitting} onClose={onClose} />
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          <ScriptPreviewTranscriptPanel
            errorMessage={previewErrorMessage}
            estimatedDurationLabel={estimatedDurationLabel}
            hideWordLimit={hideWordLimit}
            isAudioUploading={isAudioUploading}
            isScriptError={previewHasError}
            isScriptPending={isScriptPending}
            isSubmitting={isSubmitting}
            isTextEditable={isTextEditable}
            isTranscriptPending={isTranscriptPending}
            isWordOverLimit={effectiveIsWordOverLimit}
            maxScriptWords={maxScriptWords}
            onRetry={onRetry}
            onTextChange={onTextChange}
            styleName={styleName}
            styleThumbnailUrl={styleThumbnailUrl}
            text={text}
            wordCount={wordCount}
          />
          <AnchorAssetPreview assets={anchorAssets} />
        </div>
        <ScriptPreviewActionBar
          audioAttachmentName={audioAttachmentName}
          audioAttachmentUrl={audioAttachmentUrl}
          isConfirmDisabled={isConfirmDisabled}
          isSubmitting={isSubmitting}
          isTextEditable={isTextEditable}
          onConfirm={onConfirm}
          onOpenVoiceDialog={() => setIsVoiceDialogOpen(true)}
          onRatioChange={onRatioChange}
          selectedRatio={selectedRatio}
          selectedVoice={selectedVoice}
          showVoiceOption={showVoiceOption}
        />
        {showVoiceOption ? (
          <VoiceSelectionDialog
            dialogClassNames={scriptPreviewVoiceDialogClassNames}
            onOpenChange={setIsVoiceDialogOpen}
            onVoiceConfirm={onVoiceSelect}
            onVoiceSelect={onVoiceSelect}
            open={isVoiceDialogOpen}
            selectedVoice={selectedVoice?.value ?? null}
          />
        ) : null}
      </div>
    </Dialog>
  )
}

function AudioAttachmentPlaybackPill({
  audioAttachmentName,
  audioAttachmentUrl,
  isSubmitting,
}: {
  audioAttachmentName: string
  audioAttachmentUrl?: null | string
  isSubmitting: boolean
}) {
  const audioPlaybackUrl = useMemo(
    () => resolvePlayableAudioUrl([audioAttachmentUrl]),
    [audioAttachmentUrl],
  )
  const {
    isPlaying: isAudioPlaying,
    progress: audioProgress,
    togglePlayback,
  } = useAudioPlayback(audioPlaybackUrl)

  const isPlayDisabled = isSubmitting || !audioPlaybackUrl

  return (
    <AudioPlaybackPill
      className={cn(
        'min-w-0 max-w-none flex-[0_1_auto] !bg-transparent',
        isPlayDisabled
          ? 'cursor-default opacity-50'
          : 'cursor-default transition-colors hover:!bg-white/[0.18]',
        isAudioPlaying && '!bg-white/10',
      )}
      disabled={isPlayDisabled}
      isPlaying={isAudioPlaying}
      onPlayPause={isPlayDisabled ? undefined : togglePlayback}
      progress={audioProgress}
      showClose={false}
      title={audioAttachmentName}
      variant="pill"
    />
  )
}

function EstimatedDurationInfo({
  estimatedDurationLabel,
}: {
  estimatedDurationLabel: null | string
}) {
  if (!estimatedDurationLabel) {
    return null
  }

  return (
    <span className="text-sm leading-[17px] font-medium text-white/50">
      Est. duration: {estimatedDurationLabel}
    </span>
  )
}

function ScriptPreviewActionBar({
  audioAttachmentName,
  audioAttachmentUrl,
  isConfirmDisabled,
  isSubmitting,
  isTextEditable,
  onConfirm,
  onOpenVoiceDialog,
  onRatioChange,
  selectedRatio,
  selectedVoice,
  showVoiceOption,
}: ScriptPreviewActionBarProps) {
  const actionBarRef = useRef<HTMLDivElement | null>(null)
  return (
    <div
      className="flex shrink-0 grow-0 basis-auto items-center justify-between gap-3"
      ref={actionBarRef}
    >
      <div
        className={cn(
          'flex min-w-0 flex-1 flex-wrap items-center gap-3',
          !showVoiceOption && audioAttachmentName && 'flex-[0_1_auto]',
        )}
      >
        <AspectRatioButton
          disabled={isSubmitting}
          onChange={onRatioChange}
          value={selectedRatio}
          variant="story-bar"
        />
        <ScriptPreviewVoiceSlot
          audioAttachmentName={audioAttachmentName}
          audioAttachmentUrl={audioAttachmentUrl}
          isSubmitting={isSubmitting}
          isTextEditable={isTextEditable}
          onOpenVoiceDialog={onOpenVoiceDialog}
          selectedVoice={selectedVoice}
          showVoiceOption={showVoiceOption}
        />
      </div>
      {isSubmitting ? (
        <div className="flex items-center gap-2 pr-2 text-xs text-white/60">
          <Loading className="size-4 animate-spin" />
          <span>Uploading references and starting Story Mode...</span>
        </div>
      ) : null}
      <div className="flex flex-col items-end gap-1.5">
        <PrimaryPillButton
          className="h-[38px] min-w-[77px]"
          disabled={isConfirmDisabled}
          onClick={onConfirm}
          text="Confirm"
        />
      </div>
    </div>
  )
}

function ScriptPreviewCloseButton({
  isSubmitting,
  onClose,
}: {
  isSubmitting: boolean
  onClose: () => void
}) {
  return (
    <button
      aria-label="Close preview dialog"
      className="fixed left-4 top-4 z-[96] flex size-11 items-center justify-center rounded-full bg-white/20 outline outline-1 outline-white/20 transition-colors hover:bg-white/25 sm:size-9 sm:bg-white/10 sm:outline-white/10"
      disabled={isSubmitting}
      onClick={() => {
        if (!isSubmitting) {
          onClose()
        }
      }}
      type="button"
    >
      <Cross className="size-5 sm:size-4" />
    </button>
  )
}

function ScriptPreviewCloseButtonPortal({
  isSubmitting,
  onClose,
}: {
  isSubmitting: boolean
  onClose: () => void
}) {
  if (typeof document === 'undefined') {
    return null
  }

  return createPortal(
    <ScriptPreviewCloseButton isSubmitting={isSubmitting} onClose={onClose} />,
    document.body,
  )
}

function ScriptPreviewOverlay() {
  return (
    <div className="fixed inset-0 z-[84] pointer-events-auto bg-[#121212] [backdrop-filter:blur(60px)]" />
  )
}

function ScriptPreviewStyleBadge({
  styleName,
  styleThumbnailUrl,
}: {
  styleName?: string
  styleThumbnailUrl?: null | string
}) {
  if (!styleName) {
    return null
  }

  return (
    <div className="ml-auto flex min-w-0 max-w-[160px] items-center gap-3 sm:max-w-[220px]">
      <div className="min-w-0 flex-1 overflow-hidden text-right">
        <p
          className="overflow-hidden text-sm leading-[17px] font-medium break-words text-white [overflow-wrap:anywhere] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2]"
          title={styleName}
        >
          {styleName}
        </p>
        <p className="text-xs leading-[15px] text-white/50">Style</p>
      </div>
      {styleThumbnailUrl ? (
        <div className="h-[50px] w-[37px] shrink-0 overflow-hidden rounded-[10px]">
          <img
            alt={`${styleName} style`}
            className="size-full object-cover"
            fetchPriority="high"
            src={styleThumbnailUrl}
          />
        </div>
      ) : (
        <div className="h-[50px] w-[37px] shrink-0 rounded-[10px] bg-white/10" />
      )}
    </div>
  )
}

function ScriptPreviewTranscriptPanel({
  errorMessage,
  estimatedDurationLabel,
  hideWordLimit = false,
  isAudioUploading,
  isScriptError,
  isScriptPending,
  isSubmitting,
  isTranscriptPending,
  isTextEditable,
  isWordOverLimit,
  maxScriptWords,
  onRetry,
  onTextChange,
  styleName,
  styleThumbnailUrl,
  text,
  wordCount,
}: ScriptPreviewTranscriptPanelProps) {
  const isProcessing = isScriptPending || isAudioUploading || isTranscriptPending
  const displayedErrorMessage = errorMessage || 'Failed to generate script. Please retry.'

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 rounded-[20px] bg-white/10 p-6 data-[generating=false]:pb-4"
      data-generating={String(isScriptPending)}
    >
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1 py-[3px]">
          <p className="text-[18px] leading-[21.8px] font-semibold text-white">Transcript</p>
          <p className="text-sm leading-[22px] text-white/50">
            Preview or edit the script, then confirm to continue
          </p>
        </div>
        <ScriptPreviewStyleBadge styleName={styleName} styleThumbnailUrl={styleThumbnailUrl} />
      </div>

      {isProcessing ? (
        <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-1 rounded-[10px] border border-white/10 bg-black/15 px-5 py-4">
          <RiveCanvas
            autoplay
            className="size-[50px] brightness-0 invert opacity-50"
            showLoadingSkeleton={false}
            src={getPublicCdnUrl('agent/rive/ai_icon.riv')}
            stateMachines="State Machine"
          />
          <p className="text-base leading-[26px] tracking-[-0.12px] text-white/50">
            {isAudioUploading
              ? 'Uploading audio...'
              : isTranscriptPending
                ? 'Generating transcript...'
                : 'Working on a script ...'}
          </p>
        </div>
      ) : isScriptError ? (
        <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center gap-4 rounded-[10px] border border-[#CF4020]/40 bg-[#CF4020]/10 px-5 py-4">
          <p className="text-base leading-[26px] tracking-[-0.12px] text-[#CF4020]">
            {displayedErrorMessage}
          </p>
          {onRetry ? (
            <button
              className="rounded-full border border-[#CF4020]/50 px-4 py-1.5 text-sm leading-[17px] font-medium text-[#CF4020] transition-colors hover:bg-[#CF4020]/10"
              disabled={isSubmitting}
              onClick={onRetry}
              type="button"
            >
              Retry
            </button>
          ) : null}
        </div>
      ) : (
        <>
          <Textarea
            className={cn(
              'scrollbar-thumb-muted-gray min-h-[220px] h-full flex-1 resize-none rounded-[10px] border border-white/10 bg-black/15 px-5 py-4 text-[16px] leading-[26px] tracking-[-0.12px] text-white placeholder:text-white/40 transition-colors hover:border-white/20 focus:border-white/30 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring',
              !isTextEditable &&
                'cursor-default hover:border-white/10 focus:border-white/10 focus-visible:border-white/10',
              isWordOverLimit && 'border-red-400/60',
            )}
            disabled={isSubmitting || !isTextEditable}
            onChange={onTextChange}
            placeholder="Generating your script..."
            value={text}
          />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-[2px] whitespace-nowrap text-sm leading-[17px] font-medium">
              <span className={cn('text-white', isWordOverLimit && 'text-red-300')}>
                {wordCount}
              </span>
              <ScriptPreviewWordLimitText
                hideWordLimit={hideWordLimit}
                isWordOverLimit={isWordOverLimit}
                maxScriptWords={maxScriptWords}
              />
            </div>
            <EstimatedDurationInfo estimatedDurationLabel={estimatedDurationLabel} />
          </div>
        </>
      )}
    </div>
  )
}

function ScriptPreviewVoiceSlot({
  audioAttachmentName,
  audioAttachmentUrl,
  isSubmitting,
  isTextEditable,
  onOpenVoiceDialog,
  selectedVoice,
  showVoiceOption,
}: {
  audioAttachmentName?: null | string
  audioAttachmentUrl?: null | string
  isSubmitting: boolean
  isTextEditable: boolean
  onOpenVoiceDialog: () => void
  selectedVoice: null | VoiceOption
  showVoiceOption: boolean
}) {
  if (showVoiceOption) {
    return (
      <StoryModeVoiceButton
        disabled={isSubmitting || !isTextEditable}
        onOpenVoiceDialog={onOpenVoiceDialog}
        selectedVoice={selectedVoice}
        variant="default"
      />
    )
  }

  if (!audioAttachmentName) {
    return null
  }
  return (
    <AudioAttachmentPlaybackPill
      audioAttachmentName={audioAttachmentName}
      audioAttachmentUrl={audioAttachmentUrl}
      isSubmitting={isSubmitting}
    />
  )
}

function ScriptPreviewWordLimitText({
  hideWordLimit,
  isWordOverLimit,
  maxScriptWords,
}: {
  hideWordLimit: boolean
  isWordOverLimit: boolean
  maxScriptWords: number
}) {
  return hideWordLimit ? (
    <span className={cn('text-white/50', isWordOverLimit && 'text-red-300')}>{'\u00A0words'}</span>
  ) : (
    <>
      <span className={cn('text-white/50', isWordOverLimit && 'text-red-300')}>/</span>
      {isWordOverLimit ? (
        <span className="text-red-300">{maxScriptWords} words over limit</span>
      ) : (
        <span className="text-white/50">{maxScriptWords} words</span>
      )}
    </>
  )
}
