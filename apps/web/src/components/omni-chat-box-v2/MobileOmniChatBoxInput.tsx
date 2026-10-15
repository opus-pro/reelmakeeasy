'use client'

import { Button, cn } from '@shared/ui'
import React, { forwardRef, useCallback, useMemo, useRef } from 'react'

import { AddImage, AtSign, Minimize } from '@/components/icons/core'
import { type MetaTypeaheadCandidate } from '@/components/markdown-editor/plugins/MetaTypeaheadPlugin'
import {
  usePresetVoiceOptions,
  useUserVoiceClones,
} from '@/components/voice/components/voice-over-selection'
import { useStoryModeUserLimits } from '@/hooks/useStoryModeUserLimits'

import { AddAssetsDialog } from './anchor-assets/AddAssetsDialog'
import { AudioCard } from './audio/AudioCard'
import { AudioVoiceoverDialog } from './audio/AudioVoiceoverDialog'
import { SongCard } from './audio/SongCard'
import { VideoAudioConfirmDialog } from './audio/VideoAudioConfirmDialog'
import { BackdropDialog } from './shared/BackdropDialog'
import { ChatBoxStateProvider } from './state/chatbox-context'
import { ChooseStylePopup } from './style/ChooseStylePopup'
import { BaseLayoutWithTypewriter } from './BaseLayoutWithTypewriter'
import { LongTakeStyleButton } from './ChatBoxLeftActionButtons'
import { DeleteStyleDialog } from './DeleteStyleDialog'
import { FileUploadButton } from './FileUploadButton'
import {
  hasOmniChatBoxContent,
  resolveCustomStyleLabel,
  STORY_MODE_AUDIO_ONLY_ACCEPT,
  STORY_MODE_MAX_IMAGE_ATTACHMENTS,
} from './omni-chat-box-helpers'
import { ScriptPreviewDialog } from './ScriptPreviewDialog'
import type { SettingsDropdownMenuRef, SettingsEntry } from './settings'
import { SettingsDropdownMenu } from './settings'
import { StyleStudioDialogs } from './StyleStudioDialogs'
import { useImperativeHandleSetup } from './use-omni-chat-box-effects'
import { useOmniChatBoxState } from './use-omni-chat-box-state'
import { useRemixBgmCarry } from './use-remix-bgm-carry'
import { isVoiceCatalogReady, useVoiceAutoSelect } from './use-voice-auto-select'

export type { OmniChatBoxRef } from './omni-chat-box.types'
import type { OmniChatBoxProps, OmniChatBoxRef } from './omni-chat-box.types'

type MobileOmniChatBoxInputProps = OmniChatBoxProps & {
  /** Controlled compose state: true while the textarea is focused (keyboard up). */
  composeMode?: boolean
  /** Reports focus/blur of the textarea so the parent can toggle compose chrome. */
  onComposeChange?: (composing: boolean) => void
}

/**
 * Mobile-specific input component for the create sheet.
 *
 * Shares state with OmniChatBox via useOmniChatBoxState but renders a
 * simplified layout: action cards above the textarea, no bottom action bar.
 */
