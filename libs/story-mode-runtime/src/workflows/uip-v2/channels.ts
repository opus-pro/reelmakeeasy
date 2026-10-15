/**
 * UIP V2 typed signal/query channels (Phase 3).
 *
 * `defineSignal` / `defineQuery` wrap the canonical wire-name strings (from
 * `@reelmakeeasy/common/workflow/uip-v2-signal-names`) into typed workflow channels.
 * Both the session workflow (signal-handlers.ts / workflow.ts) and the
 * tool-runner child (uip-v2-tool-runner/workflow.ts) import these, so the
 * channel definitions live in one module to avoid a circular import between the
 * two workflow files.
 *
 * Runs in workflow code, kept light:
 *   - The only value import is `@reelmakeeasy/workflow-engine/workflow`
 *     (defineSignal/defineQuery, which is the point) and the pure name-constant
 *     module.
 *   - Every payload type comes in via `import type` ONLY -- no
 *     `@reelmakeeasy/uip-planner-runtime` value import is dragged in.
 */

import {
  UIP_INBOUND_SIGNALS,
  UIPV2_QUERIES,
  UIPV2_TOOL_SIGNALS,
} from '@reelmakeeasy/common/workflow/uip-v2-signal-names'
// Brand payloads already canonical in the shared kernel (type-only).
import type {
  BrandBankEditSignalPayload,
  BrandBriefSubmitSignalPayload,
  ConfirmBrandReviewSignalPayload,
} from '@reelmakeeasy/uip-planner-runtime'
import { defineQuery, defineSignal } from '@reelmakeeasy/workflow-engine/workflow'

import type {
  BrandExtractionFailedSignalPayload,
  BrandExtractionReadySignalPayload,
  CancelQueuedItemSignalPayload,
  CancelSessionSignalPayload,
  CancelToolSignalPayload,
  ConfirmFastSignalPayload,
  ConfirmSignalPayload,
  ContinueUipDraftSignalPayload,
  GuiUpdateSignalPayload,
  ScriptReviewUpdateSignalPayload,
  SetAutoContinueSignalPayload,
  SetStyleSignalPayload,
  SetTransitionVideoModelSignalPayload,
  UserMessageSignalPayload,
  UserMessagesSignalPayload,
} from './signal-payloads'
import type {
  ActiveToolCallInfo,
  AgentEvent,
  ArtifactSlot,
  ChildProgressMessageSignalPayload,
  MusicBeatSheetSignalPayload,
  PreVoiceoverArtifactsReadySignalPayload,
  PreVoiceoverScriptReadySignalPayload,
  ToolCancelledSignalPayload,
  ToolCompletedSignalPayload,
  ToolFailedSignalPayload,
  ToolSubstepSignalPayload,
  WorkflowHealthInfo,
} from './types'

// ---------------------------------------------------------------------------
// Inbound signals (V1 names, reused verbatim so the API code is unchanged)
// ---------------------------------------------------------------------------

export const userMessageSignal = defineSignal<[UserMessageSignalPayload]>(
  UIP_INBOUND_SIGNALS.userMessage,
)
export const userMessagesSignal = defineSignal<[UserMessagesSignalPayload]>(
  UIP_INBOUND_SIGNALS.userMessages,
)
export const userActivitySignal = defineSignal(UIP_INBOUND_SIGNALS.userActivity)
export const confirmSignal = defineSignal<[ConfirmSignalPayload?]>(UIP_INBOUND_SIGNALS.confirm)
export const confirmFastSignal = defineSignal<[ConfirmFastSignalPayload?]>(
  UIP_INBOUND_SIGNALS.confirmFast,
)
export const continueUipDraftSignal = defineSignal<[ContinueUipDraftSignalPayload]>(
  UIP_INBOUND_SIGNALS.continueDraft,
)
export const guiUpdateSignal = defineSignal<[GuiUpdateSignalPayload]>(UIP_INBOUND_SIGNALS.guiUpdate)
export const scriptReviewUpdateSignal = defineSignal<[ScriptReviewUpdateSignalPayload]>(
  UIP_INBOUND_SIGNALS.scriptReviewUpdate,
)
export const cancelSessionSignal = defineSignal<[CancelSessionSignalPayload]>(
  UIP_INBOUND_SIGNALS.cancelSession,
)
export const cancelToolSignal = defineSignal<[CancelToolSignalPayload]>(
  UIP_INBOUND_SIGNALS.cancelTool,
)
export const cancelQueuedItemSignal = defineSignal<[CancelQueuedItemSignalPayload]>(
  UIP_INBOUND_SIGNALS.cancelQueuedItem,
)
export const wakeSignal = defineSignal(UIP_INBOUND_SIGNALS.wake)
export const setAutoContinueSignal = defineSignal<[SetAutoContinueSignalPayload]>(
  UIP_INBOUND_SIGNALS.setAutoContinue,
)
export const setTransitionVideoModelSignal = defineSignal<[SetTransitionVideoModelSignalPayload]>(
  UIP_INBOUND_SIGNALS.setTransitionVideoModel,
)
export const setStyleSignal = defineSignal<[SetStyleSignalPayload]>(UIP_INBOUND_SIGNALS.setStyle)

