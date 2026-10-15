import type { CancellableToolName } from '@reelmakeeasy/common/workflow/uip-v2-signal-names'
import { MaybePromiseLike } from '@shared/types/api/common/type-util'
import type { ProjectVoiceOverJson } from '@shared/types/api/project'

import type {
  BrandBankEdit,
  BrandBriefSubmitPayload,
  ConfirmBrandReviewResult,
} from '../adapter/api-adapter'
import type {
  StateChanges,
  SummaryUpdateInput,
  UpdateStyleInput,
  UploadedAsset,
} from '../adapter/api-types'

import type { ActiveModalKind } from './atoms/planner'

export interface PlannerApi {
  cancelSession: () => Promise<void>
  // Stop one running tool. No optimistic layer: the workflow
  // cancels the tool child, and its `tool_cancelled` report-back clears
  // the running tool-call state (and is_processing) over SSE.
  cancelTool: (toolName: CancellableToolName) => Promise<void>
  confirmBrandReview: (
    edits?: BrandBankEdit[],
    styleDirective?: 'hybrid' | 'keep_existing_style' | null,
    brandStyleText?: string,
    brandStylePreviewUrl?: string,
    save?: boolean,
  ) => Promise<ConfirmBrandReviewResult>
  confirmFast: () => Promise<void>
  confirmPlan: () => Promise<void>
  continueDraft: () => Promise<void>
  refresh: () => Promise<void>
  removeQueuedMessage: (queueItemId: string) => Promise<void>
  saveScriptDraft: (script: string) => Promise<void>
  saveVoice: (voice: ProjectVoiceOverJson) => Promise<void>
  saveVoicePreviewSpeed: (speed: number) => Promise<void>
  sendMessage: (
    final: MaybePromiseLike<SendMessagePayload>,
    preview?: SendMessagePayload,
  ) => Promise<void>
  sendSummaryUpdate: (payload: SummaryUpdateInput) => Promise<void>
  // Mid-session auto-continue flip. Optimistically updates the
  // session/render state, then PATCHes the session; reverts on failure.
  setAutoContinue: (enabled: boolean) => Promise<void>
  // Auto Style Selection: apply a user-chosen style candidate (override of the
  // agent's auto-pick). Fire-and-forget; the backend stamps
  // style_source='auto_switched'. `id` is the UIP session id.
  setStyle: (id: string, style: UpdateStyleInput) => Promise<void>
  setTranscriptEditingState: (active: boolean) => Promise<null | StateChanges>
  submitBrandBrief: (payload: BrandBriefSubmitPayload) => Promise<void>
  uploadFiles: (files: File[]) => Promise<UploadedAsset>[]
  userOperationHeartbeat: () => void
}

export interface SendMessagePayload {
  answerToMessageId?: string
  // Brand-brief GUI draft edits to flush alongside this message. Backend
  // applies them in-band before the planner reads brand_bank; only honored
  // during brand_review. Empty / undefined when nothing to flush.
  brandDraftEdits?: BrandBankEdit[]
  message: string
  // Canvas modal open at send time. Sent to the backend
  // so the echoed message carries its true panel source, which drives the
  // AccentTag on the user bubble (block.sentFrom).
  sentFrom?: ActiveModalKind
  uploadedAssets?: UploadedAsset[]
}
