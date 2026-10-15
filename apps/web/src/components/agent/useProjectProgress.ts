'use client'

import { orderKeyframes, versionedVideoUrl } from '@reelmakeeasy/common/codex-agent/agent-storyboard'
import type {
  LongTakeEditorStateResponse,
  LongTakeStatus,
  LongTakeStatusStage,
} from '@shared/types/api/long-take'
import { useAtomValue } from 'jotai'
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

import { useLongTakeArtifacts } from '@/app/long-take/hooks/useLongTakeArtifacts'
import {
  getStageHeadline,
  getStageProgressPercent,
  getStageSecondaryText,
  isFailedStage,
} from '@/app/story-mode/components/LongTakeViewer/progress'
import { musicBusyProjectsAtom } from '@/app/story-mode/hook/useMusicToggle'
import { useApi } from '@/hooks/useApi'

import { renderedVersionsAtom } from './renderedVersions'

/** A started video, as the agent chat and the storyboard panel show it. */
export type ProjectProgress = {
  /** The voiceover the editor's live preview plays (the editor engine needs it). */
  audioPreviewUrl: null | string
  /** The bed's measured bed-to-voice gain (dB), so the live level follows the export mix. */
  bgmBedGainDb: null | number
  /** The music bed's URL and volume (0-100), for the live preview; null until there is one. */
  bgmBedUrl: null | string
  /** Whether the delivered video has background music (the status's `bgmEnabled`), sent
   *  with an export render as the editor does; null/undefined when unknown. */
  bgmEnabled: boolean | null | undefined
  /** Where the bed came from ('generated' | 'library' | 'upload') and which track. */
  bgmSource: null | string
  bgmTrackId: null | string
  /** The bed's name: the director's track name, or the library/own track's title. */
  bgmTrackName: null | string
  bgmVolume: null | number
  /** Whether the delivered video has captions burned in; null until the status is read. */
  captionsInVideo: boolean | null
  /** The video file is delivered (a music change can rewrite it). */
  delivered: boolean
  /** Completed with a video URL. */
  done: boolean
  /** Set once the render failed (stage `error` or `rejected`): what went wrong. */
  error: null | string
  /** A finished loop's clips kept although they still fail a check (its storyboard ids, e.g.
   *  `s3`), from the run's completed status; empty for any other video, and until it is done. */
  flaggedClips: string[]
  headline: string
  /** One per finished shot, in shot order: its thumbnail, or the keyframe itself. */
  keyframes: { shotId: string; url: string }[]
  /** The joined clips a loop's clip sound bed was made from (`loopPreviewMedia`); null with
   *  the bed. */
  loopClipsUrl: null | string
  /** A delivered loop's clip sound bed is being built: its URL comes in a later read. */
  loopSfxBedPending: boolean
  /** A loop's clip sound bed and its 0-100 volume, for the live preview (`loopPreviewMedia`);
   *  null for any other video, and for a loop whose bed is missing or stale. */
  loopSfxBedUrl: null | string
  loopSfxBedVolume: null | number
  /** Records a render this page delivered (with captions or not): the video URL changes
   *  so players load the new file, and `captionsInVideo` follows until the status does. */
  noteRendered: (captionsOn: boolean) => void
  /** 0-100. */
  percent: number
  script: null | string
  stage: LongTakeStatusStage | null
  transitionsReady: number
  /** The current video: after a render from this page, a new URL for the republished file. */
  videoUrl: null | string
}

/** How often the editor state (keyframes, transitions) is re-read while the render runs. */
const STATE_POLL_MS = 10_000

const EMPTY_PROGRESS: ProjectProgress = {
  audioPreviewUrl: null,
  bgmBedGainDb: null,
  bgmBedUrl: null,
  bgmEnabled: undefined,
  bgmSource: null,
  bgmTrackId: null,
  bgmTrackName: null,
  bgmVolume: null,
  captionsInVideo: null,
  delivered: false,
  done: false,
  error: null,
  flaggedClips: [],
  headline: getStageHeadline(null),
  keyframes: [],
  loopClipsUrl: null,
  loopSfxBedPending: false,
  loopSfxBedUrl: null,
  loopSfxBedVolume: null,
  percent: 0,
  script: null,
  noteRendered: () => undefined,
  stage: null,
  transitionsReady: 0,
  videoUrl: null,
}

/** `getStageSecondaryText`'s answer for a failure it has no specific words for. */
const GENERIC_FAILURE = getStageSecondaryText('error')
/** A machine code in `detail` (e.g. `TTS_FAILED`) is not shown as is. */
const DETAIL_CODE_RE = /^[A-Z0-9_]+$/

