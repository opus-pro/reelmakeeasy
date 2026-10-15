'use client'

import type { CaptionStyleSettings } from '@shared/types/api/caption-style'
import { toast } from '@shared/ui'
import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { atom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useRef } from 'react'

import { type CaptionStyleRenderSetting, renderSettingsAtom } from '@/atom/longtake-history.store'
import { type FetchApiDomain, useApi } from '@/hooks/useApi'

import { captionAspectRatio, type CaptionKind, captionStyleNeedsRender } from './caption-settings'
import { type CaptionStatus, getCaptionStatus, putCaptionSettings } from './caption-settings.api'

/** How long the controls wait for changes to pause before saving them, in one request. */
export const CAPTION_SAVE_DEBOUNCE_MS = 600

/** One query per video, shared by the panels, the previews and Download. */
export const captionStatusQueryKey = (projectId: string) => ['caption-status', projectId] as const

/**
 * The look the user is choosing, per project, ahead of the saved one: the previews draw it
 * at once. Dropped once it is saved (the status query then holds it), or put back when
 * saving fails.
 */
export const captionStyleDraftAtom = atom<Record<string, CaptionStyleSettings | undefined>>({})

type JotaiStore = ReturnType<typeof useStore>

/**
 * A project's unsaved caption changes. One queue per project, shared by every control
 * showing it (the agent page shows a video's controls twice), so at most one save is on
 * its way: the endpoint reads, merges and writes the column, and two at once could lose a
 * field.
 */
type SaveQueue = {
  deps: { fetchApiDomain: FetchApiDomain; queryClient: QueryClient; store: JotaiStore }
  inFlight: boolean
  /** Fields changed since the last save went out. */
  pending: CaptionStyleSettings
  timer: null | ReturnType<typeof setTimeout>
}

const saveQueues = new Map<string, SaveQueue>()

const dropDraft = (store: JotaiStore, projectId: string) =>
  store.set(captionStyleDraftAtom, ({ [projectId]: _dropped, ...rest }) => rest)

/**
 * The look the previews draw now, read outside React: the unsaved choice, else the saved
 * look in the cache (null: nothing chosen); undefined when the status was never read.
 */
export function shownCaptionStyle(
  store: JotaiStore,
  queryClient: QueryClient,
  projectId: string,
): CaptionStyleSettings | null | undefined {
  return (
    store.get(captionStyleDraftAtom)[projectId] ??
    queryClient.getQueryData<CaptionStatus>(captionStatusQueryKey(projectId))?.saved
  )
}

async function saveCaptionChanges(projectId: string, queue: SaveQueue): Promise<void> {
  queue.timer = null
  if (queue.inFlight || Object.keys(queue.pending).length === 0) return
  const body = queue.pending
  queue.pending = {}
  queue.inFlight = true
  const { fetchApiDomain, queryClient, store } = queue.deps
  const queryKey = captionStatusQueryKey(projectId)
  // A status read already on its way could answer after this save and put the old look
  // back in the cache; so could one sent while it saves. Both are dropped, and the status
  // is read again once the save is done (it may bring a new delivered look).
  let droppedRead = queryClient.isFetching({ queryKey }) > 0
  const dropReads = () => queryClient.cancelQueries({ queryKey })
  try {
    await dropReads()
    const saved = await putCaptionSettings(fetchApiDomain, projectId, body)
    droppedRead ||= queryClient.isFetching({ queryKey }) > 0
    await dropReads()
    queue.inFlight = false
    const cached = queryClient.setQueryData<CaptionStatus>(
      queryKey,
      (status) => status && { ...status, saved },
    )
    if (droppedRead || !cached) void queryClient.invalidateQueries({ queryKey })
    if (Object.keys(queue.pending).length > 0) {
      // Changes made while this one was on its way: they go next, once their pause ends.
      if (!queue.timer) await saveCaptionChanges(projectId, queue)
    } else if (!queue.timer && cached) {
      dropDraft(store, projectId)
    }
  } catch {
    queue.inFlight = false
    queue.pending = {}
    if (queue.timer) clearTimeout(queue.timer)
    queue.timer = null
    dropDraft(store, projectId)
    if (droppedRead) void queryClient.invalidateQueries({ queryKey })
    toast.error('Could not save the caption style. It is back to how it was.')
  }
}

/** The caption fields of a video's status, read once and shared. */
export function useCaptionStatus(projectId: string): {
  /** The status was read, or reading it failed: the defaults apply. */
  settled: boolean
  status: CaptionStatus | undefined
} {
  const { fetchApiDomain } = useApi()
  const query = useQuery<CaptionStatus>({
    enabled: !!projectId,
    queryFn: () => getCaptionStatus(fetchApiDomain, projectId),
    queryKey: captionStatusQueryKey(projectId),
    refetchOnWindowFocus: false,
  })
  return { settled: !projectId || !query.isPending, status: query.data }
}

/**
 * The look the previews draw: the user's unsaved choice, else the saved one (null: the
 * kind's default). `settled` is false until the status is read, so a preview doesn't
 * flash the wrong style first.
 */
