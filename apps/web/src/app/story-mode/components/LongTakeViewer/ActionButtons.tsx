import { DebugSettings } from '@shared/types/project/debug-settings'
import { Button } from '@shared/ui'
import { useCallback } from 'react'

import { Download } from '@/components/icons/core'
import { useProjectAtom } from '@/hooks/useProjects'

import { useInpaintGenerationRunning } from './hooks/use-inpaint-generation-running'
import { GenerationWaitTooltip } from './generation-wait-tooltip'
import { LongTakeExportProgressDialog, useLongTakeDownload } from './LongTakeDownload'

interface ActionButtonsProps {
  // Whether the delivered video has background music; sent with export renders.
  bgmEnabled?: boolean | null
  isMobile?: boolean
  isOwner: boolean
  lipSyncDownloadEnabled?: boolean
  lipSyncPreviewOverrides?: Record<string, boolean>
  projectId: string
  shareMode?: boolean
  styleName?: string
  styleText?: string
  styleThumbnailUrl?: string
  videoUrl?: string
  watermarkVideoUrl?: null | string
}

interface OwnerActionsProps {
  // Whether the delivered video has background music; sent with export renders.
  bgmEnabled?: boolean | null
  isMobile?: boolean
  lipSyncDownloadEnabled?: boolean
  lipSyncPreviewOverrides?: Record<string, boolean>
  projectId: string
  styleName?: string
  videoUrl?: string
  watermarkVideoUrl?: null | string
}

export function ActionButtons({
  bgmEnabled,
  isMobile = false,
  isOwner,
  lipSyncDownloadEnabled,
  lipSyncPreviewOverrides,
  projectId,
  shareMode = false,
  styleName,
  videoUrl,
  watermarkVideoUrl,
}: ActionButtonsProps) {
  if (isOwner && !shareMode) {
    return (
      // Keyed by project: OwnerActions is a per-project state machine (export
      // phases), and the sibling strip swaps `projectId` on this mounted
      // instance; remounting resets it structurally. The viewer already interposes its loading
      // page on every project switch, so no surviving-instance UX is lost.
      <OwnerActions
        bgmEnabled={bgmEnabled}
        isMobile={isMobile}
        key={projectId}
        lipSyncDownloadEnabled={lipSyncDownloadEnabled}
        lipSyncPreviewOverrides={lipSyncPreviewOverrides}
        projectId={projectId}
        styleName={styleName}
        videoUrl={videoUrl}
        watermarkVideoUrl={watermarkVideoUrl}
      />
    )
  }
}

function OwnerActions({
  bgmEnabled,
  isMobile = false,
  lipSyncDownloadEnabled,
  lipSyncPreviewOverrides,
  styleName,
  videoUrl,
  watermarkVideoUrl,
  projectId,
}: OwnerActionsProps) {
  const { projectInfo } = useProjectAtom()
  const debugSettings = projectInfo?.debugSettings as DebugSettings | undefined
  const download = useLongTakeDownload({
    bgmEnabled,
    lipSyncPreviewOverrides,
    projectId,
    tier: projectInfo?.modelSelectorTier ?? undefined,
    transitionVideoModel: debugSettings?.transitionVideoModel,
    lipSyncDownloadEnabled,
    styleName,
  })
  const { handleDownloadClick: startDownload, isExportDisabled } = download
  // Not passed straight to onClick: the click event is not export options.
  const handleDownloadClick = useCallback(() => startDownload(), [startDownload])

  const generationRunning = useInpaintGenerationRunning(projectId)

  const renderDownload = () => {
    if (isMobile) {
      return (
        <GenerationWaitTooltip blocked={generationRunning}>
          <Button
            className="relative flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-2.5 text-base font-medium text-black hover:bg-white/90"
            data-dd-action="project-page-download-button"
            disabled={isExportDisabled || !videoUrl || generationRunning}
            onClick={handleDownloadClick}
          >
            <Download className="size-6" />
            <span>Download</span>
          </Button>
        </GenerationWaitTooltip>
      )
    }
    return (
      <GenerationWaitTooltip blocked={generationRunning}>
        <Button
          className="relative flex h-[38px] w-full items-center justify-center gap-1.5 rounded-xl bg-white text-center text-black hover:bg-white/90"
          data-dd-action="project-page-download-button"
          disabled={isExportDisabled || !videoUrl || generationRunning}
          onClick={handleDownloadClick}
        >
          Download
        </Button>
      </GenerationWaitTooltip>
    )
  }

  return (
    <>
      {isMobile ? (
        <div className="flex w-full gap-2">{renderDownload()}</div>
      ) : (
        <div className="space-y-3">{renderDownload()}</div>
      )}

      <LongTakeExportProgressDialog
        download={download}
        thumbnailUrl={projectInfo?.resultVideoThumbnail}
        videoUrl={videoUrl ?? watermarkVideoUrl ?? undefined}
      />
    </>
  )
}
