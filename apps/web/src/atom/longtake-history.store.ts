import { buildLongTakeEditorRevision } from '@reelmakeeasy/common/long-take/editor-state'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import type { CaptionStyleSettings } from '@shared/types/api/caption-style'
import type {
  LongTakeEditorState,
  LongTakeRenderSettings,
  LongTakeTransition,
  TransitionRegenWorkflowResult,
} from '@shared/types/api/long-take'
import { atom, getDefaultStore } from 'jotai'
import { selectAtom } from 'jotai/utils'

import { HistoryStorageAdapter } from '@/app/projects/[projectId]/editor/utils/history-storage-adapter'
import { atomWithPersistence } from '@/atom/common'
import {
  DraftConflictError,
  getLongTakeEditorDraft,
  putLongTakeEditorDraft,
} from '@/atom/longtake-draft.api'
import {
  applyKeyframeEditToState,
  applyPatchToState,
  buildTransitionRegenerateContext,
  buildTransitionTopology,
  buildUpdatedTransitionsFromWorkflowResults,
  computeStaleTransitionIds,
  getMaskedKeyframeIds,
  hasRenderRelevantChanges,
  mergeRegeneratedTransitionsIntoState,
  replaySnapshots,
  type TransitionTopology,
} from '@/atom/longtake-history.domain'
import type {
  KeyframeFrameRole,
  LongTakeHistory,
  LongTakeSnapshot,
} from '@/atom/longtake-history.types'
import { projectIdAtom as openProjectIdAtom } from '@/atom/project'
import {
  type CaptionKind,
  captionStyleNeedsRender,
  effectiveCaptionStyle,
} from '@/components/captions/caption-settings'
import type { FetchApiDomain } from '@/hooks/useApi'

const setsEqual = <T>(a: Set<T>, b: Set<T>) => a.size === b.size && [...a].every((v) => b.has(v))

const nsLogger = Logger.get('story-mode.longtake-history-store')

const MAX_HISTORY = 30

const DRAFT_SAVE_DEBOUNCE_MS = 1500

const storageAdapter = new HistoryStorageAdapter<LongTakeHistory>()

// The server PUT is additive to the IndexedDB cache. The API client is a hook
// value, so the consuming hook injects it on init; the store stays decoupled.
let draftApiClient: FetchApiDomain | null = null
let draftSaveTimer: null | ReturnType<typeof setTimeout> = null
let pendingDraftSave: null | {
  client: FetchApiDomain
  history: LongTakeHistory
  workingState: LongTakeEditorState | null
} = null
// Set while initializeHistoryAtom seeds the store, so a fresh load never echoes
// its own restored state back as a PUT, on first mount and on every re-init.
let suppressDraftSave = false
// `updatedAt` of the server draft this session is based on, sent as the
// optimistic-concurrency token so a stale save is rejected (409) instead of
// clobbering a newer draft written by another editor of the same project.
let lastDraftUpdatedAt: null | number = null
// A 409 means the token above is permanently stale for this session: every
// retry would resend it and fail again, so further saves must stop until a
// reload re-syncs from the server.
let draftSaveConflicted = false

export type ApplyRegeneratedTransitionsInput =
  | {
      affectedTransitionIds: string[]
      freshTransitions: LongTakeTransition[]
    }
  | {
      affectedTransitionIds: string[]
      workflowResults: TransitionRegenWorkflowResult[]
    }

function createEmptyHistory(projectId: string, baseRevision?: string): LongTakeHistory {
  return { baseRevision, future: [], past: [], projectId }
}

function makeSnapshotId() {
  return crypto.randomUUID()
}