type EditorStateSummary = {
  keyframes: { shotId: string; url: string }[]
  transitionsReady: number
}

/** What a failed render says: the friendly text for a known detail code, else the detail
 *  itself when it reads as a sentence, else a generic line. */
function failureText(stage: LongTakeStatusStage, detail: string | undefined): string {
  const known = getStageSecondaryText(stage, detail)
  if (known !== GENERIC_FAILURE) return known
  if (detail?.trim() && !DETAIL_CODE_RE.test(detail.trim())) return detail.trim()
  return 'Something went wrong. Try again from the editor.'
}

function headlineFor(stage: LongTakeStatusStage | null, videoUrl: null | string): string {
  // Not in progress.ts's pipeline order, which would read "Processing queued...".
  if (stage === 'queued') return 'Waiting to start...'
  // `completed` before the video URL lands (the status endpoint backfills it).
  if (stage === 'completed' && !videoUrl) return 'Finalizing your video...'
  return getStageHeadline(stage)
}

const EMPTY_STATE: EditorStateSummary = { keyframes: [], transitionsReady: 0 }

/** The clips a finished loop's run kept although they still fail a check: its completed
 *  status names them (`beatLoopFlaggedClips`, comma-joined ids). */
function flaggedClipsKey(status: LongTakeStatus | null): string {
  if (status?.stage !== 'completed') return ''
  const flagged = status.meta?.beatLoopFlaggedClips
  return typeof flagged === 'string' ? flagged : ''
}

const sameKeyframes = (a: EditorStateSummary['keyframes'], b: EditorStateSummary['keyframes']) =>
  a.length === b.length && a.every((k, i) => k.shotId === b[i].shotId && k.url === b[i].url)

/**
 * Polls `GET /api/long-take-videos/{id}/state` every 10 s for the keyframes and the
 * transition count while the render runs, and reads it once more when it turns terminal
 * (`terminal` flipping re-runs the effect: one read, no interval) and after every rebuild
 * from the chat (`renderedVersion`). A failed read keeps what was there.
 */
function useEditorStateSummary(
  projectId: string,
  terminal: boolean,
  renderedVersion: number,
): EditorStateSummary {
  const { fetchApiDomain } = useApi()
  // The poll restarts on the project or `terminal` only, not on a new fetch helper.
  const fetchRef = useRef(fetchApiDomain)
  useEffect(() => {
    fetchRef.current = fetchApiDomain
  }, [fetchApiDomain])
  const [summary, setSummary] = useState<EditorStateSummary>(EMPTY_STATE)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetchRef.current<LongTakeEditorStateResponse>(
          `/api/long-take-videos/${projectId}/state`,
          { method: 'GET', noThrowError: true },
        )
        if (cancelled || !response.ok) return
        const state = response.data?.data
        const keyframes = orderKeyframes(state?.keyframes ?? [], state?.transitions ?? [])
          .map((k) => ({ shotId: k.shotId, url: k.thumbnailUrl || k.keyframeUrl }))
          .filter((k) => !!k.url)
        const transitionsReady = state?.transitions?.length ?? 0
        setSummary((prev) =>
          prev.transitionsReady === transitionsReady && sameKeyframes(prev.keyframes, keyframes)
            ? prev
            : { keyframes, transitionsReady },
        )
      } catch {
        // Best-effort: the next read (or the status poll) catches up.
      }
    }
    void load()
    if (terminal) {
      return () => {
        cancelled = true
      }
    }
    const intervalId = window.setInterval(() => void load(), STATE_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [projectId, renderedVersion, terminal])

  return summary
}

/**
 * The one poll behind a project's progress: `useLongTakeArtifacts` (the status, every 5 s,
 * stopping at terminal) and the editor-state poll for keyframes, plus what a Download
 * render from this page delivered (`noteRendered`). Mounted once per project by
 * `ProjectProgressProvider`; read it with `useProjectProgress`.
 */
