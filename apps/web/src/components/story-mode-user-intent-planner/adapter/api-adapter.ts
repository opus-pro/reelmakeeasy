import type { CancellableToolName } from '@reelmakeeasy/common/workflow/uip-v2-signal-names'

import { UIP_SESSION_CREATE_TIMEOUT_MS } from '@/constants/request-timeouts'
import type { FetchApiDomain, FetchOptions, FetchResponse } from '@/hooks/useApi'
import { ApiError, isApiError } from '@/lib/api-error'

import type { ActiveModalKind } from '../state/atoms/planner'

import type {
  CreateSessionInput,
  GenerateUploadUrlsResult,
  GuiUpdateInput,
  Session,
  SessionCreateResult,
  SessionStatusResult,
  SetAutoContinueInput,
  StateChanges,
  SummaryUpdateInput,
  UipMessageRecord,
  UpdateScriptReviewInput,
  UpdateStyleInput,
  UploadedAsset,
  UploadFileDescriptor,
} from './api-types'

const BASE = '/api/uip-sessions'

export type BrandBankEdit =
  | {
      add_asset: {
        asset_kind: 'character' | 'logo' | 'product'
        description: null | string
        file_path: string
      }
      kind: 'add_asset'
    }
  | {
      field: {
        path: 'basic_info.about_us_summary' | 'basic_info.business_name' | 'ctas'
        value: unknown
      }
      kind: 'field'
    }
  | {
      kind: 'remove_asset'
      remove_asset: {
        asset_kind: 'character' | 'logo' | 'product'
        staging_uri: string
      }
    }

export type BrandBriefSubmitPayload =
  | { answerToMessageId?: string; kind: 'url'; url: string }
  | {
      answerToMessageId?: string
      kind: 'freeform'
      text: string
      uploadedAssets?: UploadedAsset[]
    }

export type BrandStyleDirective = 'hybrid' | 'keep_existing_style' | null

// Outcome of a "Confirm + Save" persist. Mirrors the BE
// BriefSaveResult; present only when the confirm requested a save.
export type BriefSaveOutcome = 'failed' | 'saved' | 'skipped' | 'updated'

export interface ConfirmBrandReviewResult {
  saved?: BriefSaveOutcome
  status: 'accepted' | 'invalid' | 'rejected'
}

export interface SendMessageResult {
  answerStatus?: 'accepted' | 'already_answered' | 'question_not_found' | 'queue_not_empty'
  record?: UipMessageRecord
}

export interface UipApiAdapter {
  cancelQueuedItem: (queueItemId: string) => Promise<{ cancelled: boolean }>
  cancelSession: (gateToken: string, clientId?: string) => Promise<SessionStatusResult>
  // Cancel ONE running tool by name; the session stays alive. Always
  // resolves 'accepted' -- the workflow no-ops when no matching tool is running,
  // so a name that just finished is harmless rather than an error.
  cancelTool: (toolName: CancellableToolName) => Promise<{ status: 'accepted' }>
  confirmBrandReview: (
    gateToken: string,
    edits?: BrandBankEdit[],
    styleDirective?: BrandStyleDirective,
    brandStyleText?: string,
    brandStylePreviewUrl?: string,
    save?: boolean,
  ) => Promise<ConfirmBrandReviewResult>
  confirmFast: (clientId?: string) => Promise<SessionStatusResult>
  confirmPlan: (clientId?: string) => Promise<SessionStatusResult>
  continueUipDraft: (gateToken: string, clientId?: string) => Promise<SessionStatusResult>
  generateUploadUrls: (files: UploadFileDescriptor[]) => Promise<GenerateUploadUrlsResult>
  getSession: () => Promise<Session>
  sendGuiUpdate: (payload: GuiUpdateInput) => Promise<void>
  sendMessage: (
    message: string,
    uploadedAssets?: UploadedAsset[],
    answerToMessageId?: string,
    clientId?: string,
    brandDraftEdits?: BrandBankEdit[],
    sentFrom?: ActiveModalKind,
  ) => Promise<SendMessageResult>
  sendSummaryUpdate: (payload: SummaryUpdateInput) => Promise<void>
  sendUserOperationHeartbeat: (clientId: string) => Promise<null | StateChanges>
  setAutoContinue: (payload: SetAutoContinueInput) => Promise<void>
  setTranscriptEditingState: (active: boolean, clientId: string) => Promise<null | StateChanges>
  submitBrandBrief: (payload: BrandBriefSubmitPayload) => Promise<void>
  updateScriptReview: (payload: UpdateScriptReviewInput) => Promise<void>
  updateStyle: (payload: UpdateStyleInput) => Promise<void>
}

