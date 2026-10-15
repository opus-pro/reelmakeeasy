import { Logger } from '@reelmakeeasy/common/utils/logger'
import type {
  LongTakeLipSyncVideoVariants,
  LongTakeStatus,
  LongTakeStatusResponse,
} from '@shared/types/api/long-take'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useApi } from '@/hooks/useApi'

const nsLogger = Logger.get('long-take.long-take-artifacts', 'long-take')

export type LongTakeArtifacts = {
  audioPreviewUrl: null | string
  isLoading: boolean
  isLongTake: boolean
  lipSyncVideoVariants?: LongTakeLipSyncVideoVariants
  script: null | string
  status: LongTakeStatus | null
  styleName: null | string
  styleText: null | string
  styleThumbnailUrl: null | string
  uploadedAudioUrl: null | string
  videoUrl: null | string
  watermarkVideoUrl: null | string
}

/**
 * Polls the long-take status endpoint (5s) and stops at the terminal stage.
 * `keepPollingAtTerminal` suspends that stop: a BGM (re)generation persists a
 * new bed AFTER the render is terminal, and this status read is the single
 * source feeding every bed consumer (music panel preview, live overlay bed,
 * export), so the poll must outlive the render while such a run is in flight.
 * Flipping it back to false stops the poll on the next read. So does a loop's
 * clip sound bed being built after delivery (`loopSfxBedPending`): the live
 * previews play the loop once it is there.
 */
