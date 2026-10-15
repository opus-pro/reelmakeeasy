import type {
  CaptionTrack,
  MediaTrack,
  TemplateAssetTrack,
  VideoScript,
} from '@reelmakeeasy/common/types/video-script'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import { atom } from 'jotai'
import { atomWithStorage } from 'jotai/utils'
import { isEqual } from 'lodash-es'

import { HistoryStorageAdapter } from '../utils/history-storage-adapter'

const nsLogger = Logger.get('project.editor-history-store')

export interface EditorHistory {
  baseVersion: null | VideoScript
  future: VersionSnapshot[]
  past: VersionSnapshot[]
  present: null | VersionSnapshot
  projectId: string
}

export type ShotMeta = {
  prompt?: string
  thumbnail?: string
}

export type ShotMetaMap = Record<string, ShotMeta>

export interface VersionSnapshot {
  description?: string
  id: string
  shotMeta?: ShotMetaMap
  timestamp: number
  videoScript: VideoScript
}

type TrackSegments =
  | CaptionTrack['segments']
  | MediaTrack['segments']
  | TemplateAssetTrack['segments']

const MAX_HISTORY = 30

const storageAdapter = new HistoryStorageAdapter()

const initializationLocks = new Map<string, Promise<VideoScript>>()

function createEmptyHistory(projectId: string): EditorHistory {
  return {
    baseVersion: null,
    future: [],
    past: [],
    present: null,
    projectId,
  }
}

const projectIdAtom = atom<string>('')
projectIdAtom.debugLabel = 'editor.history.projectId'

const historyStorageAtom = atomWithStorage<Record<string, EditorHistory>>(
  'editor-histories',
  {},
  {
    getItem: (key: string, initialValue: Record<string, EditorHistory>) => {
      try {
        return storageAdapter.getAll() || initialValue
      } catch (error) {
        nsLogger.error(`Failed to get ${key}:`, error)
        return initialValue
      }
    },
    setItem: (key: string, value: Record<string, EditorHistory>) => {
      try {
        storageAdapter.setAll(value)
      } catch (error) {
        nsLogger.error(`Failed to set ${key}:`, error)
        throw error
      }
    },
    removeItem: (key: string) => {
      storageAdapter.clear()
    },
  },
)
historyStorageAtom.debugLabel = 'editor.history.storage'

const historyAtom = atom(
  (get) => {
    const projectId = get(projectIdAtom)
    if (!projectId) {
      return createEmptyHistory('')
    }

    const histories = get(historyStorageAtom)
    return histories[projectId] || createEmptyHistory(projectId)
  },
  (get, set, update: EditorHistory) => {
    const projectId = get(projectIdAtom)
    if (!projectId) {
      return
    }

    const histories = get(historyStorageAtom)
    set(historyStorageAtom, {
      ...histories,
      [projectId]: update,
    })
  },
)
historyAtom.debugLabel = 'editor.history.history'

const canUndoAtom = atom((get) => {
  const history = get(historyAtom)
  return history.past.length > 0
})
canUndoAtom.debugLabel = 'editor.history.canUndo'

const canRedoAtom = atom((get) => {
  const history = get(historyAtom)
  return history.future.length > 0
})
canRedoAtom.debugLabel = 'editor.history.canRedo'

const hasLocalChangesAtom = atom((get) => {
  const history = get(historyAtom)
  return history.past.length > 0 || history.future.length > 0
})
hasLocalChangesAtom.debugLabel = 'editor.history.hasLocalChanges'

const hasUnsyncedChangesAtom = atom((get) => {
  const history = get(historyAtom)
  if (!history.present) {
    return false
  }
  if (!history.baseVersion) {
    return true
  }

  const presentTracks = normalizeVideoScriptForCompare(history.present.videoScript)
  const baseTracks = normalizeVideoScriptForCompare(history.baseVersion)
  return !isEqual(presentTracks, baseTracks)
})
hasUnsyncedChangesAtom.debugLabel = 'editor.history.hasUnsyncedChanges'

const shotMetaAtom = atom((get) => {
  return get(historyAtom).present?.shotMeta ?? {}
})
shotMetaAtom.debugLabel = 'editor.history.shotMeta'

