import { toast } from '@shared/ui'

import { MetaTagTransformer } from '@/components/markdown-editor/custom-nodes/MetaTagNode'

import type { BrandBankEdit } from '../../adapter/api-adapter'
import type { UploadedAsset } from '../../adapter/api-types'
import type { DraftFileUpload } from '../atoms/planner'
import {
  getActiveModalAtom,
  getApiAtom,
  getBrandBriefBankAssetsAtom,
  getBrandBriefDraftAtom,
  getBrandBriefDraftEditedAtom,
  getBrandPendingUploadsAtom,
  getSubmitPendingAtom,
} from '../atoms/planner'
import type { ClientSendQueueItem } from '../atoms/send-queue'
import { getSendQueueAtom } from '../atoms/send-queue'
import type { PlannerState } from '../planner-state'

import { encodeMetaTagSeparators } from './draft-upload-actions'
import { buildBrandBankEdits } from './flow-actions'
import { commitSummaryEdit } from './summary-actions'

export async function awaitPendingBrandUploads(state: PlannerState): Promise<void> {
  const pending = state.get(getBrandPendingUploadsAtom)
  if (pending.size === 0) {
    return
  }
  await Promise.allSettled(pending.values())
}

export function deleteClientQueuedItem(state: PlannerState, id: string): void {
  const queue = state.get(getSendQueueAtom)
  const item = queue.find((i) => i.id === id)
  if (!item) {
    return
  }
  item.draftUploads.forEach(({ blobUrl }) => URL.revokeObjectURL(blobUrl))
  state.set(
    getSendQueueAtom,
    queue.filter((i) => i.id !== id),
  )
}

export function enqueueAndFlush(
  state: PlannerState,
  message: string,
  draftUploads: DraftFileUpload[],
  answerToMessageId?: string,
): void {
  // Fresh-read the active panel at send time (not a
  // compose-time snapshot). Sent to the backend as `sentFrom` so the echoed
  // message carries its true panel source (see SendMessagePayload.sentFrom).
  const activeModal = state.get(getActiveModalAtom)

  const item: ClientSendQueueItem = {
    answerToMessageId,
    draftUploads,
    id: crypto.randomUUID(),
    message,
    sentFrom: activeModal?.kind,
    status: 'pending',
  }
  state.set(getSendQueueAtom, [...state.get(getSendQueueAtom), item])

  void flushSendQueue(state)
}

export function retryClientQueuedItem(state: PlannerState, id: string): void {
  const queue = state.get(getSendQueueAtom)
  const item = queue.find((i) => i.id === id)
  if (!item || item.status !== 'error') {
    return
  }
  state.set(
    getSendQueueAtom,
    queue.map((i) =>
      i.id === id ? { ...i, errorMessage: undefined, status: 'pending' as const } : i,
    ),
  )
  void flushSendQueue(state)
}

function buildPreviewUploadedAsset(draftUpload: DraftFileUpload): UploadedAsset {
  return {
    asset_id: draftUpload.id,
    content_type: draftUpload.file.type || 'application/octet-stream',
    file_name: draftUpload.file.name,
    file_path: draftUpload.blobUrl,
    preview_url: draftUpload.blobUrl,
  }
}