export function createApiAdapter(fetchApiDomain: FetchApiDomain, sessionId: string): UipApiAdapter {
  const run = async <T>(endpoint: string, options?: FetchOptions): Promise<T> => {
    const response = await fetchApiDomain<T>(`${BASE}/${sessionId}${endpoint}`, options)
    return handleResponse(response)
  }

  return {
    cancelQueuedItem: (queueItemId) =>
      run<{ cancelled: boolean }>(`/queue/${queueItemId}`, { method: 'DELETE' }),
    cancelSession: (gateToken, clientId) =>
      run<SessionStatusResult>('/cancel', {
        data: { gate_token: gateToken, client_id: clientId },
        method: 'POST',
      }),
    cancelTool: (toolName) =>
      run<{ status: 'accepted' }>('/tool-cancellations', {
        data: { tool_name: toolName },
        method: 'POST',
      }),
    confirmBrandReview: (
      gateToken,
      edits,
      styleDirective,
      brandStyleText,
      brandStylePreviewUrl,
      save,
    ) =>
      run<ConfirmBrandReviewResult>('/confirm-brand-review', {
        data: {
          gate_token: gateToken,
          ...(edits?.length ? { edits } : {}),
          ...(styleDirective === undefined ? {} : { style_directive: styleDirective }),
          ...(brandStyleText ? { brand_style_text: brandStyleText } : {}),
          ...(brandStylePreviewUrl ? { brand_style_preview_url: brandStylePreviewUrl } : {}),
          ...(save ? { save } : {}),
        },
        method: 'POST',
      }),
    confirmFast: (clientId) =>
      run<SessionStatusResult>('/confirm-fast', {
        data: { client_id: clientId },
        method: 'POST',
      }),
    confirmPlan: (clientId) =>
      run<SessionStatusResult>('/confirm', {
        data: { client_id: clientId },
        method: 'POST',
      }),
    continueUipDraft: (gateToken, clientId) =>
      run<SessionStatusResult>('/continue-uip-draft', {
        data: { gate_token: gateToken, client_id: clientId },
        method: 'POST',
      }),
    generateUploadUrls: (files) =>
      run<GenerateUploadUrlsResult>('/generate-upload-urls', { data: { files }, method: 'POST' }),
    getSession: () => run<Session>(''),
    sendMessage: (
      message,
      uploadedAssets,
      answerToMessageId,
      clientId,
      brandDraftEdits,
      sentFrom,
    ) =>
      run<SendMessageResult>('/message', {
        data: {
          answer_to_message_id: answerToMessageId,
          brand_draft_edits:
            brandDraftEdits && brandDraftEdits.length > 0 ? brandDraftEdits : undefined,
          client_id: clientId,
          message,
          sent_from: sentFrom,
          uploaded_assets: uploadedAssets,
        },
        method: 'POST',
      }),
    sendUserOperationHeartbeat: (clientId) =>
      run<null | StateChanges>('/user-operation-heartbeat', {
        data: { client_id: clientId },
        method: 'POST',
      }),
    sendGuiUpdate: (payload) => run<void>('/gui-update', { data: payload, method: 'POST' }),
    sendSummaryUpdate: (payload) => run<void>('/summary', { data: payload, method: 'POST' }),
    setTranscriptEditingState: (active, clientId) =>
      run<null | StateChanges>('/transcript-editing-state', {
        data: { active, client_id: clientId },
        method: 'POST',
      }),
    submitBrandBrief: (payload) => {
      const { answerToMessageId } = payload
      const body =
        payload.kind === 'freeform'
          ? {
              kind: 'freeform' as const,
              text: payload.text,
              uploaded_assets: payload.uploadedAssets,
              answer_to_message_id: answerToMessageId,
            }
          : {
              kind: 'url' as const,
              url: payload.url,
              answer_to_message_id: answerToMessageId,
            }
      return run<void>('/brand-brief/submit', { data: body, method: 'POST' })
    },
    updateScriptReview: (payload) =>
      run<void>('/script-review/update', { data: payload, method: 'POST' }),
    // Auto Style Selection: applies a user-chosen style candidate. Fire-and-forget
    // POST like the other UIP settings endpoints (the edge does not admit PATCH).
    updateStyle: (payload) => run<void>('/style', { data: payload, method: 'POST' }),
    // Auto-continue flip: POST sub-action like the other UIP
    // settings endpoints (the edge does not admit PATCH).
    setAutoContinue: (payload) => run<void>('/auto-continue', { data: payload, method: 'POST' }),
  }
}