function createSnapshot(
  videoScript: VideoScript,
  description?: string,
  shotMeta: ShotMetaMap = {},
): VersionSnapshot {
  return {
    description,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
    shotMeta,
    timestamp: Date.now(),
    videoScript,
  }
}

const OMIT_KEYS = new Set(['id', 'previewSourceUri'])
const FLOAT_ROUND_DIGITS = 6

function normalizeArray(values: unknown[]): unknown[] {
  const normalized = values
    .map((value) => normalizeValue(value))
    .filter((value) => value !== undefined)

  if (normalized.length === 0) {
    return []
  }

  const shouldSortByFrameTime =
    normalized.length > 0 &&
    normalized.every(
      (value) =>
        value &&
        typeof value === 'object' &&
        'frameTime' in value &&
        typeof (value as { frameTime?: unknown }).frameTime === 'number',
    )

  if (shouldSortByFrameTime) {
    return [...normalized].sort((a, b) => {
      const aTime = (a as { frameTime: number }).frameTime
      const bTime = (b as { frameTime: number }).frameTime
      return aTime - bTime
    })
  }

  return normalized
}

function normalizeNumber(value: number): number {
  if (Object.is(value, -0)) {
    return 0
  }
  const factor = 10 ** FLOAT_ROUND_DIGITS
  return Math.round(value * factor) / factor
}

function normalizeObject(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const normalizedEntries = Object.entries(value)
    .filter(([key]) => !OMIT_KEYS.has(key))
    .map(([key, entry]) => [key, normalizeValue(entry)] as const)
    .filter(([, entry]) => entry !== undefined)

  if (normalizedEntries.length === 0) {
    return undefined
  }

  return Object.fromEntries(normalizedEntries)
}

function normalizeSegments(segments: TrackSegments | undefined): TrackSegments | undefined {
  if (!segments || segments.length === 0) {
    return segments
  }
  return [...segments].sort((a, b) => {
    const aIn = a.timeline?.in ?? 0
    const bIn = b.timeline?.in ?? 0
    if (aIn !== bIn) {
      return aIn - bIn
    }
    const aOut = a.timeline?.out ?? 0
    const bOut = b.timeline?.out ?? 0
    return aOut - bOut
  }) as TrackSegments
}

function normalizeTrack<T extends CaptionTrack | MediaTrack | TemplateAssetTrack>(track: T) {
  return normalizeValue({
    ...track,
    segments: normalizeSegments(track.segments),
  })
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  if (typeof value === 'number') {
    return normalizeNumber(value)
  }
  if (Array.isArray(value)) {
    return normalizeArray(value)
  }
  if (typeof value === 'object') {
    return normalizeObject(value as Record<string, unknown>)
  }
  return value
}

function normalizeVideoScriptForCompare(videoScript: VideoScript) {
  const templateTrack = videoScript.tracks.find(
    (t): t is TemplateAssetTrack => t.type === 'template-asset',
  )
  const hookTrack = videoScript.tracks.find(
    (t): t is MediaTrack => t.type === 'media' && t.id === 'track-hook',
  )
  const captionTrack = videoScript.tracks.find((t): t is CaptionTrack => t.type === 'caption')

  return normalizeValue({
    captionTrack: captionTrack ? normalizeTrack(captionTrack) : undefined,
    hookTrack: hookTrack ? normalizeTrack(hookTrack) : undefined,
    templateTrack: templateTrack ? normalizeTrack(templateTrack) : undefined,
  })
}

const initializeHistoryAtom = atom(
  null,
  async (
    get,
    set,
    { projectId, videoScript }: { projectId: string; videoScript: VideoScript },
  ): Promise<VideoScript> => {
    const existingLock = initializationLocks.get(projectId)
    if (existingLock) {
      await existingLock
      const histories = get(historyStorageAtom)
      const existingHistory = histories[projectId]
      return existingHistory?.present?.videoScript ?? videoScript
    }

    const initPromise = (async (): Promise<VideoScript> => {
      try {
        await storageAdapter.waitForInitialization()

        set(projectIdAtom, projectId)

        const histories = get(historyStorageAtom)
        const existingHistory = histories[projectId]

        if (existingHistory && existingHistory.present) {
          const updatedHistory: EditorHistory = {
            ...existingHistory,
            baseVersion: videoScript,
          }
          set(historyAtom, updatedHistory)
          return existingHistory.present.videoScript
        }

        const initialSnapshot = createSnapshot(videoScript, 'Initial state')
        const newHistory: EditorHistory = {
          baseVersion: videoScript,
          future: [],
          past: [],
          present: initialSnapshot,
          projectId,
        }

        try {
          set(historyAtom, newHistory)
        } catch (error) {
          const err = ensureError(error)
          nsLogger.error('Failed to initialize history:', err)
        }

        return videoScript
      } finally {
        initializationLocks.delete(projectId)
      }
    })()

    initializationLocks.set(projectId, initPromise)
    return await initPromise
  },
)
initializeHistoryAtom.debugLabel = 'editor.history.initialize'

