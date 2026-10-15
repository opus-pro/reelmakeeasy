'use client'
import { Button } from '@shared/ui'
import { useAtomValue } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import UipPlannerSection from '@/app/projects/[projectId]/UipPlannerSection'
import { longtakeHistoryStore } from '@/atom/longtake-history.store'
import { Cross } from '@/components/icons/core'
import { ShareAccessDeniedModal } from '@/components/ShareAccessDeniedModal'
import { PlannerDialogButtonProps } from '@/components/story-mode-user-intent-planner/planner/PlannerDialogButton'
import { useUipFastConfirmActive } from '@/hooks/useUipFastConfirmActive'
import { useIsMobile } from '@/util/browserUtils'

import { useLongTakeViewerData } from '../hook/useLongTakeViewerData'

import { shouldPollProjectInfoAfterFastConfirm } from './LongTakeViewer/confirm-refresh.util'
import { DetailPanel } from './LongTakeViewer/DetailPanel'
import FinalVideoView from './LongTakeViewer/FinalVideoView'
import { useLeaveGuard } from './LongTakeViewer/hooks/useLeaveGuard'
import LeaveWarningDialog from './LongTakeViewer/LeaveWarningDialog'
import { ProjectNavOverlay } from './LongTakeViewer/ProjectNavOverlay'
import type { SiblingProject } from './LongTakeViewer/sibling-types'
import { StoryEditorStage } from './LongTakeViewer/StoryEditorStage'
import { StorySequencer } from './LongTakeViewer/StorySequencer'
import { getLipSyncPreviewTransitions } from './LongTakeViewer/StorySequencer/engine'
import {
  shouldClearPlannerDismissal,
  shouldShowUipPlanner,
} from './LongTakeViewer/uip-planner-gate.util'
import {
  useLipSyncPreviewControls,
  useProjectLipSyncVideoSelection,
} from './LongTakeViewer/use-lip-sync-preview-selection'
import { useBadgeVideoModel } from './LongTakeViewer/useBadgeVideoModel'
import { VIEWER_SHELL_HEIGHT } from './LongTakeViewer/viewer-shell'
import StorySequencerV2 from './editor'

export interface LongTakeViewerProps {
  /** Arrived from the /projects/[projectId] canvas via its video-ready gate. */
  enteredFromCanvas?: boolean
  hasNext?: boolean
  hasPrev?: boolean
  onClose: () => void
  onCloseUipView?: () => void
  onNext?: () => void
  onPrev?: () => void
  onSelectSibling?: (projectId: string) => void
  onViewChatHistory?: () => void
  projectId: string
  shareMode?: boolean
  siblings?: SiblingProject[]
  viewUip?: boolean
}

