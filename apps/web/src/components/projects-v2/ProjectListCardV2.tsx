'use client'
import { PROJECT_CREATED_VIA_AGENT } from '@reelmakeeasy/common/codex-agent/agent-sessions'
import { Project } from '@shared/types/api/project'
import { isStaleInProgressProject, PROJECT_STAGE } from '@shared/types/enums/project'
import { Button, cn, Popover, toast } from '@shared/ui'
import { useQueryClient } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { deleteProjectDialogAtom } from '@/atom/delete-project-dialog'
import { projectProgressFamily } from '@/atom/project'
import RiveCanvas from '@/components/animated/RiveCanvas'
import { type ContextMenuItem, ContextMenuItems } from '@/components/ContextMenu'
import { CrossCircle, Info, More as MoreIcon } from '@/components/icons/core'
import { MobileShareOverlay } from '@/components/MobileShareOverlay'
import { useProcessingCompletion } from '@/components/processing-notifications/useProcessingCompletion'
import { ProcessingPillOverlay } from '@/components/projects-v2/ProcessingPillOverlay'
import { useProcessingRunPill } from '@/components/projects-v2/project-card-processing-run'
import { computeProjectCardLabel } from '@/components/projects-v2/project-card-status'
import {
  getProjectDisplayTitle,
  type ProjectStatusMeta,
  resolveCardFooter,
} from '@/components/projects-v2/project-list-card.utils'
import { ProjectPreviewImage } from '@/components/projects-v2/ProjectPreviewImage'
import { getProjectScrollAnchorAttribute } from '@/components/projects-v2/use-scroll-restoration'
import { ProjectSharePanel } from '@/components/ProjectSharePanel'
import {
  getProjectsQueryKeyPrefix,
  markProcessingSeen,
  renameProject,
} from '@/hooks/projects-query-utils'
import { useFileUrl } from '@/hooks/use-file-url'
import { useApi } from '@/hooks/useApi'
import { useCancelUipSession } from '@/hooks/useProjects'
import { useProjectShareControls } from '@/hooks/useProjectShareControls'
import { useRemix } from '@/hooks/useRemix'
import { useVideoDownload } from '@/hooks/useVideoDownload'
import { useBreakpoint } from '@/util/browserUtils'
import { getPublicCdnUrl } from '@/util/cdn-utils'
import { hardNavigate } from '@/util/hard-navigation'

import { useRetryRecovery } from './retry/useRetryRecovery'
import { buildMenuItems } from './ProjectCardMenuItems'

export interface ProjectListCardV2Props {
  onOpenProject: () => void
  project: Project
}

const DEFAULT_BG = getPublicCdnUrl('assets/images/project-pending-bg.png')

