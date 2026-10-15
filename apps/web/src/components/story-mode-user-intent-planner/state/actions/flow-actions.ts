import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'
import { toast } from '@shared/ui'

import { getAdapterSessionAtom } from '../../adapter/adapter-atoms'
import type {
  BrandBankEdit,
  BrandBriefSubmitPayload,
  BriefSaveOutcome,
} from '../../adapter/api-adapter'
import type { StyleCandidate } from '../../adapter/api-types'
import type { BrandBriefDraft } from '../../state-types'
import {
  getActiveModalAtom,
  getApiAtom,
  getBrandBriefBankAssetsAtom,
  getBrandBriefDraftAtom,
  getBrandSelectedSavedStyleAtom,
  getDraftFileUploadsAtom,
  getDraftMessageAtom,
  getIsConfirmingScriptReviewGateAtom,
  getPendingVoicePreviewSettingsSavePromisesAtom,
  getRenderStateAtom,
  getStopRequestedToolCallKeysAtom,
  getSubmitPendingAtom,
  getVoiceoverSpeedAtom,
} from '../atoms/planner'
import { getScriptTranscriptIsFocusedAtom } from '../atoms/script-transcript'
import { getCancellableRunningToolCallsAtom } from '../computed/planner'
import type { PlannerApi } from '../planner-api'
import type { PlannerState } from '../planner-state'

import { flushScriptTranscriptDraftBeforeAction } from './script-transcript-flow'
import { awaitPendingBrandUploads, enqueueAndFlush } from './send-queue-actions'
import { commitSummaryEdit } from './summary-actions'

// Stage 1 brand-prompt option ids. Must match the literals emitted by the
// planner in mode-confirmation-prompt.ts (section 2.6.2) -- the FE keys off
// these to open the Stage 2 modal locally instead of going through the API.
const BRAND_BRIEF_URL_OPTION_ID = 'paste_url'
const BRAND_BRIEF_FREEFORM_OPTION_ID = 'write_description'

const TRANSCRIPT_EDITING_HEARTBEAT_MS = 30_000

const getTranscriptEditingHeartbeatSlotByPlanner = createWeakMapFn((_state: PlannerState) => ({
  timerId: null as null | ReturnType<typeof setInterval>,
}))

const getConfirmScriptReviewGateSlotByPlanner = createWeakMapFn((_state: PlannerState) => ({
  promise: null as null | Promise<boolean>,
}))

const getConfirmAutoLockGateSlotByPlanner = createWeakMapFn((_state: PlannerState) => ({
  promise: null as null | Promise<boolean>,
}))

const getCancelScriptReviewGateSlotByPlanner = createWeakMapFn((_state: PlannerState) => ({
  promise: null as null | Promise<boolean>,
}))

const getConfirmFastScriptReviewGateSlotByPlanner = createWeakMapFn((_state: PlannerState) => ({
  promise: null as null | Promise<boolean>,
}))

type AssetKind = BrandBriefDraft['assets'][number]['kind']

export async function cancelQueuedMessage(
  state: PlannerState,
  queueItemId: string,
): Promise<boolean> {
  if (!queueItemId.trim()) {
    return false
  }

  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return false
  }

  try {
    await api.removeQueuedMessage(queueItemId)
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to remove queued message'
    toast.error(errorMessage)
    return false
  }
}

export async function cancelScriptReviewGate(state: PlannerState): Promise<boolean> {
  const slot = getCancelScriptReviewGateSlotByPlanner(state)
  if (slot.promise) {
    return slot.promise
  }

  const renderState = state.get(getRenderStateAtom)
  const gate = renderState.scriptReviewGate
  if (!gate || renderState.phase !== 'script_review') {
    return false
  }

  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return false
  }

  const run = async () => {
    try {
      await api.cancelSession()
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to cancel'
      toast.error(errorMessage)
      return false
    } finally {
      slot.promise = null
    }
  }

  slot.promise = run()
  return slot.promise
}

export function clearComposerDraft(state: PlannerState): void {
  const uploads = state.get(getDraftFileUploadsAtom)
  if (uploads.length > 0) {
    for (const upload of uploads) {
      URL.revokeObjectURL(upload.blobUrl)
    }
    state.set(getDraftFileUploadsAtom, [])
  }
  if (state.get(getDraftMessageAtom) !== '') {
    state.set(getDraftMessageAtom, '')
  }
}