export function useLiveCaptionStyle(projectId: string): {
  kind: CaptionKind
  settings: CaptionStyleSettings | null
  settled: boolean
} {
  const { settled, status } = useCaptionStatus(projectId)
  const draft = useAtomValue(captionStyleDraftAtom)[projectId]
  return { kind: status?.kind ?? 'video', settings: draft ?? status?.saved ?? null, settled }
}

/**
 * Whether the delivered file draws its captions (with `captionsOn`), or a loop's fact stamps
 * (without), otherwise than the look on screen, so Download renders it again: the rule
 * Download follows (`captionStyleNeedsRender`). False until the status is read. A loop
 * delivered before looks were recorded counts as Classic, so it differs until rendered again.
 */
export function useDeliveredCaptionLookDiffers(
  projectId: string,
  /** The video's frame, as CSS ('9 / 16') or '9:16'. */
  aspectRatio: null | string | undefined,
  captionsOn: boolean,
): boolean {
  const { status } = useCaptionStatus(projectId)
  const draft = useAtomValue(captionStyleDraftAtom)[projectId]
  if (!status) return false
  return captionStyleNeedsRender(status.rendered, draft ?? status.saved, {
    aspectRatio,
    captionsOn,
    kind: status.kind,
  })
}

/**
 * A video's caption look for the style controls: what to show, and `change`, which shows a
 * change at once and saves the fields changed in a burst as one request once changes
 * pause. A failed save puts the saved look back and says so.
 */
export function useCaptionSettings(projectId: string) {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()
  const store = useStore()
  const { settled, status } = useCaptionStatus(projectId)
  const draft = useAtomValue(captionStyleDraftAtom)[projectId]
  const settings = draft ?? status?.saved ?? null

  const change = useCallback(
    (patch: CaptionStyleSettings) => {
      if (!projectId) return
      const shown = shownCaptionStyle(store, queryClient, projectId) ?? {}
      store.set(captionStyleDraftAtom, (drafts) => ({
        ...drafts,
        [projectId]: { ...shown, ...patch },
      }))
      const queue: SaveQueue = saveQueues.get(projectId) ?? {
        deps: { fetchApiDomain, queryClient, store },
        inFlight: false,
        pending: {},
        timer: null,
      }
      saveQueues.set(projectId, queue)
      queue.deps = { fetchApiDomain, queryClient, store }
      queue.pending = { ...queue.pending, ...patch }
      if (queue.timer) clearTimeout(queue.timer)
      queue.timer = setTimeout(
        () => void saveCaptionChanges(projectId, queue),
        CAPTION_SAVE_DEBOUNCE_MS,
      )
    },
    [fetchApiDomain, projectId, queryClient, store],
  )

  return {
    accentSuggestion: status?.accentSuggestion ?? null,
    change,
    kind: status?.kind ?? 'video',
    settings,
    settled,
  }
}

/**
 * The render settings' caption look: the delivered file's (`status.rendered`) against the
 * one on screen (`shown`, else the saved one).
 */
export function captionStyleRenderSetting(
  status: CaptionStatus,
  shown: CaptionStyleSettings | null | undefined,
  aspectRatio: null | string | undefined,
): CaptionStyleRenderSetting {
  return {
    aspectRatio: captionAspectRatio(aspectRatio),
    kind: status.kind,
    known: true,
    latest: shown === undefined ? status.saved : shown,
    original: status.rendered,
  }
}

/**
 * Keeps the editor's render settings (`renderSettingsAtom`) on the open video's caption
 * look, so its Download renders again when the look on screen differs from the delivered
 * file's. Like the caption switch's baseline, `original` follows the status only when the
 * status names a new delivered look: a render just committed keeps its own until then.
 */
export function useCaptionStyleRenderSync(
  projectId: string,
  /** The video's frame, as CSS ('9 / 16') or '9:16'. */
  aspectRatio: null | string | undefined,
) {
  const { status } = useCaptionStatus(projectId)
  const draft = useAtomValue(captionStyleDraftAtom)[projectId]
  // Re-seeds after the render settings were reset for a newly opened project.
  const known = useAtomValue(renderSettingsAtom).captionStyle.known
  const setRenderSettings = useSetAtom(renderSettingsAtom)
  const lastRendered = useRef<null | { key: string; projectId: string }>(null)

  useEffect(() => {
    if (!status) return
    const renderedKey = JSON.stringify(status.rendered)
    const renderedChanged =
      lastRendered.current?.projectId !== projectId || lastRendered.current.key !== renderedKey
    lastRendered.current = { key: renderedKey, projectId }
    const next = captionStyleRenderSetting(status, draft, aspectRatio)
    setRenderSettings((prev) => {
      const current = prev.captionStyle
      const original = renderedChanged || !current.known ? next.original : current.original
      if (
        current.known &&
        current.aspectRatio === next.aspectRatio &&
        current.kind === next.kind &&
        current.latest === next.latest &&
        current.original === original
      ) {
        return prev
      }
      return { ...prev, captionStyle: { ...next, original } }
    })
  }, [aspectRatio, draft, known, projectId, setRenderSettings, status])
}