export function ProjectListCardV2({ onOpenProject, project }: ProjectListCardV2Props) {
  const { download, isDownloading } = useVideoDownload()
  const { addImgHostname } = useFileUrl()
  const { fetchApiDomain } = useApi()
  const setDeleteDialog = useSetAtom(deleteProjectDialogAtom)
  const { cancelSession, isCancelling } = useCancelUipSession()
  const progressData = useAtomValue(projectProgressFamily(project.id))
  const { handleRemix, isPreparingRemix } = useRemix(project.id, 'my_projects')
  const {
    handleRetry,
    isPreparing: isPreparingRetry,
    retryDialog,
  } = useRetryRecovery({ onFallbackRemix: handleRemix, projectId: project.id })

  const [menuOpen, setMenuOpen] = useState(false)
  const [shareOverlayOpen, setShareOverlayOpen] = useState(false)
  const shareControlsEnabled = menuOpen || shareOverlayOpen
  const { isBelowMd } = useBreakpoint('md')
  // The background-job status pill, driven by the persisted
  // bgmRun/processingSeenAt contract the list read returns.
  const processingPill = useProcessingRunPill(project)
  // Pass `project` so the share permission check uses this card's owner, not
  // the empty global projectIdAtom on the list page.
  const { copyShareLink, displayLink, isCopied, isPublic, sharedProjectId, toggleAccess } =
    useProjectShareControls(project.id, project, { enabled: shareControlsEnabled })
  const displayTitle = getProjectDisplayTitle(project)

  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const editInputRef = useRef<HTMLInputElement>(null)
  const isSavingRef = useRef(false)
  const queryClient = useQueryClient()

  const handleRenameStart = useCallback(() => {
    setEditValue(displayTitle)
    setIsEditing(true)
  }, [displayTitle])

  useEffect(() => {
    if (isEditing && editInputRef.current) {
      editInputRef.current.focus()
      editInputRef.current.select()
    }
  }, [isEditing])

  const patchProjectCaches = useCallback(
    (patch: Record<string, unknown>) => {
      const updater = (oldData: unknown) => {
        const data = oldData as { pages?: { data?: { id: string }[] }[] }
        if (!data?.pages) {
          return oldData
        }
        return {
          ...data,
          pages: data.pages.map((page) => ({
            ...page,
            data: page.data?.map((p) => (p.id === project.id ? { ...p, ...patch } : p)),
          })),
        }
      }
      queryClient.setQueriesData<unknown>({ queryKey: getProjectsQueryKeyPrefix() }, updater)
    },
    [project.id, queryClient],
  )

  const handleRenameSave = useCallback(async () => {
    if (isSavingRef.current) {
      return
    }
    isSavingRef.current = true
    setIsEditing(false)
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === displayTitle) {
      isSavingRef.current = false
      return
    }

    const previousName = project.name
    patchProjectCaches({ name: trimmed })

    try {
      await renameProject(fetchApiDomain, project.id, trimmed)
    } catch {
      patchProjectCaches({ name: previousName })
      toast.error('Failed to rename project. Please try again.')
    } finally {
      isSavingRef.current = false
    }
  }, [editValue, displayTitle, project.id, project.name, fetchApiDomain, patchProjectCaches])

  const handleRenameKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      e.stopPropagation()
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleRenameSave()
      } else if (e.key === 'Escape') {
        e.preventDefault()
        isSavingRef.current = true
        setIsEditing(false)
        isSavingRef.current = false
      }
    },
    [handleRenameSave],
  )

  const hasResultVideo = Boolean(project.resultVideo)
  const isFailed = isFailedCard(project)
  const isCanceled = project.stage === PROJECT_STAGE.CANCELED
  const isCompletedStageByType =
    project.stage === PROJECT_STAGE.FINISHED || project.stage === PROJECT_STAGE.EDITOR
  const isFinished = !isFailed && !isCanceled && (isCompletedStageByType || hasResultVideo)
  const isTerminalStageByType = isFinished || isFailed || isCanceled
  const isLongTakeInProcess = Boolean(project.isLongTake) && !isFinished && !isFailed
  const progressPercentage = Math.round(progressData.value * 100)
  const isInProgressStage = !isTerminalStageByType && !isFailed && !isCanceled
  const isGenerating =
    !isTerminalStageByType &&
    (project.stage === PROJECT_STAGE.INITIALIZING ||
      isLongTakeInProcess ||
      isInProgressStage ||
      progressPercentage > 0)
  const shouldUseDefaultBackground = isGenerating || isFailed || isCanceled

  const statusMeta = useMemo<ProjectStatusMeta>(
    () =>
      computeProjectCardLabel({
        createdAt: project.createdAt,
        isCanceled,
        isFailed,
        isFinished,
        progress: { targetPhase: progressData.targetPhase, value: progressData.value },
        stage: project.stage,
        uip: project.uip,
      }),
    [
      isCanceled,
      isFailed,
      isFinished,
      progressData.targetPhase,
      progressData.value,
      project.createdAt,
      project.stage,
      project.uip,
    ],
  )

  const thumbnailSrc = useMemo(() => {
    const candidate = project.previewThumbnail ?? project.resultVideoThumbnail
    const resolvedCandidate =
      typeof candidate === 'string' && candidate.trim().length > 0
        ? candidate
        : project.resultVideoThumbnail
    return resolvedCandidate ? addImgHostname(resolvedCandidate) : ''
  }, [addImgHostname, project.previewThumbnail, project.resultVideoThumbnail])
  const shouldRenderThumbnail = Boolean(thumbnailSrc) && !shouldUseDefaultBackground

  const showRemix = Boolean(project.isLongTake)

  const handleDownload = async (withWatermark: boolean) => {
    if (!project.id) {
      toast.error('Video not ready for download')
      return
    }

    try {
      await download(project.id, withWatermark, project.routePrefix)
    } catch {
      toast.error('Download failed. Please try again.')
    }
  }

  const handleDownloadClick = () => {
    void handleDownload(false)
  }

  const handleRemixIfAllowed = () => {
    if (!showRemix) {
      return
    }
    void handleRemix()
  }

  // The failed/cancelled Retry button routes through retry-recovery: regenerate
  // (reuse artifacts) when eligible, else fall back to a full remix.
  const handleRetryIfAllowed = () => {
    if (!showRemix) {
      return
    }
    void handleRetry()
  }

  // Mirror the other share panels: opening the share affordance auto-copies the
  // link when the project is public.
  const handleShareOpen = useCallback(() => {
    if (isPublic && sharedProjectId) {
      void copyShareLink()
    }
  }, [isPublic, sharedProjectId, copyShareLink])

  // The client-side "finished while you were away" marker, cleared on
  // open. Independent of the server stamp below -- this one is what the
  // notification surfaces read, and it is set even when no OS banner fired.
  const { acknowledge: acknowledgeProcessingCompletion } = useProcessingCompletion(project.id)

  // Opening the project acknowledges its finished background jobs so
  // the done pill clears on every device (server-persisted). Fire
  // and forget -- navigation must never wait on the stamp.
  const handleOpenProject = useCallback(() => {
    acknowledgeProcessingCompletion()
    if (processingPill?.variant === 'done') {
      // Stamp the cached row too: the list stays fresh for 5 minutes and never
      // refetches on focus, so coming back would re-show the pill we just
      // acknowledged server-side.
      patchProjectCaches({ processingSeenAt: new Date().toISOString() })
      void markProcessingSeen(fetchApiDomain, project.id)
    }
    onOpenProject()
  }, [
    acknowledgeProcessingCompletion,
    fetchApiDomain,
    onOpenProject,
    patchProjectCaches,
    processingPill?.variant,
    project.id,
  ])

  const menuItems: ContextMenuItem[] = buildMenuItems({
    agentSessionId: project.agentSessionId,
    isCancelling,
    isDownloading,
    isGenerating,
    onCancel: () => {
      cancelSession(project.id)
    },
    onDelete: () => {
      setDeleteDialog({ open: true, project })
    },
    onDownloadClick: handleDownloadClick,
    onOpenChat: () =>
      project.agentSessionId &&
      hardNavigate(`/agent?sessionId=${encodeURIComponent(project.agentSessionId)}`),
    onRemix: handleRemixIfAllowed,
    onRename: handleRenameStart,
    resultVideo: project.resultVideo,
    stage: project.stage,
    uip: project.uip,
    shareSubmenu: isBelowMd ? undefined : (
      <ShareSubmenu onOpen={handleShareOpen}>
        <ProjectSharePanel
          displayLink={displayLink}
          isCopied={isCopied}
          isPublic={isPublic}
          onCopyLink={() => void copyShareLink()}
          onSelectPrivate={() => void toggleAccess(false)}
          onSelectPublic={() => void toggleAccess(true)}
        />
      </ShareSubmenu>
    ),
    onShareMobile: isBelowMd
      ? () => {
          handleShareOpen()
          setMenuOpen(false)
          setShareOverlayOpen(true)
        }
      : undefined,
    showRemix,
  })

  const cardFooter = resolveCardFooter(statusMeta)

  return (
    <>
      <div
        className="group relative flex w-full cursor-pointer flex-col overflow-hidden rounded-[12px] border border-white/[0.08] bg-transparent text-left md:w-[205px]"
        // A click anywhere opens the project; keyboard and screen readers use the title's button
        // (the card holds its own buttons, which a card-wide button can't contain).
        onClick={handleOpenProject}
        style={
          shouldUseDefaultBackground
            ? {
                backgroundImage: `url(${DEFAULT_BG})`,
                backgroundPosition: 'center',
                backgroundSize: 'cover',
              }
            : undefined
        }
        {...getProjectScrollAnchorAttribute(project.id)}
      >
        <div className="pointer-events-none absolute inset-0 z-[1] bg-white/10 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />

        <div className="relative z-[2] h-0 w-full overflow-hidden rounded-[8px] bg-transparent pb-[100%]">
          {shouldRenderThumbnail ? (
            <ProjectPreviewImage alt={project.name || 'Project thumbnail'} src={thumbnailSrc} />
          ) : null}

          {(isGenerating || isFailed || isCanceled) && (
            <div className="absolute inset-0 flex items-center justify-center">
              <ThumbnailOverlay
                isCanceled={isCanceled}
                isFailed={isFailed}
                isGenerating={isGenerating}
                isPreparing={isPreparingRemix || isPreparingRetry}
                onRegenerate={handleRetryIfAllowed}
                showRemix={showRemix}
              />
            </div>
          )}

          <ProcessingPillOverlay pill={processingPill} />

          {project.createdVia === PROJECT_CREATED_VIA_AGENT && (
            <span className="bg-menu/50 pointer-events-none absolute top-2 left-2 inline-flex h-6 items-center rounded-full px-2 text-xs font-medium text-white backdrop-blur-2xl">
              Agent
            </span>
          )}
        </div>

        <div className="relative z-[2] flex h-[88px] w-full flex-col items-start justify-end gap-[8px] p-[12px]">
          {isEditing ? (
            <input
              className="!outline-none !ring-0 w-full appearance-none rounded-[10px] border border-solid border-white/10 bg-black/15 px-[10px] py-[4px] text-[12px] leading-[19px] text-white caret-white shadow-none focus:!outline-none focus:!ring-0 focus:border-white/10 focus:shadow-none focus-visible:!outline-none focus-visible:!border-ring focus-visible:!ring-1 focus-visible:!ring-ring"
              maxLength={100}
              onBlur={() => void handleRenameSave()}
              onChange={(e) => setEditValue(e.target.value)}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={handleRenameKeyDown}
              ref={editInputRef}
              type="text"
              value={editValue}
            />
          ) : (
            <button
              aria-label={`Open ${displayTitle}`}
              className="line-clamp-2 w-full rounded-sm text-left text-[12px] leading-[19px] text-white"
              onClick={(event) => {
                event.stopPropagation()
                handleOpenProject()
              }}
              type="button"
            >
              {displayTitle}
            </button>
          )}

          <div className="flex w-full items-start justify-between gap-2">
            <p className={cn('truncate text-[12px] leading-[19px]', cardFooter.className)}>
              {cardFooter.label}
            </p>

            <div
              className="ml-auto shrink-0"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
            >
              <Popover
                align="end"
                className="w-[236px] rounded-[16px] border-0 bg-menu/80 p-0 shadow-none backdrop-blur-2xl"
                content={
                  <ContextMenuItems
                    itemClassName="h-[38px] rounded-sm px-2.5 text-sm font-medium leading-[17px] hover:bg-white/10"
                    items={menuItems}
                    onItemClick={() => setMenuOpen(false)}
                  />
                }
                onOpenChange={setMenuOpen}
                open={menuOpen}
                side="bottom"
                sideOffset={6}
              >
                <Button
                  aria-label="Project actions"
                  className="size-5 rounded-full border-0 bg-transparent p-0 text-white/60 transition-colors duration-200 hover:bg-white/[0.18] hover:text-white"
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <MoreIcon className="size-4" />
                </Button>
              </Popover>
            </div>
          </div>
        </div>
      </div>

      {retryDialog}

      {isBelowMd && shareOverlayOpen && (
        <MobileShareOverlay onClose={() => setShareOverlayOpen(false)}>
          <ProjectSharePanel
            displayLink={displayLink}
            isCopied={isCopied}
            isPublic={isPublic}
            onClose={() => setShareOverlayOpen(false)}
            onCopyLink={() => void copyShareLink()}
            onSelectPrivate={() => void toggleAccess(false)}
            onSelectPublic={() => void toggleAccess(true)}
          />
        </MobileShareOverlay>
      )}
    </>
  )
}

