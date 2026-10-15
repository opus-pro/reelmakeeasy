export type PhaseStatus = 'done' | 'error' | 'idle' | 'running'

export type ProgressValue = number // 0..1

export declare const SUBAGENT_NAMES: readonly [
  'scriptWriterAgent',
  'hookSupervisorAgent',
  'storyLoaderAgent',
  'storyboardAgent',
  'videoCrewAgent',
]

export type PhaseProgressMap = Readonly<Record<SubAgentName, PhaseProgressState>>

export interface PhaseProgressState {
  doneSteps?: number
  endAt?: number
  startAt?: number
  status: PhaseStatus
  totalSteps?: number
}

export type SubAgentName = (typeof SUBAGENT_NAMES)[number]

export interface UnifiedProgressEvent {
  currentPhase?: SubAgentName
  currentTool?: string
  updatedAt: number
  value: ProgressValue
}

export declare const PHASE_WEIGHTS: Readonly<Record<SubAgentName, number>>

export type ComputedProgressItem = {
  resultVideoThumbnailUpdatedAt?: string
  resultVideoThumbnailUrl?: string
  scenePreviewSceneId?: string
  scenePreviewUrl?: string
  target: number
  targetPhase: 'directorThinking' | null | SubAgentName
  value: number
}

export type PhaseFieldKey<N extends SubAgentName, F extends PhaseFieldName> = `phase:${N}:${F}`

export type PhaseFieldName = 'doneSteps' | 'endAt' | 'startAt' | 'status' | 'totalSteps'

export type ProgressBulkItem = ComputedProgressItem & {
  nextTargetRemainingMs: number
  projectId: string
  rawValue: number
  remainingMs: number
  updatedAt: number
}

export type ProgressKey<T extends string = string> = `agent:progress:${T}`