export function LongTakeViewer({
  projectId,
  onClose,
  onCloseUipView,
  onNext,
  onPrev,
  onSelectSibling,
  onViewChatHistory,
  shareMode = false,
  hasNext = false,
  hasPrev = false,
  siblings,
  enteredFromCanvas = false,
  viewUip = false,
}: LongTakeViewerProps) {
  const data = useLongTakeViewerData(projectId)
  const isMobile = useIsMobile()
  const enteredTrackedRef = useRef(false)
  const lipSyncShownTrackedProjectRef = useRef<null | string>(null)
  const isUip = data.previewProject?.isUip
  const { data: isConfirmFast, refetch: refetchConfirmFast } = useUipFastConfirmActive(projectId)

  // Latch closing the video-ready gate ("Edit or Download") so the planner drops
  // synchronously: previewProject.stage lags non-terminal in cache, so without
  // this the planner lingers until a refetch (the "only after reload" bug).
  // It clears on project switch and per shouldClearPlannerDismissal.
  // enteredFromCanvas seeds it for the /projects/[projectId] handoff, which
  // navigates here from a gate the user already acted on.
  const [plannerDismissed, setPlannerDismissed] = useState(enteredFromCanvas)
  const dismissStage = data.previewProject?.stage
  useEffect(() => {
    if (shouldClearPlannerDismissal(dismissStage)) {
      setPlannerDismissed(false)
    }
  }, [dismissStage])
  // Guarded against the mount run: unguarded, this effect fires on the first
  // render and clobbers the enteredFromCanvas seed. It must only fire on an actual project switch (the sibling
  // strip replaces the id without remounting).
  const previousProjectIdRef = useRef(projectId)
  useEffect(() => {
    if (previousProjectIdRef.current === projectId) {
      return
    }
    previousProjectIdRef.current = projectId
    setPlannerDismissed(false)
  }, [projectId])
  const handleDismissPlanner = useCallback(() => {
    setPlannerDismissed(true)
    onCloseUipView?.()
  }, [onCloseUipView])
  // The video badge is the only detail-panel field with no artifacts/template
  // fallback, so it alone would flash "Seedance 1.5" while the projectInfo poll
  // catches up after fast-confirm; the hook fills that gap with the UipSession
  // value so the chosen model shows from the first render.
  const badgeVideoModel = useBadgeVideoModel({
    isOwner: data.isOwner,
    isUip,
    project: data.previewProject,
    projectId,
    shareMode,
  })
  const {
    hasProjectLipSyncVariants,
    projectLipSyncEnabled,
    selectedVideoUrl,
    selectedWatermarkVideoUrl,
    setProjectLipSyncEnabled,
  } = useProjectLipSyncVideoSelection(projectId, data)

  // Fallback: if confirm_fast was rejected after UipPlannerSection unmounted (SSE died),
  // re-check once after a delay so we don't leave the user stuck on a processing view.
  useEffect(() => {
    if (!isConfirmFast) {
      return
    }
    const timer = setTimeout(() => void refetchConfirmFast(), 10_000)
    return () => clearTimeout(timer)
  }, [isConfirmFast, refetchConfirmFast])

  // Fast-confirm renders the processing view and unmounts UipPlannerSection before
  // its completed->refetchProjectInfo fires, so projectInfo (style / video model /
  // script) is stuck at its pre-confirm defaults. Poll until the confirm write
  // lands and stage advances, then stop.
  const previewStage = data.previewProject?.stage
  const { refetchProjectInfo } = data
  useEffect(() => {
    if (
      !shouldPollProjectInfoAfterFastConfirm({
        isConfirmFast: Boolean(isConfirmFast),
        stage: previewStage,
      })
    ) {
      return
    }
    refetchProjectInfo()
    const timer = setInterval(() => refetchProjectInfo(), 2_000)
    return () => clearInterval(timer)
  }, [isConfirmFast, previewStage, refetchProjectInfo])

  const isEditorView = useMemo(
    () =>
      shouldUseEditorView({
        isMobile,
        isOwner: data.isOwner,
        shareMode,
        videoUrl: data.videoUrl,
      }),
    [shareMode, isMobile, data.isOwner, data.videoUrl],
  )

  const showChatHistory = Boolean(isUip && data.isOwner && !shareMode && onViewChatHistory)

  const captionAvailable = captionsAvailable(data)
  const showCaptionSwitch = useMemo(
    () =>
      shouldShowCaptionSwitch({
        captionAvailable,
        isOwner: data.isOwner,
        shareMode,
      }),
    [captionAvailable, data.isOwner, shareMode],
  )

  const editorStateProjectId = useAtomValue(longtakeHistoryStore.projectIdAtom)
  const editorState = useAtomValue(longtakeHistoryStore.currentStateAtom)
  const lipSyncPreviewTransitions = useMemo(
    () =>
      editorStateProjectId === projectId
        ? getLipSyncPreviewTransitions(editorState?.transitions ?? [])
        : [],
    [editorState?.transitions, editorStateProjectId, projectId],
  )
  const showLipSyncSwitch = shouldShowLipSyncSwitch({
    hasProjectLipSyncVariants,
    isEditorView,
    lipSyncPreviewTransitionCount: lipSyncPreviewTransitions.length,
  })
  const {
    handleAllLipSyncPreviewChange,
    handleLipSyncPreviewChange,
    lipSyncPreviewEnabled,
    lipSyncPreviewOverrides,
    lipSyncPreviewSnapshot,
  } = useLipSyncPreviewControls({
    hasProjectLipSyncVariants,
    lipSyncPreviewTransitions,
    projectId,
    projectLipSyncEnabled,
    setProjectLipSyncEnabled,
  })

  const { attemptLeave, handleCancelLeave, handleConfirmLeave, isDialogOpen } =
    useLeaveGuard(isEditorView)

  useEffect(() => {
    if (isEditorView && !enteredTrackedRef.current) {
      enteredTrackedRef.current = true
    }
  }, [isEditorView])

  useEffect(() => {
    if (!showLipSyncSwitch || lipSyncShownTrackedProjectRef.current === projectId) {
      return
    }

    lipSyncShownTrackedProjectRef.current = projectId
  }, [
    data.lipSyncVideoVariants?.appliedCount,
    hasProjectLipSyncVariants,
    lipSyncPreviewSnapshot,
    lipSyncPreviewTransitions.length,
    projectId,
    showLipSyncSwitch,
  ])

  if (!projectId || data.isLoading) {
    return <LoadingPage />
  }

  if (data.isAccessDenied) {
    return <ShareAccessDeniedModal onClose={onClose} />
  }

  if (
    shouldShowUipPlanner({
      isConfirmFast: Boolean(isConfirmFast),
      isUip: Boolean(isUip),
      plannerDismissed,
      rerunFrom: data.previewProject.rerunFrom,
      stage: data.previewProject.stage,
      viewUip,
    })
  ) {
    return (
      <UipPlannerSection
        headerButton={isMobile ? undefined : getHeaderButtons(viewUip)}
        isVideoReady={Boolean(data.videoUrl)}
        onClose={viewUip ? onCloseUipView : onClose}
        onVideoThumbnailClick={handleDismissPlanner}
        outputVideoUrl={selectedVideoUrl || undefined}
        projectId={projectId}
        thumbnailUrl={data.resultVideoThumbnail}
      />
    )
  }

  const navigationOverlay = renderNavigationOverlay({
    attemptLeave,
    hasNext,
    hasPrev,
    isMobile,
    onNext,
    onPrev,
  })
  const siblingStripVisible = shouldShowSiblingStrip({
    isMobile,
    onSelectSibling,
    shareMode,
    siblings,
  })

  // Non-editor fallback view: share mode, mobile, non-owner, or video not yet generated.
  if (!isEditorView) {
    return (
      <div
        className="relative w-full overflow-hidden bg-background"
        style={{ height: VIEWER_SHELL_HEIGHT }}
      >
        {navigationOverlay}
        <FinalVideoView
          assets={data.assets}
          captionAvailable={captionAvailable}
          concurrentStages={data.concurrentStages}
          initPrompt={data.initPrompt}
          isMobile={isMobile}
          isOwner={data.isOwner}
          isUip={isUip}
          lipSyncDownloadEnabled={hasProjectLipSyncVariants ? projectLipSyncEnabled : undefined}
          lipSyncEnabled={projectLipSyncEnabled}
          onClose={onClose}
          onLipSyncSwitch={setProjectLipSyncEnabled}
          onSelectSibling={onSelectSibling}
          onViewChatHistory={onViewChatHistory}
          poster={data.resultVideoThumbnail}
          project={data.previewProject}
          projectId={projectId}
          ratio={data.ratio}
          script={data.script}
          shareMode={shareMode}
          shouldShowProcessingPreview={!data.videoUrl}
          showCaptionSwitch={showCaptionSwitch}
          showChatHistory={showChatHistory}
          showLipSyncSwitch={Boolean(!shareMode && data.isOwner && hasProjectLipSyncVariants)}
          siblings={siblings}
          sourceBgmEnabled={data.bgmEnabled}
          sourceVoice={data.sourceVoice}
          stage={data.stage}
          stageDetail={data.stageDetail}
          stageStatus={data.stageStatus}
          styleName={data.styleName}
          styleText={data.styleText}
          styleThumbnailUrl={data.styleThumbnailUrl}
          templateAudioUrl={data.templateAudioUrl}
          videoAspectRatio={data.previewAspectRatio}
          videoModel={badgeVideoModel}
          videoUrl={selectedVideoUrl}
          watermarkVideoUrl={selectedWatermarkVideoUrl}
        />
      </div>
    )
  }

  const enableCanvas = Boolean(data.audioPreviewUrl && !isMobile)

  const editorCenter = enableCanvas ? (
    <StorySequencerV2
      bgmGainDb={data.bgmBedGainDb}
      bgmUrl={data.bgmBedCdnUrl}
      bgmVolume={data.bgmVolume}
      lipSyncPreviewOverrides={lipSyncPreviewOverrides}
      loop={data.loopPreview}
      musicEnabled={data.bgmEnabled ?? false}
      onLipSyncPreviewChange={handleLipSyncPreviewChange}
      projectId={projectId}
      videoAspectRatio={data.previewAspectRatio}
      voiceOverUrl={data.audioPreviewUrl}
    />
  ) : (
    <StorySequencer
      lipSyncPreviewOverrides={lipSyncPreviewOverrides}
      onLipSyncPreviewChange={handleLipSyncPreviewChange}
      projectId={projectId}
      uploadedAudioUrl={data.uploadedAudioUrl ?? data.templateAudioUrl ?? null}
      videoAspectRatio={data.previewAspectRatio}
    />
  )

  const editorPanel = (
    <DetailPanel
      assets={data.assets}
      bgmBedCdnUrl={data.bgmBedCdnUrl}
      bgmEnabled={data.bgmEnabled}
      bgmSource={data.bgmSource}
      bgmTrackId={data.bgmTrackId}
      bgmTrackName={data.bgmTrackName}
      bgmVolume={data.bgmVolume}
      initPrompt={data.initPrompt}
      isOwner={data.isOwner}
      lipSyncDownloadEnabled={hasProjectLipSyncVariants ? projectLipSyncEnabled : undefined}
      lipSyncEnabled={hasProjectLipSyncVariants ? projectLipSyncEnabled : lipSyncPreviewEnabled}
      lipSyncPreviewOverrides={lipSyncPreviewOverrides}
      onLipSyncSwitch={handleAllLipSyncPreviewChange}
      onViewChatHistory={onViewChatHistory}
      project={data.previewProject}
      projectId={projectId}
      ratio={data.ratio}
      script={data.script}
      shareMode={shareMode}
      showCaptionSwitch={showCaptionSwitch}
      showChatHistory={showChatHistory}
      showLipSyncSwitch={showLipSyncSwitch}
      sourceBgmEnabled={data.bgmEnabled}
      sourceVoice={data.sourceVoice}
      stage={data.stage}
      styleName={data.styleName}
      styleText={data.styleText}
      styleThumbnailUrl={data.styleThumbnailUrl}
      templateAudioUrl={data.templateAudioUrl}
      videoModel={badgeVideoModel}
      videoUrl={selectedVideoUrl}
      watermarkVideoUrl={selectedWatermarkVideoUrl}
    />
  )

  return (
    <div
      className="relative flex w-full overflow-hidden bg-background"
      style={{ height: VIEWER_SHELL_HEIGHT }}
    >
      {navigationOverlay}
      <Button
        aria-label="Close"
        className="absolute left-6 top-6 z-50 rounded-full"
        onClick={() => attemptLeave(onClose)}
        size="icon"
      >
        <Cross className="size-3.5" />
      </Button>
      <StoryEditorStage
        editorCenter={editorCenter}
        editorPanel={editorPanel}
        onSelectSibling={onSelectSibling}
        projectId={projectId}
        siblings={siblings}
        siblingStripVisible={siblingStripVisible}
      />
      <LeaveWarningDialog
        onCancel={handleCancelLeave}
        onConfirm={handleConfirmLeave}
        open={isDialogOpen}
      />
    </div>
  )
}