export async function confirmAutoLockGate(state: PlannerState): Promise<boolean> {
  const slot = getConfirmAutoLockGateSlotByPlanner(state)
  if (slot.promise) {
    return slot.promise
  }

  const renderState = state.get(getRenderStateAtom)
  const gate = renderState.autoLockGate
  if (!gate || renderState.phase !== 'refinement') {
    return false
  }

  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return false
  }

  const run = async () => {
    try {
      await api.confirmPlan()
      return true
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to confirm'
      toast.error(errorMessage)
      return false
    } finally {
      slot.promise = null
    }
  }

  slot.promise = run()
  return slot.promise
}

export async function confirmBrandReview(
  state: PlannerState,
  opts?: { save?: boolean },
): Promise<boolean> {
  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return false
  }

  try {
    // Same race-fix as enqueueAndFlush: don't snapshot edits until any
    // in-flight brand-card upload has set its pendingStorePath on the draft.
    await awaitPendingBrandUploads(state)
    const draft = state.get(getBrandBriefDraftAtom)
    const bankAssets = state.get(getBrandBriefBankAssetsAtom)
    // Bundle the style directive into the same Confirm signal so we don't
    // fire a separate `brand_style_directive` signal -- that path forces
    // an extra planner turn in brand_review which the LLM mishandles by
    // emitting the Tier 2/3 reject copy.
    // A reused saved brief picks from its own saved styles: apply
    // the chosen style as the hybrid look, carrying its style text + preview.
    // A fresh brand keeps the preset style it was created with --
    // the apply-brand-colors enhancement step is gone.
    const selectedSavedStyle = state.get(getBrandSelectedSavedStyleAtom)
    let styleDirective: 'hybrid' | 'keep_existing_style' | null
    let brandStyleText: string | undefined
    let brandStylePreviewUrl: string | undefined
    if (selectedSavedStyle) {
      styleDirective = 'hybrid'
      brandStyleText = selectedSavedStyle.styleText ?? undefined
      brandStylePreviewUrl = selectedSavedStyle.previewUrl ?? undefined
    } else {
      styleDirective = draft ? 'keep_existing_style' : null
    }
    const result = await api.confirmBrandReview(
      buildBrandBankEdits(draft, bankAssets),
      styleDirective,
      brandStyleText,
      brandStylePreviewUrl,
      opts?.save,
    )
    // The confirm itself always proceeds; surface only the save outcome so a
    // save hiccup never blocks the user's video.
    if (opts?.save) {
      notifyBrandSaveOutcome(result?.saved)
    }
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to confirm brand profile'
    toast.error(errorMessage)
    return false
  }
}

export async function confirmFastScriptReviewGate(state: PlannerState): Promise<boolean> {
  const slot = getConfirmFastScriptReviewGateSlotByPlanner(state)
  if (slot.promise) {
    return slot.promise
  }

  const renderState = state.get(getRenderStateAtom)
  const gate = renderState.scriptReviewGate
  if (!gate || renderState.phase !== 'script_review') {
    return false
  }

  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return false
  }

  state.set(getIsConfirmingScriptReviewGateAtom, true)
  if (state.get(getScriptTranscriptIsFocusedAtom)) {
    state.set(getScriptTranscriptIsFocusedAtom, false)
    void syncTranscriptEditingActive(state, false)
  }

  const run = async () => {
    try {
      const saveOk = await flushScriptTranscriptDraftBeforeAction(state)
      if (!saveOk) {
        return false
      }
      await flushVoicePreviewSettingsBeforeScriptReviewAction(api, state)
      // Pending Summary-card edits must reach the workflow before the gate
      // confirm bypasses the send queue entirely (no api.sendMessage here).
      await commitSummaryEdit(state)
      await api.confirmFast()
      return true
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to confirm'
      toast.error(errorMessage)
      return false
    } finally {
      slot.promise = null
      state.set(getIsConfirmingScriptReviewGateAtom, false)
    }
  }

  slot.promise = run()
  return slot.promise
}

async function flushVoicePreviewSettingsBeforeScriptReviewAction(
  api: PlannerApi,
  state: PlannerState,
): Promise<void> {
  const pendingSettingsSaves = state.get(getPendingVoicePreviewSettingsSavePromisesAtom)
  if (pendingSettingsSaves.length > 0) {
    await Promise.all(pendingSettingsSaves)
  }
  await api.saveVoicePreviewSpeed(state.get(getVoiceoverSpeedAtom))
}