async function flushSendQueue(state: PlannerState): Promise<void> {
  const queue = state.get(getSendQueueAtom)

  if (queue.some((item) => item.status === 'sending')) {
    return
  }

  const nextItem = queue.find((item) => item.status === 'pending')
  if (!nextItem) {
    return
  }

  state.set(
    getSendQueueAtom,
    state
      .get(getSendQueueAtom)
      .map((item) => (item.id === nextItem.id ? { ...item, status: 'sending' as const } : item)),
  )

  try {
    const api = state.get(getApiAtom)
    if (!api) {
      throw new Error('Planner API is not ready yet.')
    }

    // Await in-flight brand-card uploads BEFORE snapshotting so any asset
    // the user just picked has its pendingStorePath set in draft state and
    // is emitted as an add_asset edit. Without this, a fast send right
    // after a pick races the storage PUT and the new asset is silently lost.
    await awaitPendingBrandUploads(state)
    // Pending Summary-card edits must reach the workflow before the message
    // so the planner reads the edited constraints. commitSummaryEdit no-ops
    // when the draft is clean and keeps its own dirty-flag/retry semantics,
    // so no extra bookkeeping is needed here.
    await commitSummaryEdit(state)
    // Flush pending brand-brief draft edits in the same request so the
    // backend applies them before the planner reads brand_bank. Snapshot
    // here (not inside the .then) so the intent is captured atomically
    // per send, regardless of upload timing. The dirty flag is cleared
    // after a successful send below -- keeps the retry path correct.
    const brandDraftEdits = snapshotBrandDraftEdits(state)

    const previewUploadedAssets = nextItem.draftUploads.map(buildPreviewUploadedAsset)
    const finalPayloadPromise = Promise.all(
      nextItem.draftUploads.map(({ fetcher }) => fetcher.toPromise()),
    ).then((uploadedAssets) => {
      // Rewrite meta tags with uploaded asset ids/paths before sending.
      // Draft tags are created with `(draftId|blobUrl)`; backend expects
      // persistent `(asset_id|file_path)` references.
      const finalMessage = rewriteMetaTagResources(
        nextItem.message,
        nextItem.draftUploads,
        uploadedAssets,
      )
      return {
        answerToMessageId: nextItem.answerToMessageId,
        brandDraftEdits,
        message: finalMessage,
        sentFrom: nextItem.sentFrom,
        uploadedAssets: uploadedAssets.length > 0 ? uploadedAssets : undefined,
      }
    })

    await api.sendMessage(finalPayloadPromise, {
      answerToMessageId: nextItem.answerToMessageId,
      brandDraftEdits,
      message: nextItem.message,
      sentFrom: nextItem.sentFrom,
      uploadedAssets: previewUploadedAssets,
    })

    // Send landed: the snapshot we just flushed is now == server truth,
    // so clear the dirty flag. If the user typed again mid-flight, their
    // next keystroke re-sets the flag via updateDraft.
    if (brandDraftEdits) {
      state.set(getBrandBriefDraftEditedAtom, false)
    }

    const currentQueue = state.get(getSendQueueAtom)
    if (currentQueue.some((item) => item.id === nextItem.id)) {
      nextItem.draftUploads.forEach(({ blobUrl }) => URL.revokeObjectURL(blobUrl))
      state.set(
        getSendQueueAtom,
        currentQueue.filter((item) => item.id !== nextItem.id),
      )
    }

    void flushSendQueue(state)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to send message'
    toast.error(errorMessage)
    // Backstop: a failed send produces no backend update to clear the submit flag
    // via session-sync, so drop it here to avoid a stuck "Thinking..." indicator.
    state.set(getSubmitPendingAtom, false)
    const currentQueue = state.get(getSendQueueAtom)
    if (currentQueue.some((item) => item.id === nextItem.id)) {
      state.set(
        getSendQueueAtom,
        currentQueue.map((item) =>
          item.id === nextItem.id ? { ...item, errorMessage, status: 'error' as const } : item,
        ),
      )
    }
  }
}

function rewriteMetaTagResources(
  message: string,
  draftUploads: DraftFileUpload[],
  uploadedAssets: UploadedAsset[],
): string {
  if (!message.trim()) {
    return message
  }

  const uploadByDraftId = new Map<string, UploadedAsset>()
  const uploadByBlobUrl = new Map<string, UploadedAsset>()
  for (let i = 0; i < draftUploads.length; i++) {
    const draft = draftUploads[i]
    const uploaded = uploadedAssets[i]
    uploadByDraftId.set(draft.id, uploaded)
    uploadByBlobUrl.set(draft.blobUrl, uploaded)
  }

  const importRegExp = MetaTagTransformer.importRegExp ?? MetaTagTransformer.regExp
  const globalRegExp = new RegExp(importRegExp.source, 'g')

  const rewritten = message.replace(
    globalRegExp,
    (full, resourceType, title, resourceId, metadata) => {
      const uploadForResourceId =
        uploadByDraftId.get(resourceId) ?? uploadByBlobUrl.get(resourceId) ?? null
      const uploadForMetadata = metadata ? (uploadByBlobUrl.get(metadata) ?? null) : null

      const nextResourceId = uploadForResourceId?.asset_id ?? resourceId
      const nextMetadata = metadata ? (uploadForMetadata?.file_path ?? metadata) : undefined
      if (nextResourceId === resourceId && nextMetadata === metadata) {
        return full
      }

      return nextMetadata
        ? `@${resourceType}[${title}](${nextResourceId}|${encodeMetaTagSeparators(nextMetadata)})`
        : `@${resourceType}[${title}](${nextResourceId})`
    },
  )

  // Fallback: also rewrite plain blob URLs that may appear outside meta tags.
  let finalMessage = rewritten
  for (const draft of draftUploads) {
    const uploaded = uploadByBlobUrl.get(draft.blobUrl)
    const fileUri = uploaded?.file_path
    if (fileUri) {
      finalMessage = finalMessage.replaceAll(draft.blobUrl, fileUri)
    }
  }
  return finalMessage
}

/**
 * Snapshot pending brand-brief GUI edits for the send-queue flush.
 *
 * Returns `undefined` when there is nothing to flush (no draft, or the
 * user hasn't edited the card since the last sync). The backend gates
 * application on `phase === 'brand_review'`, so we don't need a phase
 * check here -- out-of-window edits no-op gracefully on the activity
 * side. The dirty flag is cleared by the caller AFTER the send succeeds
 * so a failed-then-retried send can re-flush the same edits.
 */
function snapshotBrandDraftEdits(state: PlannerState): BrandBankEdit[] | undefined {
  const hasUserEdited = state.get(getBrandBriefDraftEditedAtom)
  if (!hasUserEdited) {
    return undefined
  }
  const draft = state.get(getBrandBriefDraftAtom)
  const bankAssets = state.get(getBrandBriefBankAssetsAtom)
  const edits = buildBrandBankEdits(draft, bankAssets)
  return edits.length > 0 ? edits : undefined
}