export async function createUipSession(
  fetchApiDomain: FetchApiDomain,
  payload?: CreateSessionInput,
): Promise<SessionCreateResult> {
  const response = await fetchApiDomain<SessionCreateResult>(BASE, {
    data: payload ?? {},
    method: 'POST',
    // Without this the composer's `isSending` spinner never clears on a hung
    // request. Short because the create dedupes on sessionCreationId, so the
    // retry this prompts is safe -- see UIP_SESSION_CREATE_TIMEOUT_MS.
    timeout: UIP_SESSION_CREATE_TIMEOUT_MS,
  })
  return handleResponse(response)
}

/**
 * Read-only carry-over preview for the Remix flow. Returns the deterministic
 * bullet summary for a source project (or null), without creating a session,
 * plus the image model (explicit selection or dominant keyframe-generation
 * model) and the video/transition model (explicit selection only) that made
 * the source. A null video model is ambiguous on its own, so
 * `videoModelKnown` reports whether the api actually read a row backing the
 * source: true means null IS the source's answer (it ran the default model),
 * absent/false means nothing was readable. `shareId` lets the share page resolve a
 * shared (non-owned) source past the visit gate. It also returns the remix
 * brand signals -- whether the source is the requester's own project and (only
 * then) its saved-brief id. These stay `undefined` when the API predates them
 * (deploy skew): the composer acts only on definitive values, so an old API
 * means no selector change.
 */
export async function fetchCarryUipContext(
  fetchApiDomain: FetchApiDomain,
  sourceProjectId: string,
  shareId?: string,
): Promise<{
  imageModelUsed: null | string
  remixContext: null | string
  sourceBrandBriefId?: null | string
  sourceOwnedByRequester?: boolean
  videoModelKnown?: boolean
  videoModelUsed: null | string
}> {
  const shareParam = shareId ? `&share_id=${encodeURIComponent(shareId)}` : ''
  const response = await fetchApiDomain<{
    image_model_used?: null | string
    remix_context: null | string
    source_brand_brief_id?: null | string
    source_owned_by_requester?: boolean
    video_model_known?: boolean
    video_model_used?: null | string
  }>(
    `${BASE}/carry-uip-context?source_project_id=${encodeURIComponent(sourceProjectId)}${shareParam}`,
  )
  const data = handleResponse(response)
  return {
    imageModelUsed: data.image_model_used ?? null,
    remixContext: data.remix_context,
    // No ?? defaults: absent (old API) must survive as undefined = "unknown".
    sourceBrandBriefId: data.source_brand_brief_id,
    sourceOwnedByRequester: data.source_owned_by_requester,
    videoModelKnown: data.video_model_known,
    videoModelUsed: data.video_model_used ?? null,
  }
}

export function isUnauthorizedApiError(error: unknown): boolean {
  return getHttpStatus(error) === 401
}

function getHttpStatus(error: unknown): number | undefined {
  if (isApiError(error)) {
    return error.status
  }
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' ? status : undefined
}

function handleResponse<T>(response: FetchResponse<T>): T {
  if (!response.ok) {
    throw new ApiError(response.error || `HTTP ${response.status}`, response.status)
  }
  return response.data
}
