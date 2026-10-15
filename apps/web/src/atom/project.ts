import { LOCAL_USER_ID } from '@reelmakeeasy/common/auth/local-identity'
import { ProgressBulkItem } from '@shared/types/agent/progress'
import { SceneDataForCanvas } from '@shared/types/api'
import { Project } from '@shared/types/api/project'
import { ChatBoxMessage } from '@shared/types/chat/message'
import {
  EmbeddedAttachmentBlock,
  EmbeddedBlockMessage,
  EmbeddedNeedApproveBlock,
  EmbeddedSourceBlock,
  EmbeddedStoryboardBlock,
  EmbeddedTranscriptBlock,
  EmbeddedVideoBlock,
  EmbeddedVideoPlanBlock,
  EmbeddedViralHookBlock,
} from '@shared/types/chat/message-embedded-block'
import { atom, WritableAtom } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { atomFamily } from 'jotai-family'

import { evalValueUpdater, UpdaterFnOrValue } from '@/util/state-setter-fn'

export type CardCountdownInfo =
  | {
      active: boolean
      autoConfirmAt: number
      cardId?: string
      cardType: 'embedded-transcript'
      durationMs: number
      isConfirmed: boolean
      paused: boolean
      remainingMs: number
      startAt: string
    }
  | {
      autoConfirmAt: number
      cardId?: string
      cardType: 'embedded-viral-hook'
      durationMs: number
      isConfirmed: boolean
      remainingMs: number
      startAt: string
    }

type ProjectHistoryUpdater = UpdaterFnOrValue<ChatBoxMessage[]>

type ProjectProgressUpdater = UpdaterFnOrValue<ProgressBulkItem>

export const chatListConnectedAtom = atom<boolean>(false)
chatListConnectedAtom.debugLabel = 'chatListConnectedAtom'

export const chatListStreamingAtom = atom<boolean>(false)
chatListStreamingAtom.debugLabel = 'chatListStreamingAtom'

export const canceledProjectsSetAtom = atom<Set<string>>(new Set<string>())
canceledProjectsSetAtom.debugLabel = 'canceledProjectsSetAtom'

export const projectIdAtom = atom<string>('')
projectIdAtom.debugLabel = 'projectIdAtom'

const projectMsgDictAtom = atomFamily<
  string,
  WritableAtom<ChatBoxMessage[], [ProjectHistoryUpdater], unknown>
>(() => atom<ChatBoxMessage[]>([]))

export const projectHistoryAtom = atom(
  (get) => {
    const projectId = get(projectIdAtom)
    const msgList = get(projectMsgDictAtom(projectId))
    return msgList || []
  },
  (get, set, updater: ProjectHistoryUpdater) => {
    const projectId = get(projectIdAtom)
    const base = projectMsgDictAtom(projectId)
    set(base, evalValueUpdater(updater, get(base)))
  },
)
projectHistoryAtom.debugLabel = 'projectHistoryAtom'

type ProjectInfoUpdater = UpdaterFnOrValue<null | Project>

const projectInfoDictAtom = atomFamily<
  string,
  WritableAtom<null | Project, [ProjectInfoUpdater], unknown>
>(() => atom<null | Project>(null))

export const projectAtom = atom(
  (get) => {
    const projectId = get(projectIdAtom)
    return get(projectInfoDictAtom(projectId))
  },
  (get, set, updater: ProjectInfoUpdater) => {
    const projectId = get(projectIdAtom)
    const base = projectInfoDictAtom(projectId)
    set(base, evalValueUpdater(updater, get(base)))
  },
)
projectAtom.debugLabel = 'projectAtom'

type SceneListUpdater = UpdaterFnOrValue<SceneDataForCanvas[]>

const sceneListDictAtom = atomFamily<
  string,
  WritableAtom<SceneDataForCanvas[], [SceneListUpdater], unknown>
>(() => atom<SceneDataForCanvas[]>([]))

export const sceneListAtom = atom(
  (get) => {
    const projectId = get(projectIdAtom)
    return get(sceneListDictAtom(projectId))
  },
  (get, set, updater: SceneListUpdater) => {
    const projectId = get(projectIdAtom)
    const base = sceneListDictAtom(projectId)
    set(base, evalValueUpdater(updater, get(base)))
  },
)
sceneListAtom.debugLabel = 'sceneListAtom'

// Progress management
type ProjectProgressMapUpdater = UpdaterFnOrValue<Map<string, ProgressBulkItem>>

// Default progress item template (projectId should be assigned separately)
const DEFAULT_PROGRESS_ITEM: Omit<ProgressBulkItem, 'projectId'> = {
  rawValue: 0,
  nextTargetRemainingMs: 0,
  remainingMs: 0,
  target: 0,
  targetPhase: null,
  updatedAt: 0,
  value: 0,
}

// Central map to store all project progress
export const projectProgressMapAtom = atom<Map<string, ProgressBulkItem>>(new Map())
projectProgressMapAtom.debugLabel = 'projectProgressMapAtom'

// Updater atom for the progress map
export const updateProjectProgressAtom = atom(
  null,
  (get, set, updater: ProjectProgressMapUpdater) => {
    set(projectProgressMapAtom, evalValueUpdater(updater, get(projectProgressMapAtom)))
  },
)
updateProjectProgressAtom.debugLabel = 'updateProjectProgressAtom'