function notifyBrandSaveOutcome(saved: BriefSaveOutcome | undefined): void {
  if (saved === 'saved' || saved === 'updated') {
    toast.success('Brand saved to your library.')
  } else if (saved === 'failed') {
    toast.error("Couldn't save this brand to your library. Your video will still continue.")
  }
}

const ASSET_KINDS = ['logo', 'product', 'character'] as const satisfies ReadonlyArray<AssetKind>

interface BankAssetRef {
  provenance: string
  staging_uri: string
}

export function buildBrandBankEdits(
  draft: BrandBriefDraft | null,
  bankAssets: unknown,
): BrandBankEdit[] {
  if (!draft) {
    return []
  }
  const edits: BrandBankEdit[] = [
    { field: { path: 'basic_info.business_name', value: draft.businessName }, kind: 'field' },
    { field: { path: 'basic_info.about_us_summary', value: draft.aboutUsSummary }, kind: 'field' },
    {
      field: {
        path: 'ctas',
        // Preserve the original href so a label-only edit doesn't wipe the link.
        value: draft.ctaLabel ? [{ href: draft.ctaHref, label: draft.ctaLabel }] : [],
      },
      kind: 'field',
    },
  ]
  // Buffered uploads: each draft.assets entry with pendingStorePath was
  // uploaded but never patched. Emit add_asset so the bank picks them up.
  for (const asset of draft.assets) {
    if (!asset.pendingStorePath) {
      continue
    }
    edits.push({
      add_asset: {
        asset_kind: asset.kind,
        // Seed description with the file name so the planner's
        // guardUndescribedAssetsBeforeAction doesn't block the next turn.
        description: asset.pendingDescription ?? null,
        file_path: asset.pendingStorePath,
      },
      kind: 'add_asset',
    })
  }
  // Kind changes: asset still in draft but moved to a different category via
  // drag-and-drop. Emit remove_asset for the old kind + add_asset for the new
  // kind so the bank bucket reflects the user's recategorization.
  const bankKindByUri = new Map<string, AssetKind>()
  for (const { kind, ref } of iterateBankAssets(bankAssets)) {
    bankKindByUri.set(ref.staging_uri, kind)
  }
  for (const asset of draft.assets) {
    if (!asset.remoteUri) {
      continue
    }
    const bankKind = bankKindByUri.get(asset.remoteUri)
    if (bankKind === undefined || bankKind === asset.kind) {
      continue
    }
    edits.push(
      {
        kind: 'remove_asset',
        remove_asset: { asset_kind: bankKind, staging_uri: asset.remoteUri },
      },
      {
        kind: 'add_asset',
        add_asset: {
          asset_kind: asset.kind,
          description: asset.description,
          file_path: asset.remoteUri,
        },
      },
    )
  }
  // Hard-remove bank refs the user dropped from the draft.
  const draftRemoteUris = new Set(
    draft.assets.map((asset) => asset.remoteUri).filter((uri): uri is string => uri !== null),
  )
  for (const { kind, ref } of iterateBankAssets(bankAssets)) {
    if (draftRemoteUris.has(ref.staging_uri)) {
      continue
    }
    edits.push({
      kind: 'remove_asset',
      remove_asset: { asset_kind: kind, staging_uri: ref.staging_uri },
    })
  }
  return edits
}

export async function confirmScriptReviewGate(state: PlannerState): Promise<boolean> {
  const slot = getConfirmScriptReviewGateSlotByPlanner(state)
  if (slot.promise) {
    return slot.promise
  }

  const renderState = state.get(getRenderStateAtom)
  const gate = renderState.scriptReviewGate
  if (!gate || renderState.phase !== 'script_review') {
    return false
  }

  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return false
  }

  state.set(getIsConfirmingScriptReviewGateAtom, true)
  if (state.get(getScriptTranscriptIsFocusedAtom)) {
    state.set(getScriptTranscriptIsFocusedAtom, false)
    void syncTranscriptEditingActive(state, false)
  }

  const run = async () => {
    try {
      const saveOk = await flushScriptTranscriptDraftBeforeAction(state)
      if (!saveOk) {
        return false
      }
      await flushVoicePreviewSettingsBeforeScriptReviewAction(api, state)
      // Pending Summary-card edits must reach the workflow before the gate
      // confirm bypasses the send queue entirely (no api.sendMessage here).
      await commitSummaryEdit(state)
      await api.continueDraft()
      return true
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to confirm'
      toast.error(errorMessage)
      return false
    } finally {
      slot.promise = null
      state.set(getIsConfirmingScriptReviewGateAtom, false)
    }
  }

  slot.promise = run()
  return slot.promise
}