// Fire any debounced save immediately. Exposed so the editor hook can flush on
// unmount, and called internally before a project switch, so the trailing edit
// is never dropped by the debounce reset.
export function flushPendingDraftSave() {
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer)
    draftSaveTimer = null
  }
  if (!pendingDraftSave) {
    return
  }
  const { client, history, workingState } = pendingDraftSave
  pendingDraftSave = null
  putLongTakeEditorDraft(client, history.projectId, {
    baseRevision: history.baseRevision ?? '',
    baseUpdatedAt: lastDraftUpdatedAt ?? undefined,
    snapshots: history.past,
    workingState: workingState ?? undefined,
  })
    .then((saved) => {
      if (saved) {
        lastDraftUpdatedAt = saved.updatedAt
      }
    })
    .catch((err) => {
      if (err instanceof DraftConflictError) {
        draftSaveConflicted = true
        if (draftSaveTimer) {
          clearTimeout(draftSaveTimer)
          draftSaveTimer = null
        }
        pendingDraftSave = null
        getDefaultStore().set(draftSaveConflictAtom, true)
        return
      }
      nsLogger.error('Draft save failed:', err)
    })
}

function scheduleDraftSave(history: LongTakeHistory, workingState: LongTakeEditorState | null) {
  if (
    suppressDraftSave ||
    draftSaveConflicted ||
    !draftApiClient ||
    !history.projectId ||
    history.baseRevision === undefined
  ) {
    return
  }
  // A pending save for a different project must not be silently dropped by the
  // debounce reset below; flush it first so its edits still reach the server.
  if (pendingDraftSave && pendingDraftSave.history.projectId !== history.projectId) {
    flushPendingDraftSave()
  }
  pendingDraftSave = { client: draftApiClient, history, workingState }
  if (draftSaveTimer) {
    clearTimeout(draftSaveTimer)
  }
  draftSaveTimer = setTimeout(flushPendingDraftSave, DRAFT_SAVE_DEBOUNCE_MS)
}

export const projectIdAtom = atom<string>('')
projectIdAtom.debugLabel = 'longtake.history.projectId'

// True once a draft save has hit a 409, meaning further edits are no longer
// being saved. Written from module scope via getDefaultStore() since
// flushPendingDraftSave/scheduleDraftSave run outside any component.
export const draftSaveConflictAtom = atom(false)
draftSaveConflictAtom.debugLabel = 'longtake.history.draftSaveConflict'

/**
 * Which project the LOADED editor state below belongs to. Distinct from
 * projectIdAtom, which means "a viewer is currently open on this project" and
 * is cleared on viewer unmount (useLongTakeViewerData) -- while baseState /
 * currentState (and therefore renderRequiredAtom) survive that unmount. Any
 * surface OUTSIDE the viewer that asks "are there unapplied edits, and for
 * which project?" (the projects-grid download submenu) must key on this, or a
 * viewer -> grid navigation reads renderRequired=true with an empty project id
 * and silently drops the gate.
 *
 * Only ever the last INITIALIZED project: the store holds one project's state
 * at a time, so opening project B stops answering for project A's drafts (they
 * stay persisted and re-hydrate when A is opened again).
 */
export const editedProjectIdAtom = atom<string>('')
editedProjectIdAtom.debugLabel = 'longtake.history.editedProjectId'

export const baseStateAtom = atom<LongTakeEditorState | null>(null)
baseStateAtom.debugLabel = 'longtake.history.baseState'

export const currentStateAtom = atom<LongTakeEditorState | null>(null)
currentStateAtom.debugLabel = 'longtake.history.currentState'

export interface RenderSettingField<T> {
  latest: T
  original: T
}

/**
 * The caption look: `original` is the one the delivered video was rendered with (null:
 * before saved looks, so the old default caption), `latest` the one the user is looking at
 * (saved, or ahead of the save). Unset fields mean the kind's defaults on both sides.
 */
export interface CaptionStyleRenderSetting extends RenderSettingField<CaptionStyleSettings | null> {
  /** The video's frame ('9:16'): where the old default caption sat depends on it. */
  aspectRatio: string
  /** Which default look applies when nothing is chosen (loops start in Punch). */
  kind: CaptionKind
  /** The project's look was read: until then an export leaves the look to the server. */
  known: boolean
}

