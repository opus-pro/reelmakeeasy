export interface AdmissionControlConfig {
  admissionTaskQueue: string
  freeCapacity: number
  paidCapacity: number
  pollMs: number
  slotMaxAgeMs: number
  spillover: boolean
  startConcurrency: number
  workflowTaskQueue: string
}

export interface AdmissionControlParams extends AdmissionControlConfig {
  cycleCount?: number
}

export interface StoryModeAdmissionCycleResult {
  activeFree: number
  activePaid: number
  admittedFree: number
  admittedPaid: number
  effectiveFreeCapacity: number
  effectivePaidCapacity: number
  effectiveSpillover: boolean
  queueDepthFree: number
  queueDepthPaid: number
}
