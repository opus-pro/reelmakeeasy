import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'

/** Identifies a long-take run's admission slot and its entry in the in-flight set. */
export interface LongTakeSlotParams {
  admissionTier?: LongTakeAdmissionTier
  projectId: string
  workflowId: string
}