export function useLongTakeArtifacts(
  projectId?: null | string,
  keepPollingAtTerminal = false,
  /** Bumped when something else changed the delivered video (the chat's tools): one more read. */
  refreshKey = 0,
): LongTakeArtifacts {
  const { fetchApiDomain } = useApi()
  const [status, setStatus] = useState<LongTakeStatus | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const prevProjectIdRef = useRef<null | string>(null)
  // Keep fetchApiDomain in a ref so the polling effect only restarts on projectId changes,
  // not on every auth/origin atom update that recreates the function reference.
  const fetchApiDomainRef = useRef(fetchApiDomain)
  useEffect(() => {
    fetchApiDomainRef.current = fetchApiDomain
  }, [fetchApiDomain])

  useEffect(() => {
    if (!projectId) {
      setStatus(null)
      setIsLoading(false)
      prevProjectIdRef.current = null
      return
    }

    // Reset only on an actual project switch: the effect also re-runs when
    // keepPollingAtTerminal toggles, and that must not flash loading/null.
    if (prevProjectIdRef.current !== projectId) {
      setStatus(null)
      setIsLoading(true)
    }
    prevProjectIdRef.current = projectId

    let cancelled = false

    // The backend can report stage='completed' (stored status) before the
    // project doc's resultVideo lands, so treating 'completed' as terminal here
    // strands the UI on a 100% loader. 'completed' is only terminal once
    // videoUrl is present; otherwise keep polling (the status endpoint
    // reconciles resultVideo from storage) up to a grace window, then surface an
    // error rather than poll/loader forever.
    const MAX_COMPLETED_WITHOUT_VIDEO_POLLS = 24 // ~2 min at 5s
    let completedWithoutVideoPolls = 0

    const isTerminalStage = (s: LongTakeStatus | null) => {
      if (s?.stage === 'error' || s?.stage === 'rejected') {
        return true
      }
      if (s?.stage === 'completed') {
        return Boolean(s.videoUrl)
      }
      return false
    }

    let intervalId: number | undefined = undefined

    const loadStatus = async () => {
      try {
        const response = await fetchApiDomainRef.current<LongTakeStatusResponse>(
          `/api/long-take-videos/${projectId}`,
          { method: 'GET', noThrowError: true },
        )
        if (prevProjectIdRef.current !== projectId) {
          return
        }
        if (cancelled) {
          return
        }
        if (!response.ok) {
          setStatus(null)
          return
        }
        const newStatus = response.data.data ?? null
        // Compare UI-affecting fields only; updatedAt/meta change every poll
        // and would defeat the bail-out that prevents unnecessary re-renders.
        setStatus((prev) => {
          if (
            prev &&
            newStatus &&
            prev.stage === newStatus.stage &&
            prev.status === newStatus.status &&
            prev.script === newStatus.script &&
            prev.videoUrl === newStatus.videoUrl &&
            prev.styleName === newStatus.styleName &&
            prev.styleText === newStatus.styleText &&
            prev.styleThumbnailUrl === newStatus.styleThumbnailUrl &&
            prev.audioPreviewUrl === newStatus.audioPreviewUrl &&
            prev.uploadedAudioUrl === newStatus.uploadedAudioUrl &&
            prev.watermarkVideoUrl === newStatus.watermarkVideoUrl &&
            prev.enableCaption === newStatus.enableCaption &&
            // The bed persists mid-run without changing stage/videoUrl, so the
            // BGM fields must participate or the music panel never sees them
            // until some unrelated field happens to change.
            prev.bgmBedCdnUrl === newStatus.bgmBedCdnUrl &&
            prev.bgmBedGainDb === newStatus.bgmBedGainDb &&
            prev.bgmEnabled === newStatus.bgmEnabled &&
            prev.bgmSource === newStatus.bgmSource &&
            prev.bgmTrackId === newStatus.bgmTrackId &&
            prev.bgmTrackName === newStatus.bgmTrackName &&
            prev.bgmVolume === newStatus.bgmVolume &&
            // A loop's clip sound bed (built after delivery for an older loop) and the joined
            // clips it was made from.
            prev.loopClipsUrl === newStatus.loopClipsUrl &&
            prev.loopSfxBedPending === newStatus.loopSfxBedPending &&
            prev.loopSfxBedUrl === newStatus.loopSfxBedUrl &&
            prev.loopSfxBedVolume === newStatus.loopSfxBedVolume &&
            // The clips a finished loop kept although they still fail a check: the chat names
            // them, and a clip made again changes them with nothing else.
            prev.meta?.beatLoopFlaggedClips === newStatus.meta?.beatLoopFlaggedClips &&
            // The caption look: saved, the delivered file's, the kind's default and the
            // agent's suggested highlight.
            prev.captionAccentSuggestion === newStatus.captionAccentSuggestion &&
            prev.captionKind === newStatus.captionKind &&
            sameJson(prev.captionStyle, newStatus.captionStyle) &&
            sameJson(prev.renderedCaptionStyle, newStatus.renderedCaptionStyle) &&
            sameLipSyncVideoVariants(prev.lipSyncVideoVariants, newStatus.lipSyncVideoVariants)
          ) {
            return prev
          }
          return newStatus
        })
        if (newStatus?.stage === 'completed' && !newStatus.videoUrl) {
          completedWithoutVideoPolls += 1
          if (completedWithoutVideoPolls >= MAX_COMPLETED_WITHOUT_VIDEO_POLLS) {
            if (intervalId !== undefined) {
              window.clearInterval(intervalId)
            }
            // Render reported complete but no video materialized within the
            // grace window -- stop polling and surface an error rather than an
            // endless 100% loader.
            setStatus((prev) => (prev ? { ...prev, stage: 'error', status: 'error' } : prev))
          }
        } else if (
          isTerminalStage(newStatus) &&
          !keepPollingAtTerminal &&
          !newStatus?.loopSfxBedPending &&
          intervalId !== undefined
        ) {
          window.clearInterval(intervalId)
        }
      } catch (error) {
        if (!cancelled) {
          setStatus(null)
          nsLogger.warn(`Failed to load status ${String(error)}`)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    loadStatus()
    intervalId = window.setInterval(loadStatus, 5000)

    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [projectId, keepPollingAtTerminal, refreshKey])

  const script = status?.script ?? null
  const styleName = status?.styleName ?? null
  const styleThumbnailUrl = status?.styleThumbnailUrl ?? null
  const styleText = status?.styleText ?? null
  const audioPreviewUrl = status?.audioPreviewUrl ?? null
  const uploadedAudioUrl = status?.uploadedAudioUrl ?? null
  const videoUrl = status?.videoUrl ?? null
  const watermarkVideoUrl = status?.watermarkVideoUrl ?? null
  const lipSyncVideoVariants = status?.lipSyncVideoVariants

  const isLongTake = useMemo(
    () => Boolean(status || script || styleText || uploadedAudioUrl || videoUrl),
    [status, script, styleText, uploadedAudioUrl, videoUrl],
  )

  return {
    isLongTake,
    isLoading,
    lipSyncVideoVariants,
    script,
    status,
    styleName,
    styleThumbnailUrl,
    styleText,
    audioPreviewUrl,
    uploadedAudioUrl,
    videoUrl,
    watermarkVideoUrl,
  }
}

/** Small JSON objects from the status (caption settings), compared by value. */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function sameLipSyncVideoVariants(
  a: LongTakeLipSyncVideoVariants | undefined,
  b: LongTakeLipSyncVideoVariants | undefined,
): boolean {
  if (!a || !b) {
    return a === b
  }
  return (
    a.appliedCount === b.appliedCount &&
    a.baseVideoUrl === b.baseVideoUrl &&
    a.baseWatermarkVideoUrl === b.baseWatermarkVideoUrl &&
    a.failedCount === b.failedCount &&
    a.lipSyncVideoUrl === b.lipSyncVideoUrl &&
    a.lipSyncWatermarkVideoUrl === b.lipSyncWatermarkVideoUrl &&
    a.skippedCount === b.skippedCount
  )
}
