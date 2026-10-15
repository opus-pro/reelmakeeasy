import type { MusicRequest } from '@reelmakeeasy/common/long-take/music-craft'
import type { LongTakeStatusStage } from '@shared/types/api/long-take'
import type { Project, ProjectVoiceOverJson } from '@shared/types/api/project'
import type { QuickStartTemplateAsset } from '@shared/types/assets/quick-start'
import { isSettledProjectStage } from '@shared/types/enums/project'
import { Button, cn, Separator, Switch, toast } from '@shared/ui'
import { useAtomValue, useSetAtom } from 'jotai'
import { type ReactNode, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

import { StoryModeInputTranscriptPanels } from '@/app/story-mode/components/StoryModeInputTranscriptPanels'
import {
  musicRequestFromProject,
  useLiveMusicVolume,
  useMusicToggle,
} from '@/app/story-mode/hook/useMusicToggle'
import { deleteProjectDialogAtom } from '@/atom/delete-project-dialog'
import { renderSettingsAtom, setCaptionChoiceAtom } from '@/atom/longtake-history.store'
import { Spinner } from '@/components/agent/Spinner'
import { CaptionStyleButton } from '@/components/captions/CaptionStyleButton'
import { useCaptionStyleRenderSync } from '@/components/captions/useCaptionSettings'
import { DeleteProjectDialog } from '@/components/delete-project-dialog/DeleteProjectDialog'
import { Caption, Export, Microphone, Music } from '@/components/icons/core'
import { MobileShareOverlay } from '@/components/MobileShareOverlay'
import { MusicChangeButton } from '@/components/music/MusicChangeButton'
import { MusicVolumeSlider } from '@/components/music/MusicVolumeSlider'
import { ProgressiveBlurWithGradient } from '@/components/ProgressiveBlurWithGradient'
import { ProjectSharePanel } from '@/components/ProjectSharePanel'
import { useProjectShareControls } from '@/hooks/useProjectShareControls'
import type { StoryModeShareActionSource } from '@/hooks/useStoryModeShareActions'
import { useStoryModeShareActions } from '@/hooks/useStoryModeShareActions'
import { useVideoScript } from '@/hooks/useVideoScript'
import { sentenceCaseLabel } from '@/util/sentence-case-label'

import { STORY_MODE_ICON_BUTTON_CLASS } from '../../constants'

import { useReadVideoScriptOnDelivery } from './hooks/useReadVideoScriptOnDelivery'
import { ActionButtons } from './ActionButtons'
import { MobileDetailMenu } from './MobileDetailMenu'
import { canUseOwnerSharePanel } from './owner-share-panel'
import { isStageCompleted } from './progress'
import { StyleSummaryCard } from './StyleSummaryCard'
import { TopActionRow } from './TopActionRow'
import { useResolvedProjectStyle } from './use-resolved-project-style'

interface DetailPanelProps {
  assets?: QuickStartTemplateAsset[]
  /** The music bed's URL when the project has one (a switch-on then needs no new bed). */
  bgmBedCdnUrl?: null | string
  bgmEnabled?: boolean | null
  /** Where the bed came from and which track, for the music menu's mark. */
  bgmSource?: null | string
  bgmTrackId?: null | string
  /** The bed's name, shown under the Background music row. */
  bgmTrackName?: null | string
  /** The saved music level (0-100), for the volume slider. */
  bgmVolume?: null | number
  initPrompt?: string
  // Explicit input-type label for the info pill (e.g. template.inputType like
  // "transcript"). When omitted, falls back to the derived audio/asset/text
  // classification used for tracking.
  inputTypeLabel?: string
  isMobile?: boolean
  isOwner: boolean
  lipSyncDownloadEnabled?: boolean
  lipSyncEnabled?: boolean
  lipSyncPreviewOverrides?: Record<string, boolean>
  mobileActionsPortalElement?: HTMLElement | null
  // Slot in the mobile top bar that the more-menu + Share cluster portals into.
  mobileTopBarPortalElement?: HTMLElement | null
  onLipSyncSwitch?: (next: boolean) => void
  onPreviewAssetChange?: (asset: null | QuickStartTemplateAsset) => void
  onViewChatHistory?: () => void
  // Full project record, for the mobile more-menu Delete action.
  project?: Project
  projectId: string
  ratio?: string
  script?: string
  shareMode?: boolean
  showCaptionSwitch?: boolean
  showChatHistory?: boolean
  showLipSyncSwitch?: boolean
  // Render share-style input/transcript section tabs (StoryModeInputTranscriptPanels)
  // in place of the bare transcript block. Used on share/demo viewers.
  showUserPrompt?: boolean
  // Whether the SOURCE project has BGM on (long-take status poll), carried
  // into the remix payload. Distinct from any enable_bgm flag prop.
  sourceBgmEnabled?: boolean | null
  sourceVoice?: null | ProjectVoiceOverJson
  stage?: LongTakeStatusStage
  styleName?: string
  styleText?: string
  styleThumbnailUrl?: string
  templateAudioUrl?: string
  // Origin label for Copy style / Remix tracking. Defaults to project_page or
  // share_page derived from shareMode; demo-page entry-points pass 'demo_page'.
  trackingSource?: StoryModeShareActionSource
  // Industry/category pill (demo templates only).
  useCase?: string
  // Transition video model id; null = Seedance 1.5 default, undefined = no badge.
  videoModel?: null | string
  videoUrl?: string
  watermarkVideoUrl?: null | string
}

export function DetailPanel({
  assets,
  bgmBedCdnUrl,
  bgmEnabled,
  bgmSource,
  bgmTrackId,
  bgmTrackName,
  bgmVolume,
  initPrompt,
  inputTypeLabel,
  script,
  isOwner,
  lipSyncDownloadEnabled,
  lipSyncEnabled = false,
  lipSyncPreviewOverrides,
  isMobile = false,
  mobileActionsPortalElement,
  mobileTopBarPortalElement,
  onLipSyncSwitch,
  onPreviewAssetChange,
  onViewChatHistory,
  project,
  styleName: fallbackStyleName,
  styleThumbnailUrl: fallbackThumbnailUrl,
  styleText,
  projectId,
  shareMode = false,
  showCaptionSwitch = false,
  showChatHistory = false,
  showLipSyncSwitch = false,
  showUserPrompt = false,
  sourceBgmEnabled,
  sourceVoice,
  templateAudioUrl,
  trackingSource,
  useCase,
  videoModel,
  videoUrl,
  watermarkVideoUrl,
  ratio,
  stage,
}: DetailPanelProps) {
  const { effectiveStyleText, styleName, thumbnailUrl } = useResolvedProjectStyle({
    fallbackStyleName,
    fallbackThumbnailUrl,
    isOwner,
    styleText,
  })
  const renderSettings = useAtomValue(renderSettingsAtom)
  const setCaptionChoice = useSetAtom(setCaptionChoiceAtom)
  const [userPromptSection, setUserPromptSection] = useState<'input' | 'transcript'>('input')
  // Controlled so tapping the owner Share icon can dismiss the more-menu popover.
  const [menuOpen, setMenuOpen] = useState(false)

  const captionEnabled = renderSettings.captionEnabled.latest
  const handleCaptionSwitch = (next: boolean) => {
    setCaptionChoice({ next, projectId })
  }
  const handleMobileCaptionHint = () => {
    toast.custom(
      () => (
        <div className="rounded-sm bg-menu-background p-2.5 text-sm text-primary shadow-lg backdrop-blur-2xl">
          Open this project on desktop to toggle captions.
        </div>
      ),
      { duration: 2000 },
    )
  }

  // Progress calculation
  const isCompleted = isStageCompleted(stage)
  // Drop the legacy `!shareMode` gate: action visibility is owned by the
  // useStoryModeShareActions capability flags below, so the action row renders
  // on share/demo too (Copy style / Remix / Share appear when allowed).
  // Demo page template projects (demo videos) are guaranteed to have
  // completed + fully processed videos; can immediately display
  // Remix/Copy/Share without needing a fetch to check for video existence.
  const isDemoPage = trackingSource === 'demo_page'
  // Share links only exist for completed projects, so `shareMode` implies the
  // video is ready even when the public share API doesn't surface `stage`.
  const showTopActionRow = isCompleted || isDemoPage || shareMode

  const inputType = useMemo(() => {
    const hasAudio = Boolean(templateAudioUrl)
    const hasVisualAssets = assets?.some(
      (a) => a.mimeType.startsWith('image/') || a.mimeType.startsWith('video/'),
    )
    if (hasAudio) {
      return 'Audio to video'
    }
    if (hasVisualAssets) {
      return 'Asset to video'
    }
    return 'Text to video'
  }, [assets, templateAudioUrl])

  const infoPills = useMemo(() => {
    // inputTypeLabel is demo data, cased by hand; the derived inputType above
    // is already sentence case.
    const inputPill = inputTypeLabel ? sentenceCaseLabel(inputTypeLabel) : inputType
    return [useCase, inputPill, ratio].filter((value): value is string => Boolean(value))
  }, [useCase, inputTypeLabel, inputType, ratio])

  const { canCopyStyle, canRemix, handleCopyStyle, handleRemix, handleShare } =
    useStoryModeShareActions({
      assets,
      bgmEnabled: sourceBgmEnabled,
      initPrompt,
      inputType,
      isOwner,
      isSharePage: shareMode,
      projectId,
      ratio,
      resolvedStyleName: styleName,
      resolvedStyleThumbnailUrl: thumbnailUrl,
      script,
      source: trackingSource,
      sourceVoice,
      styleName: fallbackStyleName,
      styleText: effectiveStyleText,
      styleThumbnailUrl: fallbackThumbnailUrl,
      templateAudioUrl,
    })

  const showActionsCard = isOwner && !shareMode
  // Download renders again when the caption look on screen differs from the delivered one.
  useCaptionStyleRenderSync(showActionsCard ? projectId : '', ratio)
  // "Style" under the Caption switch opens the caption look's controls in a popover, as in
  // the agent chat (desktop only: the mobile menu keeps its "open on desktop" hint). With
  // captions off it keeps a loop's highlight, which still colours the fact stamps, and shows
  // nothing for any other video. The preview is the editor engine, so each change shows at
  // once; it draws a loop's stamps once a render saved them, until then the note says where
  // they are.
  const showCaptionStyle = !isMobile && showCaptionSwitch
  const loopNote = useLoopStampsNote(showCaptionStyle ? projectId : '')
  // The card shows while a video generates, when there is no video script to read yet: read
  // it again once the video is delivered, so a new loop's preview draws its stamps.
  useReadVideoScriptOnDelivery(projectId, deliveredOf(stage, videoUrl))
  const captionStyleButton = showCaptionStyle && (
    <CaptionStyleButton
      aspectRatio={ratio}
      captionsOn={captionEnabled}
      // Like "Change" under Background music: a small link under the switch's label.
      className="ml-7.5 text-xs"
      disabled={!isCompleted}
      livePreview
      loopNote={loopNote}
      projectId={projectId}
    />
  )
  // The owner's "Background music" switch: a remux of the delivered file, no render needed.
  const music = useMusicToggle(projectId, {
    bgmEnabled,
    bgmVolume,
    delivered: Boolean(videoUrl),
    hasBed: Boolean(bgmBedCdnUrl),
  })
  const showMusicSwitch = showActionsCard && Boolean(videoUrl)
  // The level the previews play: what the slider is on, ahead of the saved one.
  const liveMusicVolume = useLiveMusicVolume(projectId, bgmVolume)
  // Mobile owner surface: the pinned Download/Publish bar.
  const hasMobileOwnerActions = isMobile && showActionsCard

  const setDeleteDialog = useSetAtom(deleteProjectDialogAtom)
  const canDelete = isMobile && isOwner && !shareMode && Boolean(project)
  const deleteBlockedByGeneration = isDeleteBlockedByGeneration(stage, project?.stage)
  const handleDeleteClick = () => {
    if (project) {
      setDeleteDialog({ open: true, project })
    }
  }

  // Desktop-only action row (Copy style / Remix / Share). On mobile these move
  // into the top-bar more-menu and Share icon (see mobileTopBar below). The
  // overflow menu is owner-project-page only: demo and share viewers get no chat
  // history, so Copy style sits inline rather than behind a one-item menu.
  const topActionRow = showTopActionRow && !isMobile && (
    <TopActionRow
      canCopyStyle={canCopyStyle}
      canRemix={canRemix}
      collapseSecondaryActions={!isDemoPage && !shareMode}
      onCopyStyle={handleCopyStyle}
      onRemix={handleRemix}
      onShare={handleShare}
      onViewChatHistory={onViewChatHistory}
      showChatHistory={showChatHistory}
    />
  )

  // Desktop renders ActionButtons inside its own rounded panel below the
  // transcript card. Mobile uses the pinned bottom bar (mobileBottomBar).
  const actionsCard = showActionsCard && !isMobile && (
    <div className="shrink-0 rounded-2xl bg-[#2a2a2a] p-6">
      <ActionButtons
        bgmEnabled={bgmEnabled}
        isMobile={false}
        isOwner={isOwner}
        lipSyncDownloadEnabled={lipSyncDownloadEnabled}
        lipSyncPreviewOverrides={lipSyncPreviewOverrides}
        projectId={projectId}
        shareMode={shareMode}
        styleName={styleName}
        styleText={effectiveStyleText}
        styleThumbnailUrl={thumbnailUrl}
        videoUrl={videoUrl}
        watermarkVideoUrl={watermarkVideoUrl}
      />
    </div>
  )

  // Mobile top bar: more-menu (Remix / Copy style / Chat history /
  // Caption / Delete) plus the Share icon. Portaled into the FinalVideoView top
  // bar.
  const mobileTopBar = isMobile && (
    <>
      <MobileDetailMenu
        canCopyStyle={canCopyStyle}
        canDelete={canDelete}
        canRemix={canRemix}
        captionEnabled={captionEnabled}
        deleteDisabled={deleteBlockedByGeneration}
        isCompleted={isCompleted}
        onCaptionHint={handleMobileCaptionHint}
        onCopyStyle={handleCopyStyle}
        onDelete={handleDeleteClick}
        onOpenChange={setMenuOpen}
        onRemix={handleRemix}
        onViewChatHistory={onViewChatHistory}
        open={menuOpen}
        // Portal the menu into the top bar (inside the demo's modal Dialog) so it
        // escapes the dialog's z-index/pointer-events lock.
        portalContainer={mobileTopBarPortalElement}
        showCaption={showCaptionSwitch}
        showChatHistory={showChatHistory}
      />
      {showTopActionRow && (
        <MobileShareIconButton
          isOwner={isOwner}
          onBeforeOpen={() => setMenuOpen(false)}
          onVisitorShare={handleShare}
          projectId={projectId}
          source={trackingSource ?? (shareMode ? 'share_page' : 'project_page')}
        />
      )}
      {canDelete && <DeleteProjectDialog />}
    </>
  )

  // Mobile bottom bar: Publish + Download pills over a gradient fade so the
  // scroll content reads under it. Owner-only (matches showActionsCard).
  const mobileBottomBar = hasMobileOwnerActions && (
    <div className="relative w-full px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))]">
      <ProgressiveBlurWithGradient />
      <div className="relative flex w-full items-center">
        <ActionButtons
          bgmEnabled={bgmEnabled}
          isMobile
          isOwner={isOwner}
          lipSyncDownloadEnabled={lipSyncDownloadEnabled}
          lipSyncPreviewOverrides={lipSyncPreviewOverrides}
          projectId={projectId}
          shareMode={shareMode}
          styleName={styleName}
          styleText={effectiveStyleText}
          styleThumbnailUrl={thumbnailUrl}
          videoUrl={videoUrl}
          watermarkVideoUrl={watermarkVideoUrl}
        />
      </div>
    </div>
  )

  const styleCard = (
    <StyleSummaryCard
      infoPills={infoPills}
      isMobile={isMobile}
      styleName={styleName}
      thumbnailUrl={thumbnailUrl}
      videoModel={videoModel}
    />
  )

  return (
    <aside className={cn('flex size-full flex-col gap-2', isMobile && 'h-auto w-full')}>
      {isMobile ? (
        <>
          <div className="flex flex-col gap-2 px-4">
            {styleCard}
            <DetailTranscriptSection
              activeSection={userPromptSection}
              assets={assets}
              captionEnabled={captionEnabled}
              initPrompt={initPrompt}
              isCompleted={isCompleted}
              isMobile={isMobile}
              lipSyncEnabled={lipSyncEnabled}
              musicBusy={music.busy}
              musicBusyLabel={music.busyLabel}
              musicCurrent={musicRequestFromProject({
                bgmEnabled: music.musicOn,
                bgmSource,
                bgmTrackId,
              })}
              musicEnabled={music.musicOn}
              musicTrackName={bgmTrackName}
              musicVolume={liveMusicVolume}
              musicVolumeLocked={music.volumeLocked}
              onActiveSectionChange={setUserPromptSection}
              onCaptionSwitch={handleCaptionSwitch}
              onLipSyncSwitch={onLipSyncSwitch}
              onMusicPick={(request) => void music.applyRequest(request)}
              onMusicSwitch={(next) => void music.setMusicOn(next)}
              onMusicVolumeChange={music.previewVolume}
              onMusicVolumeCommit={(volume) => void music.setVolume(volume)}
              onPreviewAssetChange={onPreviewAssetChange}
              script={script}
              showCaptionSwitch={showCaptionSwitch}
              showLipSyncSwitch={showLipSyncSwitch}
              showMusicSwitch={showMusicSwitch}
              showUserPrompt={showUserPrompt}
              templateAudioUrl={templateAudioUrl}
            />
          </div>
          {mobileTopBarPortalElement ? createPortal(mobileTopBar, mobileTopBarPortalElement) : null}
          {mobileActionsPortalElement
            ? createPortal(mobileBottomBar, mobileActionsPortalElement)
            : null}
        </>
      ) : (
        <>
          {topActionRow}
          {styleCard}
          <DetailTranscriptSection
            activeSection={userPromptSection}
            assets={assets}
            captionEnabled={captionEnabled}
            captionStyleButton={captionStyleButton}
            initPrompt={initPrompt}
            isCompleted={isCompleted}
            isMobile={isMobile}
            lipSyncEnabled={lipSyncEnabled}
            musicBusy={music.busy}
            musicBusyLabel={music.busyLabel}
            musicCurrent={musicRequestFromProject({
              bgmEnabled: music.musicOn,
              bgmSource,
              bgmTrackId,
            })}
            musicEnabled={music.musicOn}
            musicTrackName={bgmTrackName}
            musicVolume={liveMusicVolume}
            musicVolumeLocked={music.volumeLocked}
            onActiveSectionChange={setUserPromptSection}
            onCaptionSwitch={handleCaptionSwitch}
            onLipSyncSwitch={onLipSyncSwitch}
            onMusicPick={(request) => void music.applyRequest(request)}
            onMusicSwitch={(next) => void music.setMusicOn(next)}
            onMusicVolumeChange={music.previewVolume}
            onMusicVolumeCommit={(volume) => void music.setVolume(volume)}
            onPreviewAssetChange={onPreviewAssetChange}
            script={script}
            showCaptionSwitch={showCaptionSwitch}
            showLipSyncSwitch={showLipSyncSwitch}
            showMusicSwitch={showMusicSwitch}
            showUserPrompt={showUserPrompt}
            templateAudioUrl={templateAudioUrl}
          />
          {actionsCard}
        </>
      )}
    </aside>
  )
}

function DetailTranscriptSection({
  activeSection,
  assets,
  captionEnabled,
  captionStyleButton,
  initPrompt,
  isCompleted,
  isMobile,
  lipSyncEnabled,
  onActiveSectionChange,
  onCaptionSwitch,
  musicBusy = false,
  musicBusyLabel,
  musicCurrent,
  musicEnabled = false,
  musicTrackName,
  musicVolume,
  musicVolumeLocked = false,
  onLipSyncSwitch,
  onMusicPick,
  onMusicSwitch,
  onMusicVolumeChange,
  onMusicVolumeCommit,
  onPreviewAssetChange,
  script,
  showCaptionSwitch,
  showLipSyncSwitch,
  showMusicSwitch = false,
  showUserPrompt,
  templateAudioUrl,
}: {
  activeSection: 'input' | 'transcript'
  assets?: QuickStartTemplateAsset[]
  captionEnabled: boolean
  /** "Style" under the Caption switch: the caption look's controls, in a popover. */
  captionStyleButton?: ReactNode
  initPrompt?: string
  isCompleted: boolean
  isMobile: boolean
  lipSyncEnabled: boolean
  musicBusy?: boolean
  /** What a running music change is doing, shown beside a spinner (e.g. "Generating music"). */
  musicBusyLabel?: null | string
  /** The project's current music pick, marked in the Change menu. */
  musicCurrent?: MusicRequest
  musicEnabled?: boolean
  musicTrackName?: null | string
  /** The music level the slider shows (the live one while it moves). */
  musicVolume?: number
  /** Another kind of music change runs: the volume waits for it. */
  musicVolumeLocked?: boolean
  onActiveSectionChange: (next: 'input' | 'transcript') => void
  onCaptionSwitch: (next: boolean) => void
  onLipSyncSwitch?: (next: boolean) => void
  onMusicPick?: (request: MusicRequest) => void
  onMusicSwitch?: (next: boolean) => void
  onMusicVolumeChange?: (volume: number) => void
  onMusicVolumeCommit?: (volume: number) => void
  onPreviewAssetChange?: (asset: null | QuickStartTemplateAsset) => void
  script?: string
  showCaptionSwitch: boolean
  showLipSyncSwitch: boolean
  showMusicSwitch?: boolean
  showUserPrompt: boolean
  templateAudioUrl?: string
}) {
  if (showUserPrompt) {
    return (
      <TranscriptOrUserPromptSection
        activeSection={activeSection}
        assets={assets}
        initPrompt={initPrompt}
        isCompleted={isCompleted}
        isMobile={isMobile}
        onActiveSectionChange={onActiveSectionChange}
        onPreviewAssetChange={onPreviewAssetChange}
        script={script}
        showUserPrompt={showUserPrompt}
        templateAudioUrl={templateAudioUrl}
      />
    )
  }

  return (
    <div
      className={cn(
        'flex flex-col rounded-2xl bg-[#2a2a2a]',
        isMobile && 'overflow-hidden p-4',
        // The switches and the caption look under the transcript can be taller than the
        // window leaves: the card scrolls to them.
        !isMobile && 'flex-1 min-h-0 overflow-y-auto',
      )}
    >
      {/* The transcript gives the switches room, but keeps a few lines. */}
      <div className={cn('flex flex-col', !isMobile && 'flex-1 min-h-32')}>
        <TranscriptOrUserPromptSection
          activeSection={activeSection}
          assets={assets}
          initPrompt={initPrompt}
          isCompleted={isCompleted}
          isMobile={isMobile}
          onActiveSectionChange={onActiveSectionChange}
          onPreviewAssetChange={onPreviewAssetChange}
          script={script}
          showCaptionFooter={
            !isMobile && (showCaptionSwitch || showLipSyncSwitch || showMusicSwitch)
          }
          showUserPrompt={showUserPrompt}
          templateAudioUrl={templateAudioUrl}
        />
      </div>

      {!isMobile && (showCaptionSwitch || showLipSyncSwitch || showMusicSwitch) && (
        <div className="mt-4 flex shrink-0 flex-col gap-4 px-6 pb-6">
          <Separator className="bg-fill-secondary" />
          {showCaptionSwitch && (
            <div className="flex flex-col gap-0.5">
              <PanelSwitchRow
                checked={captionEnabled}
                disabled={!isCompleted}
                icon={<Caption className="size-6 shrink-0 text-primary" />}
                label="Caption"
                onCheckedChange={onCaptionSwitch}
              />
              {captionStyleButton}
            </div>
          )}
          {showLipSyncSwitch && (
            <PanelSwitchRow
              checked={lipSyncEnabled}
              disabled={!isCompleted}
              icon={<Microphone className="size-6 shrink-0 text-primary" />}
              label="Lip sync"
              onCheckedChange={onLipSyncSwitch}
            />
          )}
          {showMusicSwitch && (
            <div className="flex flex-col gap-0.5">
              <PanelSwitchRow
                checked={musicEnabled}
                // Busy: the delivered file is being rewritten; a second press would race it.
                disabled={!isCompleted || musicBusy}
                icon={<Music className="size-6 shrink-0 text-primary" />}
                label="Background music"
                onCheckedChange={onMusicSwitch}
              />
              {musicBusy && musicBusyLabel ? (
                // A change is running: say what it is, not just lock the controls.
                <div
                  className="flex items-center gap-1.5 pl-7.5 text-xs text-secondary"
                  role="status"
                >
                  <Spinner className="size-3.5" />
                  <span>{musicBusyLabel}</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 pl-7.5">
                  {musicEnabled && musicTrackName && (
                    <span className="min-w-0 truncate text-xs text-secondary">
                      {musicTrackName}
                    </span>
                  )}
                  {onMusicPick && musicCurrent && (
                    <MusicChangeButton
                      className="text-xs"
                      current={musicCurrent}
                      disabled={!isCompleted || musicBusy}
                      onPick={onMusicPick}
                    />
                  )}
                </div>
              )}
              {musicEnabled &&
                musicVolume !== undefined &&
                onMusicVolumeChange &&
                onMusicVolumeCommit && (
                  <MusicVolumeSlider
                    className="pl-7.5"
                    // A level saving keeps the slider live (new levels queue); other changes lock it.
                    disabled={!isCompleted || musicVolumeLocked}
                    onChange={onMusicVolumeChange}
                    onCommit={onMusicVolumeCommit}
                    volume={musicVolume}
                  />
                )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MobileOwnerShareIconButton({
  onBeforeOpen,
  projectId,
}: {
  onBeforeOpen?: () => void
  projectId: string
  source: StoryModeShareActionSource
}) {
  const { copyShareLink, displayLink, isCopied, isPublic, sharedProjectId, toggleAccess } =
    useProjectShareControls(projectId)
  const [open, setOpen] = useState(false)

  const handleOpen = () => {
    // Dismiss the more-menu (if open) before presenting the centered overlay.
    onBeforeOpen?.()
    setOpen(true)
    if (isPublic && sharedProjectId) {
      void copyShareLink()
    }
  }

  return (
    <>
      <Button
        aria-label="Share"
        className={cn(STORY_MODE_ICON_BUTTON_CLASS)}
        data-dd-action="project-page-share-button"
        onClick={handleOpen}
        type="button"
        variant="ghost"
      >
        <Export className="size-4.5" />
      </Button>
      {open && (
        <MobileShareOverlay onClose={() => setOpen(false)}>
          <ProjectSharePanel
            displayLink={displayLink}
            isCopied={isCopied}
            isPublic={isPublic}
            onClose={() => setOpen(false)}
            onCopyLink={() => {
              void copyShareLink()
            }}
            onSelectPrivate={() => {
              void toggleAccess(false)
            }}
            onSelectPublic={() => {
              void toggleAccess(true)
            }}
          />
        </MobileShareOverlay>
      )}
    </>
  )
}

function MobileShareIconButton({
  isOwner,
  onBeforeOpen,
  onVisitorShare,
  projectId,
  source,
}: {
  isOwner: boolean
  onBeforeOpen?: () => void
  onVisitorShare: () => Promise<void> | void
  projectId: string
  source: StoryModeShareActionSource
}) {
  if (canUseOwnerSharePanel(isOwner, source)) {
    return (
      <MobileOwnerShareIconButton
        onBeforeOpen={onBeforeOpen}
        projectId={projectId}
        source={source}
      />
    )
  }
  return (
    <Button
      aria-label="Share"
      className={cn(STORY_MODE_ICON_BUTTON_CLASS)}
      data-dd-action="project-page-share-button"
      onClick={() => void onVisitorShare()}
      variant="ghost"
    >
      <Export className="size-4.5" />
    </Button>
  )
}

function PanelSwitchRow({
  checked,
  disabled,
  icon,
  label,
  onCheckedChange,
}: {
  checked: boolean
  disabled: boolean
  icon: ReactNode
  label: string
  onCheckedChange?: (next: boolean) => void
}) {
  return (
    <div className="flex items-center gap-1.5">
      {icon}
      <span className="flex-1 px-0.5 text-sm font-medium text-primary">{label}</span>
      <Switch
        checked={checked}
        className="data-[state=unchecked]:bg-white/25"
        disabled={disabled}
        onCheckedChange={(next) => onCheckedChange?.(next)}
      />
    </div>
  )
}

function TranscriptOrUserPromptSection({
  activeSection,
  assets,
  initPrompt,
  isCompleted,
  isMobile,
  onActiveSectionChange,
  onPreviewAssetChange,
  script,
  showCaptionFooter = false,
  showUserPrompt,
  templateAudioUrl,
}: {
  activeSection: 'input' | 'transcript'
  assets?: QuickStartTemplateAsset[]
  initPrompt?: string
  isCompleted: boolean
  isMobile: boolean
  onActiveSectionChange: (next: 'input' | 'transcript') => void
  onPreviewAssetChange?: (asset: null | QuickStartTemplateAsset) => void
  script?: string
  showCaptionFooter?: boolean
  showUserPrompt: boolean
  templateAudioUrl?: string
}) {
  if (showUserPrompt) {
    return (
      <div className={cn('flex flex-col gap-2', !isMobile && 'flex-1 min-h-0')}>
        <StoryModeInputTranscriptPanels
          activeSection={activeSection}
          assets={assets}
          audioUrl={templateAudioUrl}
          initPrompt={initPrompt}
          isMobile={isMobile}
          onActiveSectionChange={onActiveSectionChange}
          onPreviewAssetChange={onPreviewAssetChange}
          script={script}
        />
      </div>
    )
  }
  return (
    <div className={cn('flex flex-col', !isMobile && 'flex-1 min-h-0')}>
      <div
        className={cn(
          'flex flex-col gap-1',
          isMobile
            ? 'overflow-visible'
            : 'flex-1 max-h-[calc(100vh-490px)] overflow-y-auto px-6 pt-6 scrollbar-hide',
          !isMobile && isCompleted && 'max-h-[calc(100vh-440px)]',
          !isMobile && !showCaptionFooter && 'pb-6',
        )}
      >
        <p className="text-xs uppercase tracking-wider text-secondary">TRANSCRIPT</p>

        {script ? (
          <p className="whitespace-pre-wrap text-sm leading-relaxed text-white/90">{script}</p>
        ) : (
          <p className="text-sm text-secondary">Transcript is not available yet.</p>
        )}
      </div>
    </div>
  )
}

/** Whether the video is delivered, or undefined while its stage is unknown (not read yet). */
function deliveredOf(stage?: LongTakeStatusStage, videoUrl?: string): boolean | undefined {
  return stage === undefined ? undefined : stage === 'completed' && Boolean(videoUrl)
}

/**
 * The caption panel's note for a loop whose preview has no fact stamps yet: the preview draws
 * them from the facts track a render saves in the video script (the preview's own read,
 * shared), and a loop not rendered since stamps became a track has none. None once it has
 * them, or while the script is read. `projectId` '' reads nothing.
 */
function useLoopStampsNote(projectId: string): string | undefined {
  const { data: videoScript, isLoading } = useVideoScript(projectId)
  if (isLoading || videoScript?.tracks.some((track) => track.type === 'facts')) {
    return undefined
  }
  return 'This preview has no fact stamps: they show in the downloaded video.'
}

/**
 * A project that is still generating cannot be deleted -- the delete
 * would tear the row out from under a run the user can no longer follow.
 *
 * `stage` is the long-take STATUS stage, which goes undefined whenever that
 * poll fails or has not landed yet -- so it cannot be the only input, or a
 * transient network blip would quietly re-open Delete mid-render. The project
 * ROW is the fallback: it is already loaded, and its stage only reads settled
 * when nothing is advancing the project. `isStageCompleted` counts error /
 * rejected as done, so failed projects stay deletable either way.
 */
export function isDeleteBlockedByGeneration(
  stage?: LongTakeStatusStage,
  projectStage?: null | string,
): boolean {
  if (stage) {
    return !isStageCompleted(stage)
  }
  return Boolean(projectStage) && !isSettledProjectStage(projectStage)
}
