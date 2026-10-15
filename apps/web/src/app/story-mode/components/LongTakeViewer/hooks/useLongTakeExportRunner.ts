import { VIDEO_NOT_RENDERED_ERROR_CODE } from '@reelmakeeasy/common/long-take/video-not-rendered'
import type { LongTakeRenderRequest, UpscaleOutcome } from '@shared/types/api/long-take'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import { toast } from '@shared/ui'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { useRefCallback } from '@/hooks/use-ref-callback'
import { useApi } from '@/hooks/useApi'
import { useVideoDownload } from '@/hooks/useVideoDownload'
import { isApiError } from '@/lib/api-error'
import type { SSEConnection } from '@/util/sse'

type ExportStatus = 'completed' | 'failed' | 'idle' | 'running'

// Context-free export mechanics shared by the legacy long-take editor and the inpaint
// editor. It owns the POST /render call, the /render/stream SSE lifecycle, the
// download-existing path, and the status machine. The caller supplies the data
// (renderRequired + request) and the post-render baseline commit (onRenderComplete), so
// neither editor's state model leaks in here.
export interface ExportRenderInputs {
  // Optional guard run right before a render submit; return false to abort (after showing
  // its own toast). The legacy editor uses it for regenerating/stale checks.
  preRenderGuard?: () => boolean
  renderRequired: boolean
  // The render payload. Required when renderRequired is true.
  request: LongTakeRenderRequest | null
}

export interface ExportRunnerOptions {
  isBrandVideo?: boolean
  lipSyncDownloadEnabled?: boolean
  onComplete?: () => void
  // Commit the post-render baseline; receives the request that was rendered. Runs on a
  // successful render only (not on the download-existing path).
  onRenderComplete?: (submitted: LongTakeRenderRequest) => void
  onStop?: () => void
  projectId: string
  /**
   * Applied style identity, for the Auto Style Selection guardrail
   * attribution on every sm_editor.export.* event. Sourced from
   * Project.styleName (already resolved by DetailPanel); undefined for
   * projects with no known style.
   */
  styleName?: string
  // Which editor is exporting; tags every sm_editor.export.* event. Defaults to
  // 'longtake' so the legacy editor needs no change.
  surface?: 'inpaint' | 'longtake'
  tier?: ModelSelectorAnalyticsTier
  transitionVideoModel?: string
  upscaleOutcome?: UpscaleOutcome
}

