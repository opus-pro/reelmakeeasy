/**
 * Canonical signal/query NAME strings shared between the API service and the
 * UIP V2 workflow. Both sides import from here so the wire names can
 * never drift via a typo.
 *
 * Pure constants only - no workflow-engine imports and no
 * `defineSignal`/`defineQuery`. Those typed channel definitions are built on
 * top of these strings later (Phase 3); the strings themselves live here so the
 * API can reference them too.
 *
 * Keys are camelCase; values are the exact wire strings.
 */

/**
 * Inbound signal names reused from V1. The API already sends these to the V1
 * session workflow via `signalWorkflow(projectId, '<name>', payload)`; V2
 * registers handlers for the SAME names so the API code is unchanged.
 *
 * Verified against the V1 `defineSignal('...')` definitions in
 * `libs/story-mode-runtime/src/workflows/uip/types.ts` and cross-checked
 * against the API senders in `apps/services/api/src/uip/`.
 */
export const UIP_INBOUND_SIGNALS = {
  /** A single user chat message. */
  userMessage: 'uip-user-message',
  /** A batch of user chat messages. */
  userMessages: 'uip-user-messages',
  /** Passive browser activity heartbeat; resets inactivity without waking the planner. */
  userActivity: 'uip-user-activity',
  /** Confirm the current gate. */
  confirm: 'uip-confirm',
  /** Confirm-and-skip-ahead (fast path). */
  confirmFast: 'uip-confirm-fast',
  /** Resume a draft the agent paused on. */
  continueDraft: 'uip-continue-draft',
  /** GUI-side edit (e.g. transcript) pushed back into the session. */
  guiUpdate: 'uip-gui-update',
  /** Legacy-named but still actively sent by the API; V2 must handle it. */
  scriptReviewUpdate: 'uip-script-review-update',
  /** Cancel the whole session. */
  cancelSession: 'uip-cancel-session',
  /** Cancel a single running tool by name; the session stays alive. */
  cancelTool: 'uip-cancel-tool',
  /** @deprecated Legacy: cancel a single queued inbox item. */
  cancelQueuedItem: 'uip-cancel-queued-item',
  /** Nudge the main loop to drain pending work without new input. */
  wake: 'uip-wake',
  /** Flip the per-session auto-continue setting mid-session. */
  setAutoContinue: 'uip-set-auto-continue',
  /** Update the selected transition video model mid-session. */
  setTransitionVideoModel: 'uip-set-transition-video-model',
  /** Confirm the brand_review gate (may carry buffered brand-bank edits). */
  confirmBrandReview: 'uip-confirm-brand-review',
  /** Submit the brand brief (URL or freeform text) from the Stage 2 modal. */
  brandBriefSubmit: 'uip-brand-brief-submit',
  /** Tier-1 brand-bank field/asset edit. */
  brandBankEdit: 'uip-brand-bank-edit',
  /**
   * Explicit user style switch. Unlike `scriptReviewUpdate`
   * (which only merges into the activity-side folded `global_constraints`,
   * never a `spec_patched`), this signal's handler appends a REAL spec_patched
   * event so the auto-style re-selection gate (`foldStyleSource` in
   * `start-auto-style-child.ts`) sees `style_source='auto_switched'` and never
   * re-picks over the user's choice.
   */
  setStyle: 'uip-set-style',
} as const

/**
 * Runtime tool names the FE may cancel via `uip-cancel-tool`. These are the
 * `WorkflowState.activeToolCalls[].toolName` values, including the synthetic
 * `anchor_vs_batch` (one child that batches anchor + visual-script).
 */
export const CANCELLABLE_TOOL_NAMES = [
  'generate_intent_context',
  'generate_explainer_script',
  'generate_explainer_visual_script',
  'generate_anchor_assets',
  'anchor_vs_batch',
] as const

export type CancellableToolName = (typeof CANCELLABLE_TOOL_NAMES)[number]

/**
 * V2-only signals between the session workflow and its tool-runner child
 * workflows.
 */
export const UIPV2_TOOL_SIGNALS = {
  /** Child -> parent: a tool call finished successfully. */
  toolCompleted: 'uipv2-tool-completed',
  /** Child -> parent: a tool call failed. */
  toolFailed: 'uipv2-tool-failed',
  /** Child -> parent: a tool call was cancelled. */
  toolCancelled: 'uipv2-tool-cancelled',
  /** Parent -> child: request the running tool to cancel. */
  toolRunnerCancel: 'uipv2-tool-runner-cancel',
  /**
   * Child -> parent: an in-flight progress milestone (V1 appendProgressReply
   * parity). The parent appends it as a passive assistant_message tagged with
   * the child workflow id so the user sees streaming progress during a long tool.
   */
  childProgressMessage: 'uipv2-child-progress-message',
  /**
   * Child -> parent: an internal substep (LLM call / image-gen phase) of an
   * in-flight tool started or finished. The parent resolves the toolCallId
   * from activeToolCalls and appends a passive, transient tool_substep event.
   */
  toolSubstep: 'uipv2-tool-substep',
} as const

/**
 * V2 query names exposed by the session workflow.
 */
export const UIPV2_QUERIES = {
  /** Raw agent event log + current artifact slots. */
  getAgentEvents: 'uipv2-get-agent-events',
  /** Currently in-flight tool calls. */
  getActiveToolCalls: 'uipv2-get-active-tool-calls',
  /** Lightweight workflow health/liveness info. */
  getWorkflowHealth: 'uipv2-get-workflow-health',
} as const
