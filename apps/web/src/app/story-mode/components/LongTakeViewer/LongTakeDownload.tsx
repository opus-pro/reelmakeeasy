'use client'

import type { UpscaleOutcome } from '@shared/types/api/long-take'
import { useCallback, useEffect, useState } from 'react'

import ExportProgressDialog from '@/app/projects/[projectId]/components/ExportProgressDialog'
import { useApi } from '@/hooks/useApi'

import {
  type StartExportOptions,
  useLongTakeExport,
  type UseLongTakeExportOptions,
} from './hooks/useLongTakeExport'

// Simulated progress-window length for an upscale export (~5.5min). Topaz adds
// ~5min (avg estimated_seconds ~313), so the fake progress bar must pace to this
// instead of the ~1.5min default, or it slams into 90% and appears frozen.
const UPSCALE_EXPORT_ESTIMATED_DURATION_MS = 330000

export type LongTakeDownload = ReturnType<typeof useLongTakeDownload>

export type UseLongTakeDownloadOptions = Omit<
  UseLongTakeExportOptions,
  'isBrandVideo' | 'onStop' | 'upscaleOutcome'
>

/**
 * The Story Mode editor's Download: `useLongTakeExport` (render first when the editor
 * has something to render, else download the delivered file), the progress dialog's
 * open state, and the project metadata its tracking and pacing need. Render the dialog
 * with `LongTakeExportProgressDialog`. Shared by the editor's Download buttons and the
 * agent page's.
 */
export function useLongTakeDownload({
  onComplete,
  projectId,
  ...exportOptions
}: UseLongTakeDownloadOptions) {
  const { fetchApiDomain } = useApi()
  const [dialogOpen, setDialogOpen] = useState(false)
  // Source the brand flag for project.downloaded tracking. Derived BE-side
  // (brand_extraction_input != null) so it matches uipVideoStarted etc.
  const [isBrandVideo, setIsBrandVideo] = useState<boolean | undefined>(undefined)
  // Topaz upscale-path outcome for project.downloaded tracking, so
  // download rate can be compared across upscale ('success'), degraded upscale
  // ('fallback'), and non-upscale ('not_run') videos. Same BE metadata source.
  const [upscaleOutcome, setUpscaleOutcome] = useState<undefined | UpscaleOutcome>(undefined)
  useEffect(() => {
    let active = true
    fetchApiDomain<{
      isBrandVideo?: boolean
      upscaleOutcome?: UpscaleOutcome
    }>(`/api/project/${projectId}/metadata`)
      .then((response) => {
        if (active && response.ok) {
          setIsBrandVideo(response.data?.isBrandVideo)
          setUpscaleOutcome(response.data?.upscaleOutcome)
        }
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [fetchApiDomain, projectId])

  const exportState = useLongTakeExport({
    ...exportOptions,
    isBrandVideo,
    onComplete: () => {
      setDialogOpen(false)
      onComplete?.()
    },
    onStop: () => setDialogOpen(false),
    projectId,
    upscaleOutcome,
  })
  const { isActive, startExport } = exportState

  // Open the progress dialog once a server render actually starts. The
  // download-existing path never enters 'running', so the dialog stays closed there.
  useEffect(() => {
    if (isActive) {
      setDialogOpen(true)
    }
  }, [isActive])

  // The export path owns its own error toasts; swallow an unexpected rejection
  // so it cannot surface an unhandled-rejection warning.
  const handleDownloadClick = useCallback(
    (options?: StartExportOptions) => {
      void startExport(false, options).catch(() => undefined)
    },
    [startExport],
  )

  return { ...exportState, dialogOpen, handleDownloadClick, setDialogOpen }
}

/** The editor's export progress dialog for a `useLongTakeDownload`. */
export function LongTakeExportProgressDialog({
  download,
  thumbnailUrl,
  videoUrl,
}: {
  download: LongTakeDownload
  thumbnailUrl: string | undefined
  videoUrl: string | undefined
}) {
  return (
    <ExportProgressDialog
      autoFit
      description="We're preparing your video. It will download automatically when it's ready—please don't leave this page."
      // An upscale export adds a ~5min Topaz pass; pace the fake progress to
      // ~5.5min so it does not freeze at 90%. Non-upscale keeps the default.
      estimatedDurationMs={download.isUpscaling ? UPSCALE_EXPORT_ESTIMATED_DURATION_MS : undefined}
      isActive={download.isActive}
      isCompleted={download.isCompleted}
      onOpenChange={download.setDialogOpen}
      open={download.dialogOpen}
      preventClose
      thumbnailUrl={thumbnailUrl}
      videoUrl={videoUrl}
    />
  )
}