const MobileOmniChatBoxInputImpl = (
  props: MobileOmniChatBoxInputProps,
  ref: React.ForwardedRef<OmniChatBoxRef>,
) => {
  const {
    autoFocus = true,
    className = '',
    composeMode = false,
    disabled = false,
    onClick,
    onComposeChange,
    placeholder = '',
    textareaClassName = '',
    useCaseKey,
  } = props

  // Song-to-video reuses the audio-to-video flow but uploads a track instead of
  // picking a voice: no voiceover dialog, and the audio card becomes a Song card.
  const isSongMode = useCaseKey === 'song-to-video'

  const settingsMenuRef = useRef<null | SettingsDropdownMenuRef>(null)
  const s = useOmniChatBoxState(props, ref)
  const storyModeUserLimits = useStoryModeUserLimits()

  const {
    selectedVoice,
    setSelectedVoice,
    sd,
    audio,
    styleMgmt,
    sendState: _sendState,
    sub,
    sp,
    state,
    message,
    setMessage,
    handleEditorRef,
    previewSelectedVoice,
    voiceOptions,
    isAddAssetsDialogOpen,
    setIsAddAssetsDialogOpen,
    isAudioVoiceoverDialogOpen,
    setIsAudioVoiceoverDialogOpen,
    pendingVideoAudioFile,
    handleVideoAudioConfirm,
    handleVideoAudioCancel,
    showCaptions,
    setShowCaptions,
    selectedRatio,
    setSelectedRatio,
    uploadedStoryModeAnchorAssets,
    hasStoryModeAudioAttachment,
    activeStoryModeAudioAttachment,
    setAttachments,
    storyModeLayoutEnabled,
    isSending,
    chatBoxMode,
    isEnhancing,
    handleFileChange,
    processFiles,
    handleAnchorAssetRemove,
    handleAnchorAssetSelect,
    dismissMentionMenu,
    insertText,
    fileInputRef,
    handleFileUploadClick: _handleFileUploadClick,
    handleTextareaFocus,
    storyModeStyleOptions,
    userStoryModeStyleOptions,
    geEditor,
  } = s

  // Resolve carried remix BGM intent here too: the mobile revamp
  // applies remix payloads through THIS composer (MobileCreateSheet ref) and
  // never renders ChatBoxRightActions, so without a reconciler an entitled
  // mobile remix of a BGM-on source would silently submit bgmEnabled=false.
  // Never mounted alongside the desktop composer (breakpoint-gated in
  // DashboardV2), so exactly one reconciler exists per surface. No visible
  // toggle here: entitled -> seed atom (submit carries it); locked -> drop.
  useRemixBgmCarry({ activeRemixProjectId: sd.remixProjectId, enabled: storyModeLayoutEnabled })

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

  // Hydrate the pinned / last-used voice on mount. The desktop renderer does
  // this inside ChatBoxLeftActions, which the mobile create sheet never mounts,
  // so the AudioCard would otherwise show no selected voice.
  const { failed: presetVoicesFailed, loading: isLoadingPresetVoices } = usePresetVoiceOptions()
  const { failed: userVoicesFailed, loading: isLoadingUserVoices } = useUserVoiceClones()
  const voiceCatalogReady = isVoiceCatalogReady({
    isLoadingPresetVoices,
    isLoadingUserVoices,
    presetVoicesFailed,
    userVoicesFailed,
  })
  useVoiceAutoSelect({
    catalogReady: voiceCatalogReady,
    selectedVoice,
    setSelectedVoice,
    voiceOptions,
  })

  // Same label as desktop, via the shared helper (also spares this file's
  // max-lines budget -- the reason it exists, see omni-chat-box-helpers).
  const customStyleLabel = resolveCustomStyleLabel(
    sd.isCustomStoryStyleActive,
    sd.committedStoryModeStyle,
  )

  const hasContentOverride = useMemo(
    () => hasOmniChatBoxContent({ message, storyModeLayoutEnabled }),
    [message, storyModeLayoutEnabled],
  )

  // Settings entries for the hidden drawer - these are what MobileSettingsChips opens.
  const settingsEntries: SettingsEntry[] = useMemo(
    () => [
      {
        type: 'ratio',
        value: selectedRatio,
        onChange: setSelectedRatio,
        enableAllRatios: storyModeLayoutEnabled,
      },
      {
        type: 'caption',
        disabled: storyModeLayoutEnabled,
        enabled: showCaptions,
        onChange: setShowCaptions,
      },
    ],
    [selectedRatio, setSelectedRatio, storyModeLayoutEnabled, showCaptions, setShowCaptions],
  )

  // --- Action cards ---
  const cardDisabled = disabled || isEnhancing || isSending

  const openStoryModeStyleCard = useCallback(
    () => sd.setIsChooseStylePopupOpen(true),
    [sd.setIsChooseStylePopupOpen],
  )
  const openStoryModeAssetsCard = useCallback(
    () => setIsAddAssetsDialogOpen(true),
    [setIsAddAssetsDialogOpen],
  )
  const openStoryModeAudioCard = useCallback(
    () => setIsAudioVoiceoverDialogOpen(true),
    [setIsAudioVoiceoverDialogOpen],
  )
  // "Hide keyboard": dismiss any open mention popover first, then blur to
  // hide the keyboard and fire the guarded blur -> onComposeChange(false).
  const handleHideKeyboard = useCallback(() => {
    ;(document.activeElement as HTMLElement | null)?.blur()
    dismissMentionMenu()
  }, [dismissMentionMenu])
  // Keep focus on the editor when tapping compose action pills so an incidental
  // blur doesn't collapse compose mode.
  const keepEditorFocus = useCallback((e: React.MouseEvent) => e.preventDefault(), [])

  const mentionCandidates = useMemo<MetaTypeaheadCandidate[] | undefined>(() => {
    if (!storyModeLayoutEnabled) {
      return undefined
    }
    return uploadedStoryModeAnchorAssets.map((asset) => ({
      title: asset.displayName,
      type: 'img' as const,
      url: asset.previewUrl,
      value: asset.attachment.id || asset.attachment.url || asset.resourceId || '',
    }))
  }, [uploadedStoryModeAnchorAssets, storyModeLayoutEnabled])

  // The translucent surface (bg-white/10) comes from surface="translucent" on each card.
  const CARD_CLASS = 'h-[100px] w-full min-w-0 aspect-auto rounded-3xl p-3 pb-2.5'

  const storyModeCards = storyModeLayoutEnabled ? (
    <>
      <div className="min-w-0 flex-1" data-onboarding-target="style-button">
        <LongTakeStyleButton
          className={CARD_CLASS}
          disabled={cardDisabled}
          isPreviewGenerating={sd.isStylePreviewGenerating}
          mobileLayout
          onClick={openStoryModeStyleCard}
          styleName={sd.committedStoryModeStyle?.styleName}
          styleText={sd.committedStoryModeStyle?.styleText}
          supportingText="Required"
          surface="translucent"
          thumbnailUrl={sd.selectedStoryModeStyleThumbnailUrl}
          variant="story-card"
          visible={storyModeLayoutEnabled}
        />
      </div>
      <div className="min-w-0 flex-1" data-onboarding-target="image-upload">
        <FileUploadButton
          accept="image/*,.png,.jpg,.jpeg,.webp,.gif"
          className={CARD_CLASS}
          disabled={cardDisabled}
          displayMode="story-card"
          icon={<AddImage className="size-[var(--mobile-icon-size)] text-white" />}
          label="Assets"
          mobileLayout
          onClick={openStoryModeAssetsCard}
          onFileChange={handleFileChange}
          ref={fileInputRef}
          supportingText="Optional"
          surface="translucent"
          tooltipContent="Upload assets (characters, logos, objects)"
        />
      </div>
      {isSongMode ? (
        // Song-to-video: persistent Song card that uploads a track directly
        // (no voiceover dialog) and shows the uploaded file name.
        <div className="min-w-0 flex-1" data-onboarding-target="voiceover-upload">
          <SongCard
            accept={STORY_MODE_AUDIO_ONLY_ACCEPT}
            audioUrl={activeStoryModeAudioAttachment?.url ?? null}
            className={CARD_CLASS}
            disabled={cardDisabled}
            fileName={activeStoryModeAudioAttachment?.name ?? null}
            mobileLayout
            onRemove={() => {
              // Attachments are keyed by id or url (see dedupeAttachmentsByIdOrUrl),
              // so match on either to avoid silently keeping a url-only attachment.
              const id = activeStoryModeAudioAttachment?.id
              const url = activeStoryModeAudioAttachment?.url
              if (id || url) {
                setAttachments((prev) =>
                  prev.filter((a) => !((id && a.id === id) || (url && a.url === url))),
                )
                // The song upload inserts an @audio meta tag into the editor; drop
                // it too, otherwise the orphaned tag fails send-time validation
                // (findUnlinkedMetaIds) and the hidden chip leaves no way to clear it.
                geEditor()?.removeMetaTag([id, url].filter((v): v is string => Boolean(v)))
              }
            }}
            onSelectFiles={(files) => {
              // Programmatic insert so picking a song doesn't focus the textarea
              // / enter compose mode (the song is shown on the card, not typed).
              void processFiles(files, { programmaticEditorInsert: true })
            }}
            placeholder="Required"
            surface="translucent"
          />
        </div>
      ) : (
        !hasStoryModeAudioAttachment && (
          <div className="min-w-0 flex-1" data-onboarding-target="voiceover-upload">
            <AudioCard
              className={CARD_CLASS}
              disabled={cardDisabled}
              mobileLayout
              onOpenVoiceDialog={openStoryModeAudioCard}
              selectedVoice={previewSelectedVoice}
              surface="translucent"
            />
          </div>
        )
      )}
    </>
  ) : null

  const actionCards = storyModeCards

  const baseLayoutClassName = cn(
    className,
    chatBoxMode === 'enhance-review' && 'enhance-review-border',
    'h-full min-h-[76px] !backdrop-blur-[50px] !rounded-[24px]',
  )

  return (
    <ChatBoxStateProvider value={state}>
      {/* Hidden settings drawer - mounted so openSettingsEntry() works via MobileSettingsChips */}
      <div aria-hidden className="hidden">
        <SettingsDropdownMenu
          disabled={disabled}
          entries={settingsEntries}
          ref={settingsMenuRef}
          variant="drawer"
        />
      </div>

      <div className="flex size-full flex-col gap-2">
        {/* Action cards: own evenly-distributed row, outside the chatbox. Hidden in compose. */}
        {!composeMode && actionCards && (
          <div className="flex w-full shrink-0 gap-2">{actionCards}</div>
        )}

        {/* Textarea: grows to fill remaining vertical space */}
        <div className="flex min-h-0 flex-1 flex-col">
          <BaseLayoutWithTypewriter
            attachmentsSection={isSongMode ? undefined : audio.attachmentsSection}
            autoFocus={autoFocus}
            className={baseLayoutClassName}
            disabled={disabled || isEnhancing}
            editorRef={handleEditorRef}
            enableCustomTools={{ longTake: false }}
            hasContentOverride={hasContentOverride}
            hideEditorText={false}
            isSending={isSending}
            longTakeEnabled={storyModeLayoutEnabled}
            mentionCandidates={mentionCandidates}
            mentionMenuVariant="mobile-sheet"
            message={message}
            mobileSheetMode
            onClick={onClick}
            onDropFiles={processFiles}
            onEngagedChange={onComposeChange}
            onFocus={handleTextareaFocus}
            onMessageChange={setMessage}
            onPasteFiles={processFiles}
            onSubmit={sub.handleSubmit}
            onUploadNewAsset={storyModeLayoutEnabled ? openStoryModeAssetsCard : undefined}
            placeholder={placeholder}
            surface="mobile"
            textareaClassName={cn('!max-h-none', isEnhancing && 'shine-text', textareaClassName)}
          />
        </div>

        {/* Compose action row: shown while the textarea is focused (keyboard up). */}
        {composeMode && (
          <div className="flex shrink-0 flex-row gap-2 duration-150 animate-in fade-in-0">
            <Button
              className="gap-2 rounded-full px-4 text-sm md:hover:bg-white/15 md:active:bg-white/20"
              onClick={handleHideKeyboard}
              onMouseDown={keepEditorFocus}
              onTouchEnd={(e) => {
                e.preventDefault()
                handleHideKeyboard()
              }}
              size="xlg"
              type="button"
            >
              <Minimize className="size-[18px] shrink-0" />
              Hide keyboard
            </Button>
            {storyModeLayoutEnabled && (
              <Button
                className="gap-2 rounded-full px-4 text-sm md:hover:bg-white/15 md:active:bg-white/20"
                onPointerDown={(e) => {
                  e.preventDefault()
                  insertText('@')
                }}
                size="xlg"
                type="button"
              >
                <AtSign className="size-[18px] shrink-0" />
                Mention
              </Button>
            )}
          </div>
        )}

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
            mobileLayout
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
            mobileLayout
            onAddStyle={sd.handleChooseStylePopupAddStyle}
            onClose={sd.handleChooseStylePopupClose}
            onDeleteUserStyle={styleMgmt.handleDeleteUserStyle}
            onSelectStyle={sd.handleChooseStylePopupSelect}
            selectedStyleId={sd.pickerSelectedStyleId}
            styleOptions={storyModeStyleOptions}
            userStyles={userStoryModeStyleOptions}
          />
        </BackdropDialog>

        {/* Add-Style studio (shared with desktop) so "Add new style" works on mobile. */}
        <StyleStudioDialogs
          disabled={disabled}
          isLongTakeStyleApplyEnabled={sd.isLongTakeStyleApplyEnabled}
          isLongTakeStyleApplySaving={
            sd.isLongTakeStyleApplying || sd.saveUserStyleMutation.isPending
          }
          isLongTakeStyleDialogOpen={sd.longTakeStyleDialogOpen}
          isLongTakeStyleGeneratePreviewEnabled={sd.isLongTakeStyleGeneratePreviewEnabled}
          isLongTakeStylePreviewGenerating={sd.isStylePreviewGenerating}
          longTakeStyleCustom={sd.longTakeCustomStyle}
          longTakeStyleImageError={sd.longTakeStyleImageError}
          longTakeStyleImageValue={sd.longTakeStyleImageValue}
          longTakeStyleInputMode={sd.longTakeStyleInputMode}
          longTakeStyleName={sd.longTakeStyleName}
          longTakeStylePreviewImageUrl={sd.stylePreviewImageUrl}
          onLongTakeStyleApply={sd.handleLongTakeStyleApplyWithChooseStyle}
          onLongTakeStyleCustomChange={sd.handleLongTakeCustomStyleChange}
          onLongTakeStyleGeneratePreview={sd.handleGenerateStylePreview}
          onLongTakeStyleImageClear={sd.handleLongTakeStyleImageClear}
          onLongTakeStyleImageSelect={sd.handleLongTakeStyleImageSelect}
          onLongTakeStyleNameChange={sd.setLongTakeStyleName}
          onLongTakeStyleTextClear={sd.handleLongTakeCustomStyleClear}
          setIsLongTakeStyleDialogOpen={sd.handleLongTakeStyleDialogOpenChange}
        />

        <DeleteStyleDialog
          isDeleting={styleMgmt.deleteUserStyleMutation.isPending}
          onCancel={styleMgmt.handleDeleteUserStyleCancel}
          onConfirm={styleMgmt.handleDeleteUserStyleConfirm}
          pendingDeleteStyle={styleMgmt.pendingDeleteStyle}
        />

        {!isSongMode && isAudioVoiceoverDialogOpen && (
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
                // Storage unavailable (e.g. private browsing)
              }
              setSelectedVoice(voice)
            }}
            onOpenChange={setIsAudioVoiceoverDialogOpen}
            onUploadAudioFile={async (file) => {
              await processFiles([file])
            }}
            open={isAudioVoiceoverDialogOpen && pendingVideoAudioFile === null}
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
              // Storage unavailable (e.g. private browsing)
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

export const MobileOmniChatBoxInput = forwardRef<OmniChatBoxRef, MobileOmniChatBoxInputProps>(
  MobileOmniChatBoxInputImpl,
)
MobileOmniChatBoxInput.displayName = 'MobileOmniChatBoxInput'
