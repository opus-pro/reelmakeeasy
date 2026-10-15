import { getWorkflowId } from './workflow-id'

// Persisted on every session at creation as a forensic/analytics marker. All
// sessions are 'v2'; the field no longer drives
// workflow-id routing. 'v1' is kept in the union only to type legacy rows.
export type UipWorkflowVersion = 'v1' | 'v2'

export const UIP_V2_WORKFLOW_TYPE = 'UipSessionV2Workflow'

/**
 * Resolve the UIP-session workflow id for a project. All sessions are V2,
 * so the id always carries the `:uip-v2` suffix.
 */
export function getUipWorkflowId(projectId: string): string {
  return `${getWorkflowId(projectId, 'uip', 'session')}:uip-v2`
}

/** All sessions run the V2 event-log workflow. */
export function getUipWorkflowType(): string {
  return UIP_V2_WORKFLOW_TYPE
}
