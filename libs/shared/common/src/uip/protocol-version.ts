/**
 * 2026-05-11: API-owned input inbox
 * - New sessions use state.input_inbox as durable SOT for user input
 * - Activity calls /next-action to get the authoritative decision (cancel-safe, serial)
 * - All UI operations write to state then send a wake signal; no semantic payload in signal
 */
export const WORKFLOW_PROTOCOL_V1_API_INBOX = '2026-05-11T00:00:00.000Z' as const

export const CURRENT_WORKFLOW_PROTOCOL_VERSION = WORKFLOW_PROTOCOL_V1_API_INBOX

export const API_INBOX_WORKFLOW_PROTOCOL_SINCE = WORKFLOW_PROTOCOL_V1_API_INBOX

export function supportsWorkflowProtocolFeature(
  workflowProtocolVersion: string | undefined,
  featureSince: string,
): boolean {
  return Boolean(workflowProtocolVersion && workflowProtocolVersion >= featureSince)
}