function getHeaderButtons(viewUip?: boolean) {
  return {
    icon: 'back',
    label: viewUip ? 'Preview video' : 'Projects',
    variant: 'label',
  } satisfies PlannerDialogButtonProps
}

function LoadingPage() {
  return (
    <div
      className="relative flex w-full items-center justify-center overflow-hidden bg-background"
      role="status"
      style={{ height: VIEWER_SHELL_HEIGHT }}
    >
      <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      <span className="sr-only">Loading</span>
    </div>
  )
}

function renderNavigationOverlay(params: {
  attemptLeave: ReturnType<typeof useLeaveGuard>['attemptLeave']
  hasNext: boolean
  hasPrev: boolean
  isMobile: boolean
  onNext?: () => void
  onPrev?: () => void
}) {
  const { attemptLeave, hasNext, hasPrev, isMobile, onNext, onPrev } = params
  if (isMobile || (!hasPrev && !hasNext)) {
    return null
  }
  return (
    <ProjectNavOverlay
      attemptLeave={attemptLeave}
      hasNext={hasNext}
      hasPrev={hasPrev}
      onNext={onNext}
      onPrev={onPrev}
    />
  )
}

// Availability (can this project carry captions at all -- a video, an audio track
// to caption, and a script to caption it from) is deliberately separate from
// permission (may this viewer change them): the read-only status strip needs the
// former even on a share page, while the menu toggle needs both.
const captionsAvailable = (params: {
  audioPreviewUrl?: null | string
  script?: string
  videoUrl?: string
}) => Boolean(params.videoUrl && params.audioPreviewUrl && params.script)