/**
 * Failed = an explicit FAILED stage, or a stale in-progress project:
 * past the staleness threshold no writer is left to finish it, so the card
 * surfaces the failed treatment (label, tone, Retry) instead of spinning
 * forever.
 */
function isFailedCard(project: Project): boolean {
  if (project.stage === PROJECT_STAGE.FAILED) {
    return true
  }
  return isStaleInProgressProject({
    createdAt: project.createdAt,
    resultVideo: project.resultVideo,
    stage: project.stage,
  })
}

function ShareSubmenu({ children, onOpen }: { children: ReactNode; onOpen: () => void }) {
  const firedRef = useRef(false)
  useEffect(() => {
    if (firedRef.current) {
      return
    }
    firedRef.current = true
    onOpen()
  }, [onOpen])
  return <>{children}</>
}

function ThumbnailOverlay({
  isCanceled,
  isFailed,
  isGenerating,
  isPreparing,
  onRegenerate,
  showRemix,
}: {
  isCanceled: boolean
  isFailed: boolean
  isGenerating: boolean
  isPreparing: boolean
  onRegenerate: () => void
  showRemix: boolean
}) {
  if ((isFailed || isCanceled) && showRemix) {
    return (
      <Button
        className="h-7 rounded-md border border-subtle bg-fill-secondary px-2 text-xs text-primary hover:bg-fill-hover"
        disabled={isPreparing}
        onClick={(event) => {
          event.preventDefault()
          event.stopPropagation()
          onRegenerate()
        }}
        onKeyDown={(event) => {
          event.stopPropagation()
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        {isPreparing ? 'Preparing...' : 'Retry'}
      </Button>
    )
  }
  if (isFailed) {
    return <Info className="size-5 text-[#CF4020]" />
  }
  if (isCanceled) {
    return <CrossCircle className="size-5 text-[#CF4020]" />
  }
  if (isGenerating) {
    return (
      <RiveCanvas
        autoplay
        className="size-6 brightness-0 invert opacity-70"
        showLoadingSkeleton={false}
        src={getPublicCdnUrl('agent/rive/ai_icon.riv')}
        stateMachines="State Machine"
      />
    )
  }
  return null
}