// Pre-voiceover child -> parent. These wire names are NOT in
// UIP_INBOUND_SIGNALS (they are child-originated, not API-originated); they
// mirror the V1 strings verbatim. The child is started in Phase 4; the handlers
// here are cheap and let the audio events flow into the log.
export const preVoiceoverScriptReadySignal = defineSignal<[PreVoiceoverScriptReadySignalPayload]>(
  'uip-pre-voiceover-script-ready',
)
export const preVoiceoverArtifactsReadySignal = defineSignal<
  [PreVoiceoverArtifactsReadySignalPayload]
>('uip-pre-voiceover-artifacts-ready')

// Brand extraction child -> parent (machine state). Wire names mirror V1
// verbatim; not in UIP_INBOUND_SIGNALS (child-originated).
export const brandExtractionReadySignal = defineSignal<[BrandExtractionReadySignalPayload]>(
  'uip-brand-extraction-ready',
)
export const brandExtractionFailedSignal = defineSignal<[BrandExtractionFailedSignalPayload]>(
  'uip-brand-extraction-failed',
)

// MusicPreAnalysisWorkflow -> parent. Wire name matches the producer
// in workflows/pre-voiceover/signals.ts; child-originated, not in UIP_INBOUND_SIGNALS.
export const musicBeatSheetSignal =
  defineSignal<[MusicBeatSheetSignalPayload]>('uip-music-beat-sheet')

// Brand API -> parent (user actions).
export const confirmBrandReviewSignal = defineSignal<[ConfirmBrandReviewSignalPayload]>(
  UIP_INBOUND_SIGNALS.confirmBrandReview,
)
export const brandBriefSubmitSignal = defineSignal<[BrandBriefSubmitSignalPayload]>(
  UIP_INBOUND_SIGNALS.brandBriefSubmit,
)
export const brandBankEditSignal = defineSignal<[BrandBankEditSignalPayload]>(
  UIP_INBOUND_SIGNALS.brandBankEdit,
)

// ---------------------------------------------------------------------------
// V2 tool lifecycle signals (child <-> parent)
// ---------------------------------------------------------------------------

/** Child -> parent: a tool call completed successfully. */
export const toolCompletedSignal = defineSignal<[ToolCompletedSignalPayload]>(
  UIPV2_TOOL_SIGNALS.toolCompleted,
)
/** Child -> parent: a tool call failed. */
export const toolFailedSignal = defineSignal<[ToolFailedSignalPayload]>(
  UIPV2_TOOL_SIGNALS.toolFailed,
)
/** Child -> parent: a tool call was cancelled. */
export const toolCancelledSignal = defineSignal<[ToolCancelledSignalPayload]>(
  UIPV2_TOOL_SIGNALS.toolCancelled,
)
/** Parent -> child: request the running tool to cancel. */
export const toolRunnerCancelSignal = defineSignal(UIPV2_TOOL_SIGNALS.toolRunnerCancel)
/** Child -> parent: an in-flight progress milestone (streamed assistant message). */
export const childProgressMessageSignal = defineSignal<[ChildProgressMessageSignalPayload]>(
  UIPV2_TOOL_SIGNALS.childProgressMessage,
)
/** Child -> parent: an internal substep of an in-flight tool started/finished. */
export const toolSubstepSignal = defineSignal<[ToolSubstepSignalPayload]>(
  UIPV2_TOOL_SIGNALS.toolSubstep,
)

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Raw agent event log + current artifact slots (API folds them into SessionState). */
export const getAgentEventsQuery = defineQuery<{
  currentArtifacts: Record<string, ArtifactSlot>
  events: AgentEvent[]
}>(UIPV2_QUERIES.getAgentEvents)

/** Currently in-flight tool calls. */
export const getActiveToolCallsQuery = defineQuery<ActiveToolCallInfo[]>(
  UIPV2_QUERIES.getActiveToolCalls,
)

/** Lightweight workflow health / liveness info. */
export const getWorkflowHealthQuery = defineQuery<WorkflowHealthInfo>(
  UIPV2_QUERIES.getWorkflowHealth,
)
