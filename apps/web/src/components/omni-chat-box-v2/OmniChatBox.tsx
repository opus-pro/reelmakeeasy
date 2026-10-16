'use client'

import { EXPANDED_STORY_MODE_LIMITS } from '@reelmakeeasy/common/story-mode/user-limits'
import { cn } from '@shared/ui'
import React, { forwardRef, useCallback, useMemo, useRef } from 'react'

import { AddImage } from '@/components/icons/core'
import { LongVideoLengthAnnouncementBanner } from '@/components/story-mode/LongVideoLengthAnnouncementBanner'
import { useStoryModeUserLimits } from '@/hooks/useStoryModeUserLimits'

import { ChatBoxRightActions, type ChatBoxRightActionsProps } from './ChatBoxRightActions'
import type { OmniChatBoxProps, OmniChatBoxRef } from './omni-chat-box.types'

export type { OmniChatBoxProps, OmniChatBoxRef } from './omni-chat-box.types'

import { AddAssetsDialog } from './anchor-assets/AddAssetsDialog'
import { AudioCard } from './audio/AudioCard'
import { AudioVoiceoverDialog } from './audio/AudioVoiceoverDialog'
import { SongUploadCard } from './audio/SongUploadCard'
import { VideoAudioConfirmDialog } from './audio/VideoAudioConfirmDialog'
import { buildStyleTileDisplay } from './brand/brand-style-display'
import { BackdropDialog } from './shared/BackdropDialog'
import { ChatBoxStateProvider } from './state/chatbox-context'
import { ChooseStylePopup } from './style/ChooseStylePopup'
import { BaseLayoutWithTypewriter } from './BaseLayoutWithTypewriter'
import { LongTakeStyleButton } from './ChatBoxLeftActionButtons'
import { ChatBoxLeftActions } from './ChatBoxLeftActions'
import { DeleteStyleDialog } from './DeleteStyleDialog'
import { FileUploadButton } from './FileUploadButton'
import {
  getBaseLayoutContentClassName,
  getStoryModeLayoutClassNames,
  getSubmitIsSending,
  hasOmniChatBoxContent,
  resolveCustomStyleLabel,
  STORY_MODE_AUDIO_ACCEPT,
  STORY_MODE_AUDIO_DURATION_UNIT_LABEL,
  STORY_MODE_MAX_IMAGE_ATTACHMENTS,
} from './omni-chat-box-helpers'
import { ScriptPreviewDialog } from './ScriptPreviewDialog'
import type { SettingsDropdownMenuRef } from './settings'
import { StoryComposerLeftActions } from './StoryComposerLeftActions'
import { useImperativeHandleSetup } from './use-omni-chat-box-effects'
import { useOmniChatBoxState } from './use-omni-chat-box-state'