export interface RenderSettings {
  captionEnabled: RenderSettingField<boolean>
  captionStyle: CaptionStyleRenderSetting
}

const initialRenderSettings: RenderSettings = {
  captionEnabled: { original: false, latest: false },
  captionStyle: { aspectRatio: '9:16', kind: 'video', known: false, latest: null, original: null },
}

/**
 * The look the user is looking at draws differently from the one the delivered video has.
 * `captionsOn`: the caption switch's latest value (off, only a loop's stamps show the look).
 */
export function captionStyleRenderChanged(
  setting: CaptionStyleRenderSetting,
  captionsOn: boolean,
): boolean {
  return (
    setting.known &&
    captionStyleNeedsRender(setting.original, setting.latest, { ...setting, captionsOn })
  )
}

export const renderSettingsAtom = atom<RenderSettings>(initialRenderSettings)
renderSettingsAtom.debugLabel = 'longtake.history.renderSettings'

const lastSeededProjectIdAtom = atom('')
lastSeededProjectIdAtom.debugLabel = 'longtake.history.renderSettings.lastSeededProjectId'

/**
 * Render settings carry no project identity, so a viewer opened on another
 * project would inherit the previous project's caption baseline. Seeding a
 * different project starts from scratch; reseeding the same one keeps the live
 * state. BGM flags are keyed by project and survive the switch on their own.
 */
export const seedRenderSettingsProjectAtom = atom(null, (get, set, projectId: string) => {
  if (!projectId || get(lastSeededProjectIdAtom) === projectId) {
    return
  }
  set(lastSeededProjectIdAtom, projectId)
  set(renderSettingsAtom, initialRenderSettings)
})
seedRenderSettingsProjectAtom.debugLabel = 'longtake.history.renderSettings.seedProject'

/**
 * Projects whose BGM settings write landed but whose delivered file the server
 * could not remux (no bed yet, or nothing delivered). The project row now says
 * music off while `resultVideo` still carries it, so an instant download would
 * serve the old mix; only a re-render, which resolves BGM server-side, produces
 * the file the user asked for. Keyed by project: a write settling after the
 * user navigated away must gate the project it was made on, not the open one.
 */
const bgmRenderRequiredByProjectAtom = atom<Record<string, boolean>>({})
bgmRenderRequiredByProjectAtom.debugLabel = 'longtake.history.bgmRenderRequiredByProject'

export const setBgmRenderRequiredAtom = atom(
  null,
  (get, set, params: { projectId: string; required: boolean }) => {
    if (!params.projectId) {
      return
    }
    set(bgmRenderRequiredByProjectAtom, {
      ...get(bgmRenderRequiredByProjectAtom),
      [params.projectId]: params.required,
    })
  },
)
setBgmRenderRequiredAtom.debugLabel = 'longtake.history.setBgmRenderRequired'

export const bgmRenderRequiredAtom = atom(
  (get) => get(bgmRenderRequiredByProjectAtom)[get(openProjectIdAtom)] ?? false,
)
bgmRenderRequiredAtom.debugLabel = 'longtake.history.bgmRenderRequired'

export const renderSettingsChangedAtom = atom((get) => {
  const s = get(renderSettingsAtom)
  return (
    s.captionEnabled.original !== s.captionEnabled.latest ||
    captionStyleRenderChanged(s.captionStyle, s.captionEnabled.latest)
  )
})
renderSettingsChangedAtom.debugLabel = 'longtake.history.renderSettings.changed'

/**
 * The non-content half of the render decision. Shared so the inpaint exporter,
 * which derives content changes from the server revision rather than the
 * history base state, cannot drift from the main export path.
 */
export const settingsRenderRequiredAtom = atom(
  (get) => get(renderSettingsChangedAtom) || get(bgmRenderRequiredAtom),
)
settingsRenderRequiredAtom.debugLabel = 'longtake.history.settingsRenderRequired'

export const captionPreferencesAtom = atomWithPersistence<Record<string, boolean>>(
  'longtake:caption-preferences',
  {},
  { preload: false },
)

