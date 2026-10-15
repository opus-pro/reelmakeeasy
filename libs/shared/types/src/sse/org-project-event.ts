export type OrgProjectEventAction =
  | 'created'
  | 'deleted'
  | 'processing-update'
  | 'seen-changed'
  | 'stage-changed'

export type OrgProjectStreamEventType = 'updated'
export const ORG_PROJECT_STREAM_EVENT_TYPE: OrgProjectStreamEventType = 'updated'

// Long-running processing kinds surfaced as per-user notifications.
export type ProcessingUpdateKind =
  | 'agent-review'
  | 'bgm-regen'
  | 'uip-script'
  | 'uip-storyboard'
  | 'uip-video'

export type ProcessingUpdateOutcome = 'action-required' | 'completed' | 'failed'
export type ProcessingUpdatePayload =
  | (ProcessingUpdateBase & {
      deadlineAt: null
      outcome: 'completed'
      processingType: 'uip-video'
      reviewMode: UipNotificationReviewMode
      uipSessionId: string
    })
  | (ProcessingUpdateBase & {
      deadlineAt: null | string
      outcome: 'action-required'
      processingType: 'uip-script' | 'uip-storyboard'
      reviewMode: UipNotificationReviewMode
      uipSessionId: string
    })
  | (ProcessingUpdateBase & {
      outcome: ProcessingUpdateOutcome
      processingType: Exclude<ProcessingUpdateKind, 'uip-script' | 'uip-storyboard' | 'uip-video'>
    })

export type UipNotificationReviewMode = 'auto' | 'manual'

type ProcessingUpdateBase = {
  action: 'processing-update'
  // Stable per-completion key (not per-frame) so SSE reconnect replays and
  // multi-tab delivery do not intentionally re-notify the same run.
  dedupeKey: string
  // Project.owner (JWT sub). The stream is org-scoped, so clients compare
  // this against their own login id to show only their notifications.
  ownerLoginId: null | string
  projectId: string
  projectTitle: null | string
  resource: OrgProjectEventResource
}

// Discriminated union: seen-changed carries a batch of ids; processing-update
// carries notification context; all other actions carry a single id.
export type OrgProjectEventPayload =
  | ProcessingUpdatePayload
  | {
      action: 'seen-changed'
      lastSeenAt: null | string
      projectIds: string[]
      resource: OrgProjectEventResource
    }
  | {
      action: Exclude<OrgProjectEventAction, 'processing-update' | 'seen-changed'>
      projectId: string
      resource: OrgProjectEventResource
      stage?: string
    }

export type OrgProjectEventResource = 'project'