// Helper atom to update progress for a specific project
export const updateProjectProgressByIdAtom = atom(
  null,
  (get, set, projectId: string, data: ProgressBulkItem) => {
    const map = new Map(get(projectProgressMapAtom))
    map.set(projectId, data)
    set(projectProgressMapAtom, map)
  },
)
updateProjectProgressByIdAtom.debugLabel = 'updateProjectProgressByIdAtom'

// Family atom for backward compatibility - reads from the central map
export const projectProgressFamily = atomFamily<
  string,
  WritableAtom<ProgressBulkItem, [ProjectProgressUpdater], unknown>
>((projectId: string) =>
  atom(
    (get) => {
      const map = get(projectProgressMapAtom)
      return map.get(projectId) ?? { ...DEFAULT_PROGRESS_ITEM, projectId }
    },
    (get, set, updater: ProjectProgressUpdater) => {
      const currentValue = get(projectProgressMapAtom).get(projectId) ?? {
        ...DEFAULT_PROGRESS_ITEM,
        projectId,
      }
      const newValue = evalValueUpdater(updater, currentValue)
      set(updateProjectProgressByIdAtom, projectId, newValue)
    },
  ),
)

export type ProjectCardsRecord = Partial<{
  'embedded-attachment': EmbeddedAttachmentBlock
  'embedded-need-approve': EmbeddedNeedApproveBlock
  'embedded-source': EmbeddedSourceBlock
  'embedded-storyboard': EmbeddedStoryboardBlock
  'embedded-transcript': EmbeddedTranscriptBlock
  'embedded-video': EmbeddedVideoBlock
  'embedded-video-plan': EmbeddedVideoPlanBlock
  'embedded-viral-hook': EmbeddedViralHookBlock
}>

export const activeProjectMessageList = atom<ChatBoxMessage[]>((get) => {
  const replayMode = get(projectReplayModeAtom)
  if (replayMode) {
    return get(replayMsgListAtom)
  }
  return get(projectHistoryAtom)
})

export const projectCardRecordAtom = selectAtom<ChatBoxMessage[], ProjectCardsRecord>(
  activeProjectMessageList,
  (base) => {
    const cardMessages = base.filter(
      (msg) => msg.role === 'embedded-block' && msg.type && msg.id,
    ) as EmbeddedBlockMessage[]
    return Object.fromEntries(cardMessages.map((msg) => [msg.type, msg])) as ProjectCardsRecord
  },
  (a, b) =>
    Object.keys(a).length === Object.keys(b).length &&
    Object.keys(a).every(
      (key) => a[key as keyof ProjectCardsRecord]?.id === b[key as keyof ProjectCardsRecord]?.id,
    ),
)
projectCardRecordAtom.debugLabel = 'projectCardRecordAtom'

export type ReplayMsg = ChatBoxMessage & {
  currentMs?: number
  replayDurationMs?: number
  step?: number
  totalStep?: number
}
export const projectReplayFullHistoryAtom = atom<ReplayMsg[]>([])
projectReplayFullHistoryAtom.debugLabel = 'projectReplayFullHistoryAtom'

export const replayMsgListAtom = atom<ReplayMsg[]>([])
replayMsgListAtom.debugLabel = 'replayMsgListAtom'

export const projectReplayModeAtom = atom<boolean>(false)
projectReplayModeAtom.debugLabel = 'projectReplayModeAtom'

export const projectReplayStatusAtom = atom<{
  currentFrame: number
  direction: 'backward' | 'forward'
  durationMs: number
  playing: boolean
  ready: boolean
  seekAt: number
  startPlayedAt: number
  totalFrame: number
}>({
  playing: false,
  ready: false,
  durationMs: 50,
  direction: 'forward',
  seekAt: 0,
  currentFrame: 0,

  startPlayedAt: -1,
  totalFrame: 0,
})
projectReplayStatusAtom.debugLabel = 'projectReplayStatusAtom'

export const videoRefreshTimestampAtom = atom<number>(0)
videoRefreshTimestampAtom.debugLabel = 'videoRefreshTimestampAtom'

export type ReplayMsgDuration = Record<string, number> & {
  default: number
}

const replayDurationMsAtom = atom<ReplayMsgDuration>({
  default: 10,
  tool: 15,
  finish: 100,
  'text-delta': 30,
  text: 30,
  'tool-result': 5,
  'embedded-storyboard': 200,
  'embedded-transcript': 200,
  'embedded-video': 200,
  'embedded-viral-hook': 200,
  'embedded-source': 200,
  // 'embedded-feedback': 200,
  'embedded-attachment': 200,
  'project-patch': 0,
})
replayDurationMsAtom.debugLabel = 'replayDurationMsAtom'

export const isProjectOwnerAtom = atom<boolean>((get) => {
  const projectInfo = get(projectAtom)
  return projectInfo?.owner === LOCAL_USER_ID
})
isProjectOwnerAtom.debugLabel = 'isProjectOwnerAtom'

export const canEditProjectAtom = atom<boolean>((get) => get(isProjectOwnerAtom))
canEditProjectAtom.debugLabel = 'canEditProjectAtom'