/**
 * The ONE way to change the caption choice, shared by every surface that
 * offers the toggle (viewer DetailPanel, v1 StorySequencer, v2 editor,
 * inpaint editor). Writes BOTH stores every toggle:
 * - renderSettingsAtom.latest -- the live value the current session reads
 * - captionPreferencesAtom[projectId] -- the persisted per-project choice
 *   that survives refresh/days and carries project identity (the hydration
 *   sync's tie-breaker on the next mount)
 * A surface writing only the live atom left the persisted preference stale,
 * so a later session resurrected the OLD choice.
 */
export const setCaptionChoiceAtom = atom(
  null,
  (get, set, params: { next: boolean; projectId: string }) => {
    const prev = get(renderSettingsAtom)
    set(renderSettingsAtom, {
      ...prev,
      captionEnabled: { ...prev.captionEnabled, latest: params.next },
    })
    if (params.projectId) {
      set(captionPreferencesAtom, {
        ...get(captionPreferencesAtom),
        [params.projectId]: params.next,
      })
    }
  },
)
setCaptionChoiceAtom.debugLabel = 'longtake.history.setCaptionChoice'

const historyStorageAtom = atom<Record<string, LongTakeHistory>>({})
historyStorageAtom.debugLabel = 'longtake.history.storage'

const currentTransitionTopologyAtom = (() => {
  let cachedTransitions: LongTakeTransition[] = []
  let cachedResult: null | TransitionTopology = null
  return atom((get) => {
    const transitions = get(currentStateAtom)?.transitions ?? []
    const structureUnchanged =
      cachedResult !== null &&
      transitions.length === cachedTransitions.length &&
      transitions.every(
        (t, i) =>
          t.transitionId === cachedTransitions[i].transitionId &&
          t.fromShotId === cachedTransitions[i].fromShotId &&
          t.toShotId === cachedTransitions[i].toShotId,
      )
    if (structureUnchanged) {
      return cachedResult
    }
    cachedTransitions = transitions
    cachedResult = buildTransitionTopology(transitions)
    return cachedResult
  })
})()
currentTransitionTopologyAtom.debugLabel = 'longtake.history.currentTransitionTopology'

export const historyAtom = atom(
  (get) => {
    const projectId = get(projectIdAtom)
    if (!projectId) {
      return createEmptyHistory('')
    }
    return get(historyStorageAtom)[projectId] ?? createEmptyHistory(projectId)
  },
  (get, set, update: LongTakeHistory) => {
    const projectId = get(projectIdAtom)
    if (!projectId) {
      return
    }
    const all = get(historyStorageAtom)
    const next = { ...all, [projectId]: update }
    set(historyStorageAtom, next)
    storageAdapter.setAll(next)
    scheduleDraftSave(update, get(currentStateAtom))
  },
)
historyAtom.debugLabel = 'longtake.history.history'

export const baseRevisionAtom = atom((get) => get(historyAtom).baseRevision ?? '')
baseRevisionAtom.debugLabel = 'longtake.history.baseRevision'

export const canUndoAtom = atom((get) => get(historyAtom).past.length > 0)
canUndoAtom.debugLabel = 'longtake.history.canUndo'

export const canRedoAtom = atom((get) => get(historyAtom).future.length > 0)
canRedoAtom.debugLabel = 'longtake.history.canRedo'

export const regeneratingTransitionIdsAtom = atom<Set<string>>(new Set<string>())
regeneratingTransitionIdsAtom.debugLabel = 'longtake.history.regeneratingTransitionIds'