export async function persistAutoContinue(state: PlannerState, enabled: boolean): Promise<void> {
  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return
  }

  try {
    await api.setAutoContinue(enabled)
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to update auto-continue'
    toast.error(errorMessage)
  }
}

// Auto Style Selection: the user picks an agent-offered style candidate over the
// applied auto-pick. Fire-and-forget POST of the candidate as the new applied
// style (the backend stamps style_source='auto_switched'). Switch-away and the
// agent's ranked candidate set are analyzed off `project.long_take.completed`
// (style_source + style_candidates), so no per-switch tracking event fires here.
//
// Returns true when the setStyle request was accepted, false otherwise. The
// caller (StyleCandidatesBlockItem) highlights the tile OPTIMISTICALLY on click
// and reverts to the server-applied style when this resolves false, so a failed
// switch does not leave a wrong tile highlighted.
export async function refreshSession(state: PlannerState): Promise<void> {
  const api = state.get(getApiAtom)
  if (!api) {
    return
  }

  try {
    await api.refresh()
  } catch {
    // Silent fail on background auto-refresh
  }
}

export async function switchStyle(
  state: PlannerState,
  candidate: StyleCandidate,
): Promise<boolean> {
  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return false
  }

  const sessionId = state.get(getAdapterSessionAtom)?.session_id ?? ''

  try {
    // NB: candidate carries `thumbnail_url`; the applied style uses `style_thumbnail_url`.
    await api.setStyle(sessionId, {
      style_name: candidate.style_name,
      style_text: candidate.style_text,
      style_thumbnail_url: candidate.thumbnail_url,
    })
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to update style'
    toast.error(errorMessage)
    return false
  }
}

/**
 * Stop whatever the agent is currently generating, i.e. every running
 * tool the backend can cancel. One request per distinct tool name, because the
 * cancel contract is per-name and more than one tool can be in flight -- stopping
 * just one would leave the agent half-busy with the button still on Stop.
 *
 * The session stays alive: after the cancel the planner pauses and idles awaiting
 * the user's next message (contrast `cancelScriptReviewGate`, which kills it).
 * Returns false when there was nothing to stop or the request failed.
 */
export async function stopRunningTools(state: PlannerState): Promise<boolean> {
  const running = state.get(getCancellableRunningToolCallsAtom)
  if (running.length === 0) {
    return false
  }

  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return false
  }

  const previousRequestedKeys = state.get(getStopRequestedToolCallKeysAtom)
  // Mark exactly the tool calls being stopped, so the button reads as "stopping"
  // until their `tool_cancelled` lands over SSE.
  state.set(
    getStopRequestedToolCallKeysAtom,
    running.map((toolCall) => toolCall.key),
  )

  // allSettled, not all: one failing cancel must not discard the marks for the
  // tools that DID get cancelled, and must not hide the other results.
  const toolNames = [...new Set(running.map((toolCall) => toolCall.toolName))]
  const results = await Promise.allSettled(toolNames.map((name) => api.cancelTool(name)))
  const failed = results.filter(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  )
  if (failed.length === 0) {
    return true
  }

  // Keep the marks for the tools that succeeded (they leave the running list on
  // their own) and re-mark only the rest, so the button is pressable again for a
  // retry of exactly what is still running.
  const failedToolNames = new Set(
    toolNames.filter((_, index) => results[index]?.status === 'rejected'),
  )
  state.set(getStopRequestedToolCallKeysAtom, [
    ...previousRequestedKeys,
    ...running
      .filter((toolCall) => !failedToolNames.has(toolCall.toolName))
      .map((toolCall) => toolCall.key),
  ])
  const reason = failed[0].reason
  toast.error(reason instanceof Error ? reason.message : 'Failed to stop')
  return false
}

export async function submitBrandBrief(
  state: PlannerState,
  payload: BrandBriefSubmitPayload,
): Promise<boolean> {
  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return false
  }
  const answerToMessageId = state.get(getRenderStateAtom).quickQuestionMessageId
  try {
    await api.submitBrandBrief({ ...payload, answerToMessageId })
    return true
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Failed to submit brand details'
    toast.error(errorMessage)
    return false
  }
}