const OmniChatBoxImpl = (props: OmniChatBoxProps, ref: React.ForwardedRef<OmniChatBoxRef>) => {
  const {
    autoFocus = true,
    className = '',
    disabled: disabledProp = false,
    onClick,
    placeholder = '',
    textareaClassName = '',
    useCaseKey,
  } = props

  const settingsMenuRef = useRef<null | SettingsDropdownMenuRef>(null)
  const s = useOmniChatBoxState(props, ref)
  const storyModeUserLimits = useStoryModeUserLimits()
  const isExpandedUser =
    storyModeUserLimits.maxNonAudioDurationSeconds >=
    EXPANDED_STORY_MODE_LIMITS.maxNonAudioDurationSeconds
  const disabled = disabledProp
  const {
    selectedVoice,
    setSelectedVoice,
    sd,
    audio,
    enhancer,
    styleMgmt,
    sendState,
    sub,
    sp,
    state,
    message,
    setMessage,
    handleEditorRef,
    previewSelectedVoice,
    isAddAssetsDialogOpen,
    setIsAddAssetsDialogOpen,
    isVoiceSelectionDialogOpen,
    setIsVoiceSelectionDialogOpen,
    isAudioVoiceoverDialogOpen,
    setIsAudioVoiceoverDialogOpen,
    pendingVideoAudioFile,
    handleVideoAudioConfirm,
    handleVideoAudioCancel,
    longTakeTargetDurationSeconds,
    setLongTakeTargetDurationSeconds,
    showCaptions,
    setShowCaptions,
    selectedRatio,
    setSelectedRatio,
    uploadedStoryModeAnchorAssets,
    hasStoryModeAudioAttachment,
    isStoryModeRoute,
    storyModeLayoutEnabled,
    isSending,
    chatBoxMode,
    isEnhancing,
    isPromptValid,
    characterCount,
    handleFileChange,
    processFiles,
    handleAnchorAssetRemove,
    handleAnchorAssetSelect,
    fileInputRef,
    handleFileUploadClick,
    handleTextareaFocus,
    storyModeStyleOptions,
    userStoryModeStyleOptions,
    geEditor,
  } = s
  useImperativeHandleSetup({
    applyLongTakeTemplate: sub.applyLongTakeTemplate,
    applyQuickStartTemplate: sub.applyQuickStartTemplate,
    focusEditor: () => geEditor()?.focus(),
    openSettingsEntry: (type) => settingsMenuRef.current?.openEntry(type),
    ref,
    setAspectRatio: setSelectedRatio,
    setShowCaptions,
    state,
    submit: sub.handleSubmit,
  })
  // --- Layout computation ---
  const longTakeLayout = useMemo(
    () => (storyModeLayoutEnabled ? 'story' : 'default'),
    [storyModeLayoutEnabled],
  )
  // Moved to a plain helper (resolveCustomStyleLabel in omni-chat-box-helpers)
  // instead of an inline useMemo -- keeps this file under the max-lines cap
  // after the Auto Style Selection prop addition below, without adding to
  // OmniChatBoxImpl's cognitive complexity.
  const customStyleLabel = resolveCustomStyleLabel(
    sd.isCustomStoryStyleActive,
    sd.committedStoryModeStyle,
  )
  const hasContentOverride = useMemo(
    () =>
      hasOmniChatBoxContent({
        message,
        storyModeLayoutEnabled,
      }),
    [message, storyModeLayoutEnabled],
  )
  const showLongVideoBanner = message.trim().length === 0
  const songUploadMode = useCaseKey === 'song-to-video'
  const showSongUploadCard = songUploadMode && !hasStoryModeAudioAttachment

  // --- Left actions ---
  const chatBoxLeftActions = (
    <ChatBoxLeftActions
      chatBoxMode={chatBoxMode}
      disabled={disabled}
      fileInputRef={fileInputRef}
      handleFileChange={handleFileChange}
      isEnhancing={isEnhancing}
      isLongTakeStyleApplyEnabled={sd.isLongTakeStyleApplyEnabled}
      isLongTakeStyleApplySaving={sd.isLongTakeStyleApplying || sd.saveUserStyleMutation.isPending}
      isLongTakeStyleGeneratePreviewEnabled={sd.isLongTakeStyleGeneratePreviewEnabled}
      isLongTakeStylePreviewGenerating={sd.isStylePreviewGenerating}
      isLongTakeStyleWritingWithAi={sd.isLongTakeStyleWritingWithAi}
      isVoiceDialogOpen={isVoiceSelectionDialogOpen}
      layout={longTakeLayout}
      longTakeEnabled={storyModeLayoutEnabled}
      longTakeStyleCustom={sd.longTakeCustomStyle}
      longTakeStyleDialogOpen={sd.longTakeStyleDialogOpen}
      longTakeStyleImageError={sd.longTakeStyleImageError}
      longTakeStyleImageValue={sd.longTakeStyleImageValue}
      longTakeStyleInputMode={sd.longTakeStyleInputMode}
      longTakeStyleName={sd.longTakeStyleName}
      longTakeStylePreviewImageUrl={sd.stylePreviewImageUrl}
      longTakeTargetDurationSeconds={longTakeTargetDurationSeconds}
      onFileUploadClick={handleFileUploadClick}
      onLongTakeStyleApply={sd.handleLongTakeStyleApplyWithChooseStyle}
      onLongTakeStyleCustomChange={sd.handleLongTakeCustomStyleChange}
      onLongTakeStyleDialogOpenChange={sd.handleLongTakeStyleDialogOpenChange}
      onLongTakeStyleGeneratePreview={sd.handleGenerateStylePreview}
      onLongTakeStyleImageClear={sd.handleLongTakeStyleImageClear}
      onLongTakeStyleImageSelect={sd.handleLongTakeStyleImageSelect}
      onLongTakeStyleNameChange={sd.setLongTakeStyleName}
      onLongTakeStyleTextClear={sd.handleLongTakeCustomStyleClear}
      onLongTakeStyleWriteWithAi={sd.handleLongTakeStyleWriteWithAi}
      onLongTakeTargetDurationSecondsChange={setLongTakeTargetDurationSeconds}
      onRatioChange={setSelectedRatio}
      onVoiceDialogOpenChange={setIsVoiceSelectionDialogOpen}
      selectedRatio={selectedRatio}
      selectedVoice={selectedVoice}
      setSelectedVoice={setSelectedVoice}
      setShowCaptions={setShowCaptions}
      settingsMenuRef={settingsMenuRef}
      showCaptions={showCaptions}
      storyModeHasAudioAttachment={storyModeLayoutEnabled || hasStoryModeAudioAttachment}
    />
  )
  const cardDisabled = disabled || isEnhancing || isSending
  const leftActions = (
    <>
      {storyModeLayoutEnabled && (
        <>
          <StoryComposerLeftActions
            disabled={disabled}
            onRatioChange={setSelectedRatio}
            onShowCaptionsChange={setShowCaptions}
            remixProjectId={sd.remixProjectId}
            selectedRatio={selectedRatio}
            showCaptions={showCaptions}
            useCaseKey={useCaseKey}
          />
        </>
      )}
      {chatBoxLeftActions}
    </>
  )

  // --- Right actions + slots ---
  const submitIsSending = getSubmitIsSending(
    storyModeLayoutEnabled,
    isSending,
    sendState.isStoryModeAudioUploading,
  )
  // Badge shows the MARKETED cap (10 min = 600s), not the technical 660s. Clamp
  // the count to it so an accepted 10:00-11:00 upload reads "600 / 600 sec".
  // Display-only; enforcement is unchanged.
  const audioDisplayCapSeconds = storyModeUserLimits.audioUploadDisplayMinutes * 60
  const rightActionsProps: ChatBoxRightActionsProps = {
    characterCount,
    characterLimit: storyModeUserLimits.maxScriptChars,
    chatBoxMode,
    disableSend: sendState.disableSend,
    isEnhancing,
    isUploading: sendState.isStoryModeImageUploading,
    isPromptValid,
    isSending: submitIsSending,
    layout: longTakeLayout,
    onDiscardEnhance: enhancer.handleDiscardEnhance,
    onEnhancePrompt: enhancer.handleEnhancePrompt,
    onKeepEnhance: enhancer.handleKeepEnhance,
    onSend: sub.handleSubmit,
    showWordCount:
      isStoryModeRoute && hasStoryModeAudioAttachment && audio.storyModeAudioCounter !== null,
    submitDisabledTooltipContent: sendState.submitDisabledTooltipContent,
    styleDialogOpen: sd.isChooseStylePopupOpen || sd.longTakeStyleDialogOpen,
    wordCount: hasStoryModeAudioAttachment
      ? Math.min(audio.storyModeAudioCounter ?? 0, audioDisplayCapSeconds)
      : (audio.storyModeAudioCounter ?? s.wordCount),
    wordLimit: hasStoryModeAudioAttachment
      ? audioDisplayCapSeconds
      : storyModeUserLimits.absoluteMaxScriptWords,
    wordUnit: hasStoryModeAudioAttachment ? STORY_MODE_AUDIO_DURATION_UNIT_LABEL : undefined,
  }
  const rightActions = <ChatBoxRightActions {...rightActionsProps} />

  // --- Action card open handlers ---
  const openStoryModeStyleCard = useCallback(() => sd.setIsChooseStylePopupOpen(true), [])
  const openStoryModeAssetsCard = useCallback(() => setIsAddAssetsDialogOpen(true), [])
  const openStoryModeAudioCard = useCallback(() => setIsAudioVoiceoverDialogOpen(true), [])
  const styleTile = buildStyleTileDisplay(
    sd.committedStoryModeStyle,
    sd.selectedStoryModeStyleThumbnailUrl,
    null,
  )
  // `w-fit` rather than a 196px floor: the floor reserved room for three cards, so a
  // flow without the voice card (Song to video) left that slot as dead space.
  const storyModeCardsClass = cn(
    'flex w-fit flex-col gap-3 md:-mt-5 transition-transform duration-500 ease-in-out',
    'md:[[data-engaged]_&]:translate-y-5 md:[[data-has-content]_&]:translate-y-5',
  )
  const storyModeActionCards = storyModeLayoutEnabled ? (
    <div className={storyModeCardsClass}>
      <div className="flex items-start gap-2 pb-2 pl-2">
        <div data-onboarding-target="style-button">
          <LongTakeStyleButton
            disabled={cardDisabled}
            isPreviewGenerating={sd.isStylePreviewGenerating}
            onClick={openStoryModeStyleCard}
            styleName={styleTile.styleName}
            styleText={styleTile.styleText}
            supportingText="Required"
            thumbnailUrl={styleTile.thumbnailUrl}
            variant="story-card"
            visible={storyModeLayoutEnabled}
          />
        </div>
        <div data-onboarding-target="image-upload">
          <FileUploadButton
            accept="image/*,.png,.jpg,.jpeg,.webp,.gif"
            disabled={cardDisabled}
            displayMode="story-card"
            icon={<AddImage className="size-[18px] text-white" />}
            label="Assets"
            onClick={openStoryModeAssetsCard}
            onFileChange={handleFileChange}
            ref={fileInputRef}
            supportingText="Optional"
            tooltipContent="Upload assets (characters, logos, objects)"
          />
        </div>
        {!hasStoryModeAudioAttachment && (
          <div data-onboarding-target="voiceover-upload">
            <AudioCard
              disabled={cardDisabled}
              onOpenVoiceDialog={openStoryModeAudioCard}
              selectedVoice={previewSelectedVoice}
            />
          </div>
        )}
      </div>
    </div>
  ) : null
  // --- Layout classes ---
  const { actionClassName, baseLayoutClassName, storyModeTextareaClassName } =
    getStoryModeLayoutClassNames({
      chatBoxMode,
      className,
      isStoryModeLayout: storyModeLayoutEnabled,
      textareaClassName,
    })
  const baseLayoutContentClassName = getBaseLayoutContentClassName({
    baseLayoutClassName,
    showAnchorAssetsBox: false,
  })

  // --- Render ---
  return (
    <ChatBoxStateProvider value={state}>
      <div
        className={cn(
          'flex w-full flex-col items-center',
          storyModeLayoutEnabled ? 'gap-5' : 'gap-6',
        )}
      >
        <div className="flex w-full flex-col">
          {isExpandedUser && storyModeLayoutEnabled && (
            <LongVideoLengthAnnouncementBanner visible={showLongVideoBanner} />
          )}
          {showSongUploadCard ? (
            <SongUploadCard
              accept={STORY_MODE_AUDIO_ACCEPT}
              className="w-full"
              disabled={disabled || isEnhancing}
              onSelectFiles={(files) => {
                void processFiles(files)
              }}
            />
          ) : (
            <div className="flex relative w-full">
              <BaseLayoutWithTypewriter
                actionClassName={actionClassName}
                attachmentsSection={audio.attachmentsSection}
                autoFocus={autoFocus}
                className={baseLayoutContentClassName}
                disabled={disabled || isEnhancing}
                editorRef={handleEditorRef}
                enableCustomTools={{ longTake: false }}
                hasContentOverride={hasContentOverride}
                hideEditorText={false}
                isSending={isSending}
                leadingPanel={storyModeActionCards}
                leftActions={leftActions}
                longTakeEnabled={storyModeLayoutEnabled}
                message={message}
                onClick={onClick}
                onDropFiles={processFiles}
                onFocus={handleTextareaFocus}
                onMessageChange={setMessage}
                onPasteFiles={processFiles}
                onSubmit={sub.handleSubmit}
                placeholder={placeholder}
                rightActions={rightActions}
                surface="desktop"
                textareaClassName={cn(storyModeTextareaClassName, isEnhancing && 'shine-text')}
              />
            </div>
          )}
        </div>
        <BackdropDialog
          contentClassName="!max-h-[min(571px,calc(100dvh-32px))]"
          onOpenChange={setIsAddAssetsDialogOpen}
          open={isAddAssetsDialogOpen}
          title="Add assets"
        >
          <AddAssetsDialog
            assets={uploadedStoryModeAnchorAssets}
            disabled={cardDisabled}
            maxImageAttachments={STORY_MODE_MAX_IMAGE_ATTACHMENTS}
            onClose={() => setIsAddAssetsDialogOpen(false)}
            onRemove={handleAnchorAssetRemove}
            onSelect={handleAnchorAssetSelect}
            onUpload={s.handleAnchorAssetUpload}
          />
        </BackdropDialog>
        <BackdropDialog
          disableInteraction={sd.longTakeStyleDialogOpen}
          maskClassName="!pointer-events-none"
          onOpenChange={sd.handleChooseStylePopupOpenChange}
          open={sd.isChooseStylePopupOpen}
          title="Choose style"
        >
          <ChooseStylePopup
            customStyleLabel={customStyleLabel}
            customStylePreviewUrl={sd.customStoryStylePreviewUrl}
            isCustomStylePreviewGenerating={sd.isStylePreviewGenerating}
            onAddStyle={sd.handleChooseStylePopupAddStyle}
            onClose={sd.handleChooseStylePopupClose}
            onDeleteUserStyle={styleMgmt.handleDeleteUserStyle}
            onSelectStyle={sd.handleChooseStylePopupSelect}
            selectedStyleId={sd.pickerSelectedStyleId}
            styleOptions={storyModeStyleOptions}
            userStyles={userStoryModeStyleOptions}
          />
        </BackdropDialog>
        <DeleteStyleDialog
          isDeleting={styleMgmt.deleteUserStyleMutation.isPending}
          onCancel={styleMgmt.handleDeleteUserStyleCancel}
          onConfirm={styleMgmt.handleDeleteUserStyleConfirm}
          pendingDeleteStyle={styleMgmt.pendingDeleteStyle}
        />
        {isAudioVoiceoverDialogOpen && (
          <AudioVoiceoverDialog
            maxAudioDurationMinutes={storyModeUserLimits.audioUploadDisplayMinutes}
            onApplyVoice={(voice) => {
              try {
                if (voice && voice.value !== 'auto-select') {
                  localStorage.setItem('lastUsedVoiceId', voice.value)
                } else {
                  localStorage.removeItem('lastUsedVoiceId')
                }
              } catch {
                // Storage unavailable (e.g. private browsing); voice selection still applies
              }
              setSelectedVoice(voice)
            }}
            onOpenChange={setIsAudioVoiceoverDialogOpen}
            onUploadAudioFile={async (file) => {
              await processFiles([file])
            }}
            // Suppress while the video-audio confirm popup is open, to avoid
            // stacked BackdropDialog overlays. Restored automatically on
            // cancel because isAudioVoiceoverDialogOpen stays true.
            open={isAudioVoiceoverDialogOpen && pendingVideoAudioFile === null}
            // Only story-mode routes video uploads through the confirm popup;
            // UGC video / News Article have no such gate, so the dialog
            // closes itself after upload.
            requiresVideoSourceConfirm={storyModeLayoutEnabled}
            selectedVoice={previewSelectedVoice}
          />
        )}
        <VideoAudioConfirmDialog
          file={pendingVideoAudioFile}
          onCancel={handleVideoAudioCancel}
          onConfirm={handleVideoAudioConfirm}
        />
        <ScriptPreviewDialog
          anchorAssets={sp.scriptPreviewAnchorAssets}
          audioAttachmentName={sp.scriptPreviewAudioAttachmentName}
          audioAttachmentUrl={sp.scriptPreviewAudioAttachment?.url || null}
          audioUploadStatus={sp.scriptPreviewAudioUploadStatus}
          estimatedDurationSeconds={sp.scriptPreviewDurationSeconds}
          isSubmitting={sp.isScriptPreviewSubmitting}
          isTextEditable={!sp.isScriptPreviewAudioSource}
          isTranscriptPending={sp.isScriptPreviewTranscriptPending}
          isWordOverLimit={sp.isScriptPreviewOverLimit}
          maxScriptWords={storyModeUserLimits.absoluteMaxScriptWords}
          onClose={sp.closeScriptPreview}
          onConfirm={sp.handleConfirmScriptPreview}
          onRatioChange={setSelectedRatio}
          onRetry={sp.handleRetryScriptPreview}
          onTextChange={sp.setScriptPreviewText}
          onVoiceSelect={(voice) => {
            try {
              if (voice && voice.value !== 'auto-select') {
                localStorage.setItem('lastUsedVoiceId', voice.value)
              } else {
                localStorage.removeItem('lastUsedVoiceId')
              }
            } catch {
              // Storage unavailable (e.g. private browsing); voice selection still applies
            }
            setSelectedVoice(voice)
          }}
          open={sp.scriptPreviewOpen}
          previewErrorMessage={sp.scriptPreviewDisplayErrorMessage}
          previewHasError={sp.scriptPreviewHasError}
          scriptStatus={sp.scriptPreviewStatus}
          selectedRatio={selectedRatio}
          selectedVoice={previewSelectedVoice}
          showVoiceOption={!sp.isScriptPreviewAudioSource}
          styleName={sd.committedStoryModeStyle?.styleName || customStyleLabel}
          styleThumbnailUrl={sd.committedStoryModeStyle?.styleThumbnailUrl || null}
          text={sp.scriptPreviewText}
          wordCount={sp.scriptPreviewWordCount}
        />
      </div>
    </ChatBoxStateProvider>
  )
}

export const OmniChatBox = forwardRef<OmniChatBoxRef, OmniChatBoxProps>(OmniChatBoxImpl)
OmniChatBox.displayName = 'OmniChatBox'