export const initializeHistoryAtom = atom(
  null,
  async (
    _get,
    set,
    {
      projectId,
      currentState,
      fetchApiDomain,
    }: {
      currentState: LongTakeEditorState
      fetchApiDomain: FetchApiDomain
      projectId: string
    },
  ) => {
    suppressDraftSave = true
    try {
      try {
        await storageAdapter.waitForInitialization()
      } catch (err) {
        nsLogger.error('Storage init failed:', err)
      }

      set(projectIdAtom, projectId)
      // Tracks the state being loaded here, and survives the viewer unmount
      // that clears projectIdAtom (see editedProjectIdAtom).
      set(editedProjectIdAtom, projectId)
      set(baseStateAtom, currentState)

      const baseRevision = buildLongTakeEditorRevision(currentState)
      const all = storageAdapter.getAll()
      const existing = all[projectId]
      const localPast = existing?.baseRevision === baseRevision ? existing.past : []

      if (existing && existing.baseRevision !== baseRevision) {
        nsLogger.warn(
          existing.baseRevision
            ? `Discarding incompatible history for ${projectId}; base revision changed since the last editing session`
            : `Discarding incompatible history for ${projectId}; persisted history is missing a base revision`,
        )
      }

      // Seed this project's state synchronously, before awaiting the draft GET,
      // so a load that follows another project never shows the previous project's
      // state while the fetch is in flight (the render hooks prefer this atom).
      set(currentStateAtom, replaySnapshots(currentState, localPast))
      set(historyAtom, { baseRevision, future: [], past: localPast, projectId })

      // The server draft is the cross-browser source of truth: adopt it when its
      // base revision matches and its snapshots replay cleanly. Snapshots are
      // stored verbatim (unknown[]), so a schema-drifted draft must fall back to
      // the local cache rather than throw and wedge editor load.
      lastDraftUpdatedAt = null
      draftSaveConflicted = false
      // Written via getDefaultStore(), not the passed `set`, to match
      // flushPendingDraftSave -- this atom is always read/written on the
      // default store regardless of which store's initializeHistoryAtom ran.
      getDefaultStore().set(draftSaveConflictAtom, false)
      try {
        const serverDraft = await getLongTakeEditorDraft(fetchApiDomain, projectId)
        lastDraftUpdatedAt = serverDraft?.updatedAt ?? null
        if (serverDraft && serverDraft.baseRevision === baseRevision) {
          const serverPast = serverDraft.snapshots as LongTakeSnapshot[]
          const serverWorkingState =
            serverDraft.workingState ?? replaySnapshots(currentState, serverPast)
          set(currentStateAtom, serverWorkingState)
          set(historyAtom, { baseRevision, future: [], past: serverPast, projectId })
        }
      } catch (err) {
        nsLogger.error('Server draft unusable; keeping local history:', err)
      }

      draftApiClient = fetchApiDomain
    } finally {
      suppressDraftSave = false
    }
  },
)
initializeHistoryAtom.debugLabel = 'longtake.history.initialize'

export const recordSnapshotAtom = atom(null, (get, set, snapshot: LongTakeSnapshot) => {
  const history = get(historyAtom)

  // Push snapshot into past; cap at MAX_HISTORY
  let newPast = [...history.past, snapshot]
  if (newPast.length > MAX_HISTORY) {
    newPast = newPast.slice(-MAX_HISTORY)
  }

  // Recording a new action clears the future (redo) stack
  set(historyAtom, { ...history, future: [], past: newPast })

  storageAdapter.cleanup(history.projectId, MAX_HISTORY).catch((err) => {
    nsLogger.error('Cleanup failed:', err)
  })
})
recordSnapshotAtom.debugLabel = 'longtake.history.recordSnapshot'

export const applyRegeneratedKeyframeAtom = atom(
  null,
  (
    get,
    set,
    input: {
      frameRole: KeyframeFrameRole
      keyframeUrl: string
      thumbnailUrl?: string
      transitionId: string
    },
  ): boolean => {
    const currentState = get(currentStateAtom)
    if (!currentState) {
      return false
    }

    const result = applyKeyframeEditToState(currentState, input)
    if (!result) {
      return false
    }

    set(currentStateAtom, result.nextState)
    set(recordSnapshotAtom, {
      id: makeSnapshotId(),
      patch: result.patch,
      timestamp: Date.now(),
    })
    return true
  },
)
applyRegeneratedKeyframeAtom.debugLabel = 'longtake.history.applyRegeneratedKeyframe'