export function submitDraftMessage(state: PlannerState, answerToMessageId?: string): boolean {
  const nextMessage = state.get(getDraftMessageAtom).trim()
  const draftUploads = state.get(getDraftFileUploadsAtom)
  if (!nextMessage && draftUploads.length === 0) {
    return false
  }

  // Clear input immediately - queue takes ownership of draftUploads
  state.set(getDraftMessageAtom, '')
  state.set(getDraftFileUploadsAtom, [])

  // Paint "Thinking..." now, before the optimistic echo / session load / backend
  // signal. Cleared by session-sync once a backend update reflects the turn.
  state.set(getSubmitPendingAtom, true)

  enqueueAndFlush(state, nextMessage, draftUploads, answerToMessageId)
  return true
}

export function submitQuickOption(state: PlannerState, optionId: string): boolean {
  const renderState = state.get(getRenderStateAtom)
  const targetOption = renderState.quickOptions.find((option) => option.id === optionId)
  if (!targetOption) {
    return false
  }

  // Brand-prompt option ids open the Stage 2 modal locally; every other
  // quick-option goes through the regular enqueue path below.
  if (optionId === BRAND_BRIEF_URL_OPTION_ID || optionId === BRAND_BRIEF_FREEFORM_OPTION_ID) {
    state.set(getActiveModalAtom, {
      kind: 'brand-create',
      mode: optionId === BRAND_BRIEF_URL_OPTION_ID ? 'url' : 'freeform',
    })
    return true
  }

  state.set(getDraftMessageAtom, '')
  state.set(getDraftFileUploadsAtom, [])
  state.set(getSubmitPendingAtom, true)
  enqueueAndFlush(state, targetOption.text, [], renderState.quickQuestionMessageId)
  return true
}

export async function syncTranscriptEditingActive(
  state: PlannerState,
  active: boolean,
): Promise<boolean> {
  const api = state.get(getApiAtom)
  if (!api) {
    stopTranscriptEditingHeartbeat(state)
    return false
  }

  if (active && state.get(getRenderStateAtom).phase !== 'script_review') {
    stopTranscriptEditingHeartbeat(state)
    return false
  }

  if (active) {
    ensureTranscriptEditingHeartbeat(state)
  } else {
    stopTranscriptEditingHeartbeat(state)
  }

  return sendTranscriptEditingSync(state, active)
}

function ensureTranscriptEditingHeartbeat(state: PlannerState): void {
  const slot = getTranscriptEditingHeartbeatSlotByPlanner(state)
  if (slot.timerId) {
    return
  }

  const timer = setInterval(() => {
    if (state.get(getRenderStateAtom).phase !== 'script_review') {
      stopTranscriptEditingHeartbeat(state)
      return
    }
    void sendTranscriptEditingSync(state, true)
  }, TRANSCRIPT_EDITING_HEARTBEAT_MS)

  const timerWithUnref = timer as { unref?: () => void }
  if (typeof timerWithUnref.unref === 'function') {
    timerWithUnref.unref()
  }

  slot.timerId = timer
}

function* iterateBankAssets(
  bankAssets: unknown,
): Generator<{ kind: AssetKind; ref: BankAssetRef }> {
  if (!bankAssets || typeof bankAssets !== 'object' || Array.isArray(bankAssets)) {
    return
  }
  for (const kind of ASSET_KINDS) {
    const bucket = (bankAssets as Record<string, unknown>)[kind]
    if (!Array.isArray(bucket)) {
      continue
    }
    for (const entry of bucket) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue
      }
      const ref = entry as Record<string, unknown>
      if (typeof ref.staging_uri !== 'string' || typeof ref.provenance !== 'string') {
        continue
      }
      yield {
        kind,
        ref: { provenance: ref.provenance, staging_uri: ref.staging_uri },
      }
    }
  }
}

async function sendTranscriptEditingSync(state: PlannerState, active: boolean): Promise<boolean> {
  const api = state.get(getApiAtom)
  if (!api) {
    return false
  }

  if (active && state.get(getRenderStateAtom).phase !== 'script_review') {
    return false
  }

  try {
    await api.setTranscriptEditingState(active)
    return true
  } catch {
    return false
  }
}

function stopTranscriptEditingHeartbeat(state: PlannerState): void {
  const slot = getTranscriptEditingHeartbeatSlotByPlanner(state)
  if (!slot.timerId) {
    return
  }
  clearInterval(slot.timerId)
  slot.timerId = null
}