export function useLongTakeExportRunner({
  onComplete,
  onRenderComplete,
  onStop,
  projectId,
  lipSyncDownloadEnabled,
}: ExportRunnerOptions) {
  const { fetchApiDomain, createSSEConnection } = useApi()
  const { download } = useVideoDownload()

  const [status, setStatus] = useState<ExportStatus>('idle')
  // Whether the backend reported this export will Topaz-upscale the edited
  // transitions (from the render-start response). Drives only the export
  // progress bar's pacing (a longer window so it does not freeze at 90%).
  const [isUpscaling, setIsUpscaling] = useState(false)
  const sseRef = useRef<null | SSEConnection>(null)
  const submittedSnapshotRef = useRef<LongTakeRenderRequest | null>(null)
  // Watermark choice for the in-flight export. A ref, not state, so the SSE handler and the
  // async download callback read the current value rather than a stale closure capture.
  const inflightWatermarkRef = useRef(false)
  // True from the moment an export starts until it reaches a terminal state, so a second
  // startExport cannot fire an overlapping render and clobber the in-flight refs.
  const exportInProgressRef = useRef(false)
  // Snapshot of the lipSync info for the in-flight export, used by the SSE completion
  // handler when no submitted request is available (defensive fallback).
  // True once an editor render has completed this session. Editor renders skip
  // Topaz upscale, so from that point every download serves a non-upscale video
  // and the original generation's upscale outcome no longer applies.
  // NOTE: session-scoped. If the user reloads after an editor render and then
  // downloads without further edits, this resets and the (now stale) fetched
  // trace outcome is reported. The authoritative cross-reload fix is BE (have
  // the editor render overwrite upscale_trace.json to reflect the non-upscale
  // delivered video); tracked as a follow-up, out of scope here.
  const editorRenderedRef = useRef(false)

  useEffect(() => {
    return () => {
      sseRef.current?.close()
      sseRef.current = null
    }
  }, [])

  useEffect(() => {
    if (status !== 'completed' && status !== 'failed') {
      return
    }
    // Any terminal status means the run is over; release the overlap guard and
    // clear the upscale pacing flag (captured from this run's render-start
    // response) so a subsequent export never reuses a stale value.
    exportInProgressRef.current = false
    setIsUpscaling(false)
    const id = setTimeout(() => setStatus('idle'), 500)
    return () => clearTimeout(id)
  }, [status])

  const renderMutation = useMutation({
    mutationFn: async (snapshot: LongTakeRenderRequest) => {
      const response = await fetchApiDomain<{ isUpscaling?: boolean; workflowId: string }>(
        `/api/long-take-videos/${projectId}/render`,
        { method: 'POST', data: snapshot },
      )
      if (!response.ok) {
        throw new Error(response.error || 'Failed to start export')
      }
      return response.data
    },
  })

  const connectRenderSSE = useRefCallback(() => {
    sseRef.current?.close()

    const conn = createSSEConnection(`/api/long-take-videos/${projectId}/render/stream`, {
      message: () => void 0,
      update: (payload: { data: string }) => {
        try {
          const state = JSON.parse(payload.data) as {
            error?: { message?: string }
            result?: { videoUri?: string }
            status: string
          }
          if (state.status === 'completed') {
            const completedWithWatermark = inflightWatermarkRef.current
            // The editor just re-rendered the timeline (non-upscale); the
            // delivered video is now non-upscale for the rest of the session.
            editorRenderedRef.current = true
            conn.close()
            sseRef.current = null
            const submittedSnapshot = submittedSnapshotRef.current
            if (submittedSnapshot) {
              onRenderComplete?.(submittedSnapshot)
            }
            submittedSnapshotRef.current = null
            void (async () => {
              try {
                await download(projectId, completedWithWatermark, undefined, {
                  lipSync: lipSyncDownloadEnabled,
                })

                setStatus('completed')
                onComplete?.()
              } catch (error) {
                setStatus('failed')
                const message = error instanceof Error ? error.message : 'Download failed'
                toast.error(message || 'Download failed. Please try again.')
                onStop?.()
              }
            })()
          } else if (state.status === 'failed') {
            const submittedSnapshot = submittedSnapshotRef.current
            conn.close()
            sseRef.current = null
            submittedSnapshotRef.current = null
            setStatus('failed')
            toast.error(state.error?.message || 'Export failed. Please try again.')
            onStop?.()
          }
        } catch {
          // ignore parse errors
        }
      },
      error: (payload: { data?: string; raw_error?: Error }) => {
        if (payload.raw_error?.name === 'AbortError') {
          return
        }
        sseRef.current = null
        submittedSnapshotRef.current = null
        setStatus('failed')
        toast.error('Lost connection to export. Please try again.')
        onStop?.()
      },
    })

    sseRef.current = conn
    conn.start().catch(() => {
      sseRef.current = null
      submittedSnapshotRef.current = null
      setStatus('failed')
      toast.error('Failed to connect to export stream.')
      onStop?.()
    })
  })

  const startExport = useRefCallback(
    async (isWithWatermark: boolean, inputs: ExportRenderInputs) => {
      if (exportInProgressRef.current) {
        return false
      }
      exportInProgressRef.current = true
      // Fresh run: clear the upscale pacing flag until this run's render-start
      // response reports it (only the render path sets it true), so a prior
      // run's value never leaks into a no-render download or a new render.
      setIsUpscaling(false)
      const { preRenderGuard, renderRequired, request } = inputs
      inflightWatermarkRef.current = isWithWatermark

      // No render required - skip re-render and download the latest final video directly.
      if (!renderRequired) {
        try {
          await download(projectId, isWithWatermark, undefined, {
            lipSync: lipSyncDownloadEnabled,
          })
          setStatus('completed')
          toast.success('Download started')
          return true
        } catch (error) {
          // download-url answers 404 VIDEO_NOT_RENDERED when there is no delivered file
          // (never rendered, or gone): render it, as when edits need rendering. Any other
          // failure (another 404 included) fails as before.
          const notRendered =
            isApiError(error) && error.isNotFound && error.code === VIDEO_NOT_RENDERED_ERROR_CODE
          if (!(notRendered && request)) {
            exportInProgressRef.current = false
            toast.error('Video not available for download')
            onStop?.()
            return false
          }
        }
      }

      if (preRenderGuard && !preRenderGuard()) {
        exportInProgressRef.current = false
        return false
      }

      if (!request || request.transitions.length === 0) {
        exportInProgressRef.current = false
        toast.error('No transitions available to render.')
        return false
      }
      if (!request.expectedRevision) {
        exportInProgressRef.current = false
        toast.error('Editor state is not ready to render yet. Please refresh and try again.')
        return false
      }

      try {
        submittedSnapshotRef.current = request
        const started = await renderMutation.mutateAsync(request)
        setIsUpscaling(Boolean(started?.isUpscaling))
        setStatus('running')
        connectRenderSSE()
        return true
      } catch (error) {
        exportInProgressRef.current = false
        submittedSnapshotRef.current = null
        const failReason =
          error instanceof Error ? error.message : 'Failed to start export. Please try again.'
        toast.error(failReason)
        onStop?.()
        return false
      }
    },
  )

  return {
    isActive: status === 'running',
    isCompleted: status === 'completed',
    isUpscaling,
    startExport,
    status,
  }
}