export const transitionRegenerateContextAtom = atom(
  (get) => (transitionId: string, prompt: string) =>
    buildTransitionRegenerateContext(
      get(historyAtom).past,
      get(currentStateAtom),
      prompt,
      transitionId,
    ),
)
transitionRegenerateContextAtom.debugLabel = 'longtake.history.transitionRegenerateContext'

export const applyRegeneratedTransitionsAtom = atom(
  null,
  (get, set, input: ApplyRegeneratedTransitionsInput): boolean => {
    const currentState = get(currentStateAtom)
    if (!currentState) {
      return false
    }

    const freshTransitions: LongTakeTransition[] | null =
      'workflowResults' in input
        ? buildUpdatedTransitionsFromWorkflowResults(
            currentState,
            input.affectedTransitionIds,
            input.workflowResults,
          )
        : input.freshTransitions

    if (!freshTransitions || freshTransitions.length === 0) {
      return false
    }

    const affectedIds = new Set(input.affectedTransitionIds)
    const freshTransitionMap = new Map(
      freshTransitions.map((transition) => [transition.transitionId, transition]),
    )
    const nextTransitions = currentState.transitions
      .map((transition) => freshTransitionMap.get(transition.transitionId))
      .filter((transition): transition is LongTakeTransition => Boolean(transition))
      .filter((transition) => affectedIds.has(transition.transitionId))

    if (nextTransitions.length === 0) {
      return false
    }

    const prevTransitions = currentState.transitions.filter((transition) =>
      affectedIds.has(transition.transitionId),
    )
    const nextState = mergeRegeneratedTransitionsIntoState(currentState, nextTransitions)

    set(currentStateAtom, nextState)
    set(recordSnapshotAtom, {
      id: makeSnapshotId(),
      patch: {
        action: 'transition_regen',
        next: nextTransitions,
        prev: prevTransitions,
        transitionIds: nextTransitions.map((transition) => transition.transitionId),
      },
      timestamp: Date.now(),
    })
    return true
  },
)
applyRegeneratedTransitionsAtom.debugLabel = 'longtake.history.applyRegeneratedTransitions'

export const undoAtom = atom(null, (get, set) => {
  const history = get(historyAtom)
  if (history.past.length === 0) {
    return
  }

  // Pop the most recent snapshot from past
  const snapshot = history.past[history.past.length - 1]
  const newPast = history.past.slice(0, -1)

  // Apply the 'prev' patch before writing historyAtom: the historyAtom setter
  // schedules the draft save from get(currentStateAtom), so the working state
  // must already reflect the undo or the persisted draft lags one step.
  const currentState = get(currentStateAtom)
  if (currentState) {
    set(currentStateAtom, applyPatchToState(currentState, snapshot.patch, 'prev'))
  }

  // Move snapshot to future
  set(historyAtom, {
    ...history,
    future: [snapshot, ...history.future],
    past: newPast,
  })
})
undoAtom.debugLabel = 'longtake.history.undo'

export const redoAtom = atom(null, (get, set) => {
  const history = get(historyAtom)
  if (history.future.length === 0) {
    return
  }

  // Pop the next snapshot from future
  const snapshot = history.future[0]
  const newFuture = history.future.slice(1)

  // Apply the 'next' patch before writing historyAtom so the draft save the
  // historyAtom setter schedules captures the post-redo working state.
  const currentState = get(currentStateAtom)
  if (currentState) {
    set(currentStateAtom, applyPatchToState(currentState, snapshot.patch, 'next'))
  }

  // Move snapshot back to past
  set(historyAtom, {
    ...history,
    future: newFuture,
    past: [...history.past, snapshot],
  })
})
redoAtom.debugLabel = 'longtake.history.redo'

