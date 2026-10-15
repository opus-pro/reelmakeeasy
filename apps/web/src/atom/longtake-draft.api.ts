import type {
  LongTakeEditorDraft,
  LongTakeEditorDraftResponse,
  SaveLongTakeEditorDraftRequest,
} from '@shared/types/api/long-take'

import type { FetchApiDomain } from '@/hooks/useApi'

export class DraftConflictError extends Error {
  // Error's default `name` is 'Error'; set it so telemetry that logs errorName
  // can tell this apart without inspecting the message.
  override readonly name = 'DraftConflictError'
}

export async function getLongTakeEditorDraft(
  fetchApiDomain: FetchApiDomain,
  projectId: string,
): Promise<LongTakeEditorDraft | null> {
  const res = await fetchApiDomain<LongTakeEditorDraftResponse>(
    `/api/long-take-videos/${projectId}/editor-draft`,
  )
  if (!res.ok) {
    throw new Error(res.error || 'Failed to fetch editor draft')
  }
  return res.data.data
}

export async function putLongTakeEditorDraft(
  fetchApiDomain: FetchApiDomain,
  projectId: string,
  body: SaveLongTakeEditorDraftRequest,
): Promise<LongTakeEditorDraft | null> {
  const res = await fetchApiDomain<LongTakeEditorDraftResponse>(
    `/api/long-take-videos/${projectId}/editor-draft`,
    // Without noThrowError, fetchApiDomain throws a raw ApiError on any
    // non-2xx before the res.ok / res.status check below ever runs, so a
    // 409 could never be translated into DraftConflictError.
    { data: body, method: 'PUT', noThrowError: true },
  )
  if (!res.ok) {
    if (res.status === 409) {
      throw new DraftConflictError(res.error || 'Failed to save editor draft')
    }
    throw new Error(res.error || 'Failed to save editor draft')
  }
  return res.data.data
}