export function usePolledProjectProgress(projectId: string): ProjectProgress {
  // A render delivered from this page: what it rendered (until the status says the same)
  // and a counter that versions the republished file's URL.
  const [rendered, setRendered] = useState<{ version: number; with: boolean | null }>({
    version: 0,
    with: null,
  })
  const noteRendered = useCallback(
    (captionsOn: boolean) => setRendered((r) => ({ version: r.version + 1, with: captionsOn })),
    [],
  )
  // While the chat or the Music switch changes the music, the status keeps polling past
  // delivery so the bed and the toggle are read back once the file is rewritten.
  const musicBusy = useAtomValue(musicBusyProjectsAtom)[projectId] ?? false
  // Rebuilds from the chat (`render_video`, `set_music`): the status is read once more, the
  // state is re-read and the file's URL changes.
  const chatRendered = useAtomValue(renderedVersionsAtom)[projectId] ?? 0
  const {
    audioPreviewUrl,
    status,
    script,
    videoUrl: deliveredUrl,
  } = useLongTakeArtifacts(projectId, musicBusy, chatRendered)
  const stage = status?.stage ?? null
  const failed = isFailedStage(stage)
  const done = stage === 'completed' && !!deliveredUrl
  const { keyframes, transitionsReady } = useEditorStateSummary(
    projectId,
    done || failed,
    chatRendered,
  )
  const detail = status?.detail
  const runStatus = status?.status
  // Stable while the list is: a new array on every read would re-render every reader.
  const flaggedKey = flaggedClipsKey(status)
  const flaggedClips = useMemo(
    () =>
      flaggedKey
        ? flaggedKey
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
        : [],
    [flaggedKey],
  )

  // The render pipeline captions anything that isn't strictly false (legacy null included).
  const polledCaptionsInVideo =
    status?.enableCaption === undefined ? null : status.enableCaption !== false
  const renderedWith = rendered.with
  useEffect(() => {
    // The status caught up with the render: it is the source of truth again.
    if (renderedWith !== null && polledCaptionsInVideo === renderedWith) {
      setRendered((r) => ({ ...r, with: null }))
    }
  }, [polledCaptionsInVideo, renderedWith])
  const captionsInVideo = renderedWith ?? polledCaptionsInVideo
  const videoUrl = deliveredUrl
    ? versionedVideoUrl(deliveredUrl, rendered.version + chatRendered)
    : null
  const bgmEnabled = status?.bgmEnabled
  const bgmBedUrl = status?.bgmBedCdnUrl ?? null
  const bgmBedGainDb = status?.bgmBedGainDb ?? null
  const bgmVolume = status?.bgmVolume ?? null
  const bgmSource = status?.bgmSource ?? null
  const bgmTrackId = status?.bgmTrackId ?? null
  const bgmTrackName = status?.bgmTrackName ?? null
  const loopClipsUrl = status?.loopClipsUrl ?? null
  const loopSfxBedPending = status?.loopSfxBedPending ?? false
  const loopSfxBedUrl = status?.loopSfxBedUrl ?? null
  const loopSfxBedVolume = status?.loopSfxBedVolume ?? null
  const delivered = !!deliveredUrl

  return useMemo<ProjectProgress>(
    () => ({
      audioPreviewUrl,
      bgmBedGainDb,
      bgmBedUrl,
      bgmEnabled,
      bgmSource,
      bgmTrackId,
      bgmTrackName,
      bgmVolume,
      captionsInVideo,
      delivered,
      done,
      error: failed && stage ? failureText(stage, detail) : null,
      flaggedClips,
      headline: headlineFor(stage, videoUrl),
      keyframes,
      loopClipsUrl,
      loopSfxBedPending,
      loopSfxBedUrl,
      loopSfxBedVolume,
      percent: getStageProgressPercent(stage, runStatus),
      noteRendered,
      script,
      stage,
      transitionsReady,
      videoUrl,
    }),
    [
      audioPreviewUrl,
      bgmBedGainDb,
      bgmBedUrl,
      bgmEnabled,
      bgmSource,
      bgmTrackId,
      bgmTrackName,
      bgmVolume,
      captionsInVideo,
      delivered,
      detail,
      done,
      failed,
      flaggedClips,
      keyframes,
      loopClipsUrl,
      loopSfxBedPending,
      loopSfxBedUrl,
      loopSfxBedVolume,
      runStatus,
      noteRendered,
      script,
      stage,
      transitionsReady,
      videoUrl,
    ],
  )
}

/** Progress by project id, filled by `ProjectProgressProvider`'s pollers. */
export const ProjectProgressContext = createContext<ReadonlyMap<string, ProjectProgress>>(new Map())

/**
 * A started video's live progress: stage, percent, script, keyframes, and the video once
 * done. Every consumer of one project (the chat card, the storyboard panel) shares the
 * single poll `ProjectProgressProvider` runs for it, so nothing polls twice. Before the
 * first read, for a project the provider doesn't poll, or for null: an empty progress.
 */
export function useProjectProgress(projectId: null | string): ProjectProgress {
  const byId = useContext(ProjectProgressContext)
  return (projectId ? byId.get(projectId) : undefined) ?? EMPTY_PROGRESS
}