export const commitRenderBaselineAtom = atom(
  null,
  (get, set, nextBaseState?: LongTakeEditorState) => {
    const currentState = get(currentStateAtom)
    const history = get(historyAtom)
    const baseState = nextBaseState ?? currentState
    if (!currentState || !baseState) {
      return
    }

    set(baseStateAtom, baseState)
    set(historyAtom, {
      ...history,
      baseRevision: buildLongTakeEditorRevision(baseState),
      future: [],
      past: [],
    })
  },
)
commitRenderBaselineAtom.debugLabel = 'longtake.history.commitRenderBaseline'

export const commitRenderSettingsBaselineAtom = atom(
  null,
  (get, set, params: { projectId: string; submitted: LongTakeRenderSettings | undefined }) => {
    // The project the render was submitted for, not whatever is open now: a
    // render can complete after the user navigated to another project.
    set(setBgmRenderRequiredAtom, { projectId: params.projectId, required: false })
    const submitted = params.submitted
    if (!submitted) {
      return
    }
    const current = get(renderSettingsAtom)
    set(renderSettingsAtom, {
      ...current,
      captionEnabled: {
        original: submitted.captionEnabled ?? current.captionEnabled.original,
        latest: submitted.captionEnabled ?? current.captionEnabled.latest,
      },
      // The video now has the look it was rendered with, defaults filled in like the
      // render records them (null here is no longer "before saved looks"). `latest` stays
      // the live look: a change made while it rendered still needs a render.
      captionStyle:
        submitted.captionStyle === undefined
          ? current.captionStyle
          : {
              ...current.captionStyle,
              original: effectiveCaptionStyle(submitted.captionStyle, current.captionStyle.kind),
            },
    })
  },
)
commitRenderSettingsBaselineAtom.debugLabel = 'longtake.history.renderSettings.commitBaseline'

const _staleInputsAtom = atom((get) => ({
  past: get(historyAtom).past,
  topology: get(currentTransitionTopologyAtom),
}))

export const staleTransitionIdsAtom = selectAtom(
  _staleInputsAtom,
  ({ past, topology }) =>
    topology ? computeStaleTransitionIds(past, topology) : new Set<string>(),
  setsEqual,
)
staleTransitionIdsAtom.debugLabel = 'longtake.history.staleTransitionIds'

const _maskedInputsAtom = atom((get) => ({
  topology: get(currentTransitionTopologyAtom),
  staleIds: get(staleTransitionIdsAtom),
}))

export const maskedKeyframeIdsAtom = selectAtom(
  _maskedInputsAtom,
  ({ topology, staleIds }) =>
    topology ? getMaskedKeyframeIds(topology, staleIds) : new Set<string>(),
  setsEqual,
)
maskedKeyframeIdsAtom.debugLabel = 'longtake.history.maskedKeyframeIds'

export const renderRequiredAtom = atom(
  (get) =>
    hasRenderRelevantChanges(get(baseStateAtom), get(currentStateAtom)) ||
    get(settingsRenderRequiredAtom),
)
renderRequiredAtom.debugLabel = 'longtake.history.renderRequired'

export const longtakeHistoryStore = {
  applyRegeneratedKeyframeAtom,
  applyRegeneratedTransitionsAtom,
  baseStateAtom,
  baseRevisionAtom,
  bgmRenderRequiredAtom,
  canRedoAtom,
  canUndoAtom,
  commitRenderBaselineAtom,
  commitRenderSettingsBaselineAtom,
  currentStateAtom,
  draftSaveConflictAtom,
  editedProjectIdAtom,
  flushPendingDraftSave,
  historyAtom,
  initializeHistoryAtom,
  projectIdAtom,
  recordSnapshotAtom,
  redoAtom,
  renderRequiredAtom,
  renderSettingsAtom,
  renderSettingsChangedAtom,
  seedRenderSettingsProjectAtom,
  setBgmRenderRequiredAtom,
  settingsRenderRequiredAtom,
  maskedKeyframeIdsAtom,
  staleTransitionIdsAtom,
  transitionRegenerateContextAtom,
  regeneratingTransitionIdsAtom,
  undoAtom,
}