function shouldShowCaptionSwitch(params: {
  captionAvailable: boolean
  isOwner: boolean
  shareMode: boolean
}) {
  const { captionAvailable, isOwner, shareMode } = params
  return Boolean(!shareMode && isOwner && captionAvailable)
}

function shouldShowLipSyncSwitch(params: {
  hasProjectLipSyncVariants: boolean
  isEditorView: boolean
  lipSyncPreviewTransitionCount: number
}) {
  const { hasProjectLipSyncVariants, isEditorView, lipSyncPreviewTransitionCount } = params
  return Boolean(isEditorView && (lipSyncPreviewTransitionCount > 0 || hasProjectLipSyncVariants))
}

function shouldShowSiblingStrip(params: {
  isMobile: boolean
  onSelectSibling?: (projectId: string) => void
  shareMode: boolean
  siblings?: SiblingProject[]
}) {
  const { isMobile, onSelectSibling, shareMode, siblings } = params
  return Boolean(!isMobile && !shareMode && siblings && siblings.length > 1 && onSelectSibling)
}

function shouldUseEditorView(params: {
  isMobile: boolean
  isOwner: boolean
  shareMode: boolean
  videoUrl: string
}) {
  const { isMobile, isOwner, shareMode, videoUrl } = params
  return !shareMode && Boolean(videoUrl) && !isMobile && isOwner
}