const recordSnapshotAtom = atom(
  null,
  async (
    get,
    set,
    {
      videoScript,
      description,
      shotMeta,
    }: { description?: string; shotMeta?: ShotMetaMap; videoScript: VideoScript },
  ) => {
    const history = get(historyAtom)
    if (!history.present) {
      return
    }

    const nextShotMeta = shotMeta ?? history.present.shotMeta ?? {}
    const newSnapshot = createSnapshot(videoScript, description, nextShotMeta)

    let newPast = [...history.past, history.present]
    if (newPast.length > MAX_HISTORY) {
      newPast = newPast.slice(-MAX_HISTORY)
    }

    const newHistory: EditorHistory = {
      ...history,
      future: [],
      past: newPast,
      present: newSnapshot,
    }

    try {
      set(historyAtom, newHistory)

      await storageAdapter.cleanup(history.projectId, MAX_HISTORY)
    } catch (error) {
      const err = ensureError(error)
      nsLogger.error('Failed to record snapshot:', err)
    }
  },
)
recordSnapshotAtom.debugLabel = 'editor.history.recordSnapshot'

const undoAtom = atom(null, (get, set) => {
  const history = get(historyAtom)
  if (history.past.length === 0 || !history.present) {
    return null
  }

  const previous = history.past[history.past.length - 1]
  const newPast = history.past.slice(0, -1)

  const newHistory: EditorHistory = {
    ...history,
    future: [history.present, ...history.future],
    past: newPast,
    present: previous,
  }

  set(historyAtom, newHistory)
  return previous.videoScript
})
undoAtom.debugLabel = 'editor.history.undo'

const redoAtom = atom(null, (get, set) => {
  const history = get(historyAtom)
  if (history.future.length === 0 || !history.present) {
    return null
  }

  const next = history.future[0]
  const newFuture = history.future.slice(1)

  const newHistory: EditorHistory = {
    ...history,
    future: newFuture,
    past: [...history.past, history.present],
    present: next,
  }

  set(historyAtom, newHistory)
  return next.videoScript
})
redoAtom.debugLabel = 'editor.history.redo'

const resetHistoryHead = atom(null, (get, set, videoScript: VideoScript) => {
  const history = get(historyAtom)
  if (!history.present) {
    return
  }

  const newSnapshot = createSnapshot(
    videoScript,
    'Reset history head',
    history.present.shotMeta ?? {},
  )
  const newHistory: EditorHistory = {
    ...history,
    past: [],
    future: [],
    present: newSnapshot,
  }

  set(historyAtom, newHistory)
})
resetHistoryHead.debugLabel = 'editor.history.resetHistoryHead'

const updateBaseVersionAtom = atom(null, (get, set, videoScript: VideoScript) => {
  const history = get(historyAtom)
  if (!history.present) {
    return
  }

  const newHistory: EditorHistory = {
    ...history,
    baseVersion: videoScript,
  }

  set(historyAtom, newHistory)
})
updateBaseVersionAtom.debugLabel = 'editor.history.updateBaseVersion'

export const editorHistoryStore = {
  projectIdAtom,
  historyAtom,
  canUndoAtom,
  canRedoAtom,
  hasLocalChangesAtom,
  hasUnsyncedChangesAtom,
  initializeHistoryAtom,
  recordSnapshotAtom,
  shotMetaAtom,
  undoAtom,
  redoAtom,
  resetHistoryHead,
  updateBaseVersionAtom,
}
