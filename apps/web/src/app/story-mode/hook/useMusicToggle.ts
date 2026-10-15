'use client'

import { BGM_DEFAULT_VOLUME } from '@reelmakeeasy/common/long-take/bgm-volume'
import {
  musicNoteFor,
  type MusicRequest,
  sanitizeMusicChoice,
} from '@reelmakeeasy/common/long-take/music-craft'
import { toast } from '@shared/ui'
import { atom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { useCallback, useEffect, useId, useRef, useState } from 'react'

import { noteVideoRenderedAtom } from '@/components/agent/renderedVersions'
import { useApi } from '@/hooks/useApi'

/**
 * The music change running for a project, shared by every control on the page (the agent
 * page shows a video's controls twice: under the chat card and in the storyboard). Only
 * the control that started it (`owner`) finishes it.
 */
export type MusicChange = {
  kind: 'other' | 'volume'
  label: string
  /** The switch position the change leads to; null when it does not move the switch. */
  nextOn: boolean | null
  owner: string
}
export const musicChangesAtom = atom<Record<string, MusicChange | undefined>>({})

/** Projects whose music is being changed right now: the status poll keeps going for them. */
export const musicBusyProjectsAtom = atom((get) =>
  Object.fromEntries(
    Object.entries(get(musicChangesAtom)).map(([projectId, change]) => [projectId, !!change]),
  ),
)

/** A level asked for while a volume save was running: saved as soon as that one ends. */
export const musicPendingVolumeAtom = atom<Record<string, number | undefined>>({})

/**
 * A music level the user is choosing or has just saved, per project, ahead of the status:
 * the previews play it at once while the delivered file is rebaked. Dropped once the
 * status says the same level (the default when none was ever saved), or when saving it
 * failed.
 */
export const musicVolumeDraftAtom = atom<Record<string, number>>({})

export type MusicAction = 'post' | 'put'

/** The music level the previews play: the user's draft, else the saved one, else the default. */
export function useLiveMusicVolume(
  projectId: string,
  persisted: null | number | undefined,
): number {
  const draft = useAtomValue(musicVolumeDraftAtom)[projectId]
  const setDrafts = useSetAtom(musicVolumeDraftAtom)
  const saved = persisted ?? BGM_DEFAULT_VOLUME
  useEffect(() => {
    if (draft !== undefined && saved === draft) {
      setDrafts(({ [projectId]: _done, ...rest }) => rest)
    }
  }, [draft, projectId, saved, setDrafts])
  return draft ?? saved
}

/**
 * What a switch press does: nothing while a change runs; a new bed (`post`) when music is
 * turned on for a video that never had one; otherwise a remux (`put`) that puts the bed in
 * or takes it out.
 */
export function nextMusicAction(input: {
  busy: boolean
  hasBed: boolean
  next: boolean
}): MusicAction | null {
  if (input.busy) return null
  return input.next && !input.hasBed ? 'post' : 'put'
}

/** The API call a menu pick makes on a delivered video. */
export type MusicApplyCall = {
  action: MusicAction
  data: Record<string, unknown>
  method: 'POST' | 'PUT'
  path: 'bgm-settings' | 'bgm-versions'
}

/**
 * A menu pick as an API call: off is a remux without the bed; a track is fitted; a mood or
 * the user's words make a new bed through the director (Pick for me lets it choose).
 */
export function musicApplyCall(request: MusicRequest): MusicApplyCall {
  const choice = sanitizeMusicChoice(request.choice)
  if (choice === 'off') {
    return { action: 'put', data: { bgmEnabled: false }, method: 'PUT', path: 'bgm-settings' }
  }
  const post = (data: Record<string, unknown>): MusicApplyCall => ({
    action: 'post',
    data,
    method: 'POST',
    path: 'bgm-versions',
  })
  if (request.track) return post({ track: request.track })
  const note = request.note?.trim()
  return post({ note: note || musicNoteFor(choice) })
}

/** What a change is doing, for the spinner beside the music controls. */
export function musicBusyLabel(call: MusicApplyCall, nextOn: boolean): string {
  if (call.method === 'PUT' && call.data.bgmVolume !== undefined) return 'Updating the volume…'
  if (call.method === 'PUT') return nextOn ? 'Adding the music…' : 'Removing the music…'
  if (call.data.track) return 'Applying the track…'
  return 'Generating music…'
}

/**
 * A change already running on the server when the page looks (a reload mid-change, or the
 * chat's set_music): what to wait for and how to say it. A bed workflow reads as
 * generating (a track fit takes a second or two, so it is rarely caught).
 */
export function serverMusicBusy(settings: BgmSettings): null | {
  action: MusicAction
  label: string
} {
  if (settings.generating) return { action: 'post', label: 'Generating music…' }
  if (settings.applying) return { action: 'put', label: 'Updating the music…' }
  return null
}

/** The project's current pick, as the menu marks it. */
export function musicRequestFromProject(project: {
  bgmEnabled?: boolean | null
  bgmSource?: null | string
  bgmTrackId?: null | string
}): MusicRequest {
  if (!project.bgmEnabled) return { choice: 'off' }
  const { bgmSource, bgmTrackId } = project
  if (bgmTrackId && (bgmSource === 'library' || bgmSource === 'upload')) {
    return { choice: 'auto', track: { id: bgmTrackId, source: bgmSource } }
  }
  return { choice: 'auto' }
}

/** How often the change is checked on, and how long before giving up on it. */
const POLL_MS = 3000
const MAX_WAIT_MS = 5 * 60 * 1000
/** How often an idle control asks whether a change started elsewhere (the chat) is running. */
const WATCH_MS = 6000

type BgmSettings = {
  applying?: boolean
  generating?: boolean
  regenOutcome?: string
  remuxOutcome?: string
}

/**
 * Where a change stands from the API's bgm-settings: still running, done, or failed (the
 * step the action started, or the remux a bed generation ends with).
 */
export function settledMusicChange(
  settings: BgmSettings,
  action: MusicAction,
): 'done' | 'failed' | 'pending' {
  if (settings.applying || settings.generating) return 'pending'
  const failed = (outcome?: string) => outcome === 'failed' || outcome === 'terminated'
  if (failed(settings.remuxOutcome)) return 'failed'
  if (action === 'post' && failed(settings.regenOutcome)) return 'failed'
  return 'done'
}

/**
 * The music controls under a delivered video, on the agent page and in the editor: the
 * switch, the Change menu and the volume. Each change goes through the API (a remux, or a
 * new bed), is shown with what it is doing, and once the API reports it settled the
 * caller refreshes its status (and players reload the file, except for a level change
 * the live previews already play). A change already running, here or elsewhere (the
 * chat), is picked up and followed.
 */
export function useMusicToggle(
  projectId: string,
  input: {
    bgmEnabled: boolean | null | undefined
    /** The saved level, to put back when saving a new one fails. */
    bgmVolume?: null | number
    /** The video is delivered: before that the controls do nothing. */
    delivered: boolean
    hasBed: boolean
    onChanged?: () => void
    /** The player plays the delivered file (not a live preview): reload it after a level change. */
    reloadPlayersOnVolume?: boolean
  },
): {
  applyRequest: (request: MusicRequest) => Promise<void>
  busy: boolean
  /** What the running change is doing (e.g. "Generating music"); null when idle. */
  busyLabel: null | string
  musicOn: boolean
  /** Plays a level in the previews while the user drags; nothing is saved. */
  previewVolume: (volume: number) => void
  setMusicOn: (next: boolean) => Promise<void>
  /** Saves a level (0-100) and rebakes the delivered file at it; queued during a save. */
  setVolume: (volume: number) => Promise<void>
  /** Another kind of change runs: the volume waits for it. */
  volumeLocked: boolean
} {
  const { fetchApiDomain } = useApi()
  const store = useStore()
  const owner = useId()
  const change = useAtomValue(musicChangesAtom)[projectId]
  // The switch shows the choice at once; the status catches up after the remux.
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const setVolumeDrafts = useSetAtom(musicVolumeDraftAtom)
  const noteVideoRendered = useSetAtom(noteVideoRenderedAtom)
  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  const { bgmEnabled, bgmVolume, delivered, hasBed, onChanged, reloadPlayersOnVolume } = input
  useEffect(() => {
    if (optimistic !== null && bgmEnabled === optimistic) setOptimistic(null)
  }, [bgmEnabled, optimistic])

  const readSettings = useCallback(async (): Promise<BgmSettings> => {
    const response = await fetchApiDomain<BgmSettings | { data?: BgmSettings }>(
      `/api/long-take-videos/${projectId}/bgm-settings`,
      { method: 'GET' },
    )
    const raw = response.data as BgmSettings | undefined | { data?: BgmSettings }
    return raw && 'data' in raw && raw.data ? raw.data : ((raw as BgmSettings | undefined) ?? {})
  }, [fetchApiDomain, projectId])

  const runningChange = useCallback(
    () => store.get(musicChangesAtom)[projectId],
    [projectId, store],
  )
  const setVolumeRef = useRef<(volume: number) => Promise<void>>(async () => undefined)

  /**
   * Shows one change through: claims it for the page (refused while another runs), makes
   * the call (none when following a change the server already runs), polls until the API
   * reports it settled, then refreshes. A failure puts things back and says so.
   */
  const follow = useCallback(
    async (input: {
      action: MusicAction
      call?: Pick<MusicApplyCall, 'data' | 'method' | 'path'>
      kind: MusicChange['kind']
      label: string
      nextOn: boolean | null
    }) => {
      if (runningChange()) return
      store.set(musicChangesAtom, (c) => ({
        ...c,
        [projectId]: { kind: input.kind, label: input.label, nextOn: input.nextOn, owner },
      }))
      if (input.nextOn !== null) setOptimistic(input.nextOn)
      const previousVolume = bgmVolume ?? BGM_DEFAULT_VOLUME
      let ok = false
      try {
        if (input.call) {
          await fetchApiDomain(`/api/long-take-videos/${projectId}/${input.call.path}`, {
            data: input.call.data,
            method: input.call.method,
          })
        }
        const deadline = Date.now() + MAX_WAIT_MS
        let state: 'done' | 'failed' | 'pending' = 'pending'
        while (state === 'pending' && Date.now() < deadline && mountedRef.current) {
          await new Promise((r) => setTimeout(r, POLL_MS))
          state = settledMusicChange(await readSettings(), input.action)
        }
        if (!mountedRef.current) return
        if (state !== 'done') throw new Error(`music change ${state}`)
        ok = true
        // The delivered file changed in place: players load it again. A level change is
        // already playing in a live preview; reloading would restart it.
        if (input.kind !== 'volume' || reloadPlayersOnVolume) noteVideoRendered(projectId)
        onChanged?.()
      } catch {
        if (input.kind === 'volume') {
          // The API saves the level before the rebake: put the old one back, so the saved
          // level and the file agree, and the previews follow.
          void fetchApiDomain(`/api/long-take-videos/${projectId}/bgm-settings`, {
            data: { bgmVolume: previousVolume },
            method: 'PUT',
            noThrowError: true,
          })
          setVolumeDrafts(({ [projectId]: _failed, ...rest }) => rest)
          store.set(musicPendingVolumeAtom, ({ [projectId]: _dropped, ...rest }) => rest)
        }
        if (mountedRef.current) {
          setOptimistic(null)
          toast.error(
            input.kind === 'volume'
              ? `Could not change the volume. It is back to ${previousVolume}%.`
              : 'Could not change the music. Try again in a moment.',
          )
        }
      } finally {
        store.set(musicChangesAtom, (c) =>
          c[projectId]?.owner === owner ? { ...c, [projectId]: undefined } : c,
        )
      }
      // A level asked for while this one was saving: save it now.
      const pending = store.get(musicPendingVolumeAtom)[projectId]
      if (ok && input.kind === 'volume' && pending !== undefined) {
        store.set(musicPendingVolumeAtom, ({ [projectId]: _taken, ...rest }) => rest)
        if (pending !== input.call?.data.bgmVolume) await setVolumeRef.current(pending)
      }
    },
    [
      bgmVolume,
      fetchApiDomain,
      noteVideoRendered,
      onChanged,
      owner,
      projectId,
      readSettings,
      reloadPlayersOnVolume,
      runningChange,
      setVolumeDrafts,
      store,
    ],
  )

  const run = useCallback(
    async (call: MusicApplyCall, nextOn: boolean) =>
      follow({
        action: call.action,
        call,
        kind: 'other',
        label: musicBusyLabel(call, nextOn),
        nextOn,
      }),
    [follow],
  )

  // A change may already be running when the page opens (a reload mid-change), or start
  // elsewhere while it is open (the chat's set_music): check now and then while idle, and
  // follow it, so the controls say why they are locked.
  const followRef = useRef(follow)
  followRef.current = follow
  useEffect(() => {
    if (!delivered) return
    let stopped = false
    const check = async () => {
      if (stopped || runningChange()) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        const running = serverMusicBusy(await readSettings())
        // The user may have started something while the answer was on its way.
        if (!running || stopped || !mountedRef.current || runningChange()) return
        await followRef.current({
          action: running.action,
          kind: 'other',
          label: running.label,
          nextOn: null,
        })
      } catch {
        // Only a courtesy: the controls still work without it.
      }
    }
    void check()
    const timer = window.setInterval(() => void check(), WATCH_MS)
    return () => {
      stopped = true
      window.clearInterval(timer)
    }
  }, [delivered, readSettings, runningChange])

  const busy = !!change
  const setMusicOn = useCallback(
    async (next: boolean) => {
      const action = nextMusicAction({ busy: !!runningChange(), hasBed, next })
      if (!action || !delivered) return
      await run(
        action === 'put'
          ? { action, data: { bgmEnabled: next }, method: 'PUT', path: 'bgm-settings' }
          : { action, data: {}, method: 'POST', path: 'bgm-versions' },
        next,
      )
    },
    [delivered, hasBed, run, runningChange],
  )

  /** A pick from the music menu: a track, a mood, the user's words, or no music. */
  const applyRequest = useCallback(
    async (request: MusicRequest) => {
      if (runningChange() || !delivered) return
      const call = musicApplyCall(request)
      await run(call, call.method === 'POST')
    },
    [delivered, run, runningChange],
  )

  const previewVolume = useCallback(
    (volume: number) => {
      const level = Math.round(Math.max(0, Math.min(volume, 100)))
      setVolumeDrafts((d) => ({ ...d, [projectId]: level }))
    },
    [projectId, setVolumeDrafts],
  )

  const setVolume = useCallback(
    async (volume: number) => {
      if (!delivered) return
      const level = Math.round(Math.max(0, Math.min(volume, 100)))
      previewVolume(level)
      const running = runningChange()
      if (running) {
        // Another level is being saved: this one goes next. Any other change locks it.
        if (running.kind === 'volume') {
          store.set(musicPendingVolumeAtom, (p) => ({ ...p, [projectId]: level }))
        }
        return
      }
      await follow({
        action: 'put',
        call: { data: { bgmVolume: level }, method: 'PUT', path: 'bgm-settings' },
        kind: 'volume',
        label: 'Updating the volume…',
        nextOn: null,
      })
    },
    [delivered, follow, previewVolume, projectId, runningChange, store],
  )
  setVolumeRef.current = setVolume

  return {
    applyRequest,
    busy,
    busyLabel: change?.label ?? null,
    musicOn: change?.nextOn ?? optimistic ?? bgmEnabled ?? false,
    previewVolume,
    setMusicOn,
    setVolume,
    volumeLocked: busy && change?.kind !== 'volume',
  }
}
