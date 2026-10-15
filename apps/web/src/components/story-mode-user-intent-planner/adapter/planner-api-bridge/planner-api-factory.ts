import { CoalescingQueue } from '@reelmakeeasy/common/utils/coalescing-queue'
import type { ProjectVoiceOverJson } from '@shared/types/api/project'
import { toast } from '@shared/ui'

import { getRenderStateAtom, getStoryboardHandoffAtom } from '../../state/atoms/planner'
import type { PlannerApi } from '../../state/planner-api'
import type { PlannerState } from '../../state/planner-state'
import {
  getAdapterSessionAtom,
  getSessionStateAtom,
  getSimulatedEventsAtom,
} from '../adapter-atoms'
import type { StateChanges, UploadedAsset } from '../api-types'
import type { SimulatedEvent } from '../optimistic-events'

import { getUipClientId } from './client-id'
import { applySessionStateChanges } from './state-sync'
import {
  applyTranscriptEditingOptimisticRemoveClient,
  applyTranscriptEditingOptimisticSetClientActive,
  clearTranscriptEditingOptimisticOp,
} from './transcript-editing-sync'
import type { BridgeContext } from './types'
import { triggerUserOperationHeartbeat } from './user-operation-heartbeat'

export function createPlannerApi(params: {
  context: BridgeContext
  fetchAndSyncFromServer: () => Promise<void>
  getGateTokenOrThrow: () => string
  isSseConnected: () => boolean
  reapplySession: () => void
}): PlannerApi {
  const { context, fetchAndSyncFromServer, getGateTokenOrThrow, isSseConnected, reapplySession } =
    params
  const { apiClient, plannerState, runtimeState } = context
  const autoContinueRequestQueue = new CoalescingQueue<void>()
  const styleRequestQueue = new CoalescingQueue<void>()
  const voicePreviewSpeedRequestQueue = new CoalescingQueue<void>()
  const voiceRequestQueue = new CoalescingQueue<void>()
  const transcriptEditingRequestQueue = new CoalescingQueue<null | StateChanges>()
  const removeSimulatedEventByLocalOffset = (localOffset: number) => {
    plannerState.set(getSimulatedEventsAtom, (list) =>
      list.filter((simulatedEvent) => simulatedEvent.localOffset !== localOffset),
    )
    reapplySession()
  }
  const setPendingAction = (action: 'cancel' | 'confirm' | 'confirm_fast' | 'continue' | null) => {
    plannerState.set(getSessionStateAtom, (current) => ({
      ...current,
      state: {
        ...current.state,
        pending_action: action,
      },
    }))
  }

  return {
    cancelSession: async () => {
      const clientId = crypto.randomUUID()
      const localOffset = runtimeState.localOffsetCounter++
      const ts = new Date().toISOString()
      plannerState.set(getSimulatedEventsAtom, (list) => [
        ...list,
        { action: 'cancel', clientId, kind: 'action', localOffset, ts } satisfies SimulatedEvent,
      ])
      setPendingAction('cancel')
      reapplySession()
      try {
        const result = await apiClient.cancelSession(getGateTokenOrThrow(), clientId)
        if (result.status === 'rejected') {
          setPendingAction(null)
          removeSimulatedEventByLocalOffset(localOffset)
          toast.error('Could not cancel. Please try again.')
        } else if (result.status === 'duplicated') {
          removeSimulatedEventByLocalOffset(localOffset)
        }
      } catch (err) {
        setPendingAction(null)
        removeSimulatedEventByLocalOffset(localOffset)
        throw err
      }
    },
    // Per-tool stop. Fire-and-await, with no simulated event: unlike
    // cancelSession there is no pending_action to paint, and the composer's own
    // stop-requested keys cover the click -> `tool_cancelled` window.
    cancelTool: async (toolName) => {
      await apiClient.cancelTool(toolName)
    },
    confirmFast: async () => {
      const clientId = crypto.randomUUID()
      const localOffset = runtimeState.localOffsetCounter++
      const ts = new Date().toISOString()
      plannerState.set(getSimulatedEventsAtom, (list) => [
        ...list,
        {
          action: 'confirm_fast',
          clientId,
          kind: 'action',
          localOffset,
          ts,
        } satisfies SimulatedEvent,
      ])
      setPendingAction('confirm_fast')
      reapplySession()
      try {
        const result = await apiClient.confirmFast(clientId)
        if (result.status === 'rejected') {
          setPendingAction(null)
          removeSimulatedEventByLocalOffset(localOffset)
          toast.error('Could not start. Please try again.')
        } else if (result.status === 'duplicated') {
          removeSimulatedEventByLocalOffset(localOffset)
        }
      } catch (err) {
        setPendingAction(null)
        removeSimulatedEventByLocalOffset(localOffset)
        throw err
      }
    },
    confirmPlan: async () => {
      const clientId = crypto.randomUUID()
      const localOffset = runtimeState.localOffsetCounter++
      const ts = new Date().toISOString()
      plannerState.set(getSimulatedEventsAtom, (list) => [
        ...list,
        { action: 'confirm', clientId, kind: 'action', localOffset, ts } satisfies SimulatedEvent,
      ])
      setPendingAction('confirm')
      reapplySession()
      try {
        const result = await apiClient.confirmPlan(clientId)
        if (result.status === 'rejected') {
          setPendingAction(null)
          removeSimulatedEventByLocalOffset(localOffset)
          toast.error('Could not start. Please try again.')
        } else if (result.status === 'duplicated') {
          removeSimulatedEventByLocalOffset(localOffset)
        }
      } catch (err) {
        setPendingAction(null)
        removeSimulatedEventByLocalOffset(localOffset)
        throw err
      }
    },
    confirmBrandReview: (edits, styleDirective, brandStyleText, brandStylePreviewUrl, save) =>
      apiClient.confirmBrandReview(
        getGateTokenOrThrow(),
        edits,
        styleDirective,
        brandStyleText,
        brandStylePreviewUrl,
        save,
      ),
    continueDraft: async () => {
      const localOffset = runtimeState.localOffsetCounter++
      const clientId = crypto.randomUUID()
      const ts = new Date().toISOString()

      plannerState.set(getSimulatedEventsAtom, (list) => [
        ...list,
        {
          action: 'continue',
          clientId,
          kind: 'action',
          localOffset,
          ts,
        } satisfies SimulatedEvent,
      ])
      setPendingAction('continue')
      reapplySession()

      try {
        const result = await apiClient.continueUipDraft(getGateTokenOrThrow(), clientId)
        if (result.status === 'rejected') {
          setPendingAction(null)
          // No storyboard will be generated for this attempt, so close the canvas handoff window
          // this click opened. 'duplicated' is left alone: that action is still in
          // flight, so its window is still honest.
          plannerState.set(getStoryboardHandoffAtom, null)
          removeSimulatedEventByLocalOffset(localOffset)
          toast.error('Could not start. Please try again.')
        } else if (result.status === 'duplicated') {
          removeSimulatedEventByLocalOffset(localOffset)
        }
      } catch (err) {
        setPendingAction(null)
        plannerState.set(getStoryboardHandoffAtom, null)
        removeSimulatedEventByLocalOffset(localOffset)
        throw err
      }
    },
    refresh: async () => {
      if (isSseConnected()) {
        return
      }
      await fetchAndSyncFromServer()
      if (isSseConnected()) {
        return
      }
    },
    removeQueuedMessage: (id) => {
      if (id.startsWith('optimistic-')) {
        runtimeState.removedQueueMessageIds = new Set([id, ...runtimeState.removedQueueMessageIds])
        plannerState.set(getSimulatedEventsAtom, (list) =>
          list.filter(
            (event) =>
              event.kind !== 'user_message' ||
              `optimistic-${event.clientId ?? event.localOffset}` !== id,
          ),
        )
        reapplySession()
        return Promise.resolve()
      }

      const existing = runtimeState.inFlightQueueDeletes.get(id)
      if (existing) {
        return existing
      }

      runtimeState.removedQueueMessageIds = new Set([id, ...runtimeState.removedQueueMessageIds])
      reapplySession()

      const request = apiClient.cancelQueuedItem(id).then(
        (result) => {
          runtimeState.inFlightQueueDeletes.delete(id)
          if (!result.cancelled) {
            runtimeState.removedQueueMessageIds = new Set(
              [...runtimeState.removedQueueMessageIds].filter((itemId) => itemId !== id),
            )
            reapplySession()
          }
        },
        (err: unknown) => {
          runtimeState.inFlightQueueDeletes.delete(id)
          runtimeState.removedQueueMessageIds = new Set(
            [...runtimeState.removedQueueMessageIds].filter((itemId) => itemId !== id),
          )
          reapplySession()
          throw err
        },
      )
      runtimeState.inFlightQueueDeletes.set(id, request)
      return request
    },
    saveScriptDraft: (script) => apiClient.sendGuiUpdate({ transcript: script }),
    sendSummaryUpdate: (payload) => apiClient.sendSummaryUpdate(payload),
    // Optimistic voice write: a voice-only gui-update emits no session_changed, and
    // `voice` is a top-level session field, not session state, so the incremental patch channel
    // cannot carry it even when one is emitted -- only a full applySession tells this client.
    // Without this, every reader of the session voice (SessionVoiceoverTtsOwner regenerates off
    // it) sits on the old voice until a reload.
    saveVoice: (voice) =>
      voiceRequestQueue.push(async () => {
        const previous = plannerState.get(getAdapterSessionAtom)
        applyVoice(plannerState, voice)
        try {
          await apiClient.sendGuiUpdate({ voice })
        } catch (error) {
          applyVoice(plannerState, previous?.voice ?? null, previous?.voice_id ?? null)
          throw error
        }
      }),
    saveVoicePreviewSpeed: (speed) =>
      voicePreviewSpeedRequestQueue.push(async () => {
        await apiClient.sendGuiUpdate({ voice_preview_speed: speed })
      }),
    submitBrandBrief: async (payload) => {
      // Fire-and-await: the API validates the URL / freeform text and
      // signals the workflow. There is no optimistic event for the
      // brand-brief flow (the brand_extraction_input flip surfaces via
      // the next session_changed event from SSE).
      await apiClient.submitBrandBrief(payload)
    },
    setAutoContinue: async (enabled) => {
      const previous =
        plannerState.get(getAdapterSessionAtom)?.state?.auto_continue_enabled !== false
      if (previous === enabled) {
        return
      }

      applyAutoContinue(plannerState, enabled)

      try {
        await autoContinueRequestQueue.push(async () => {
          await apiClient.setAutoContinue({ auto_continue_enabled: enabled })
        })
      } catch (error) {
        applyAutoContinue(plannerState, previous)
        throw error
      }
    },
    // Auto Style Selection override. The session id is already baked into
    // apiClient (context.sessionId); the `id` arg mirrors the caller's
    // project_id and is not needed for routing. No optimistic render-state apply:
    // the applied style is not yet mirrored into RenderState, so the switch
    // surfaces via the next session_changed event from SSE.
    //
    // Serialized through a coalescing queue (like setAutoContinue / saveVoice):
    // firing updateStyle unserialized let rapid taps race at the network layer,
    // so an earlier request could land AFTER a later one and persist the wrong
    // (stale) style. The queue runs at most one request at a time and collapses
    // rapid taps into a single trailing call, so the LAST selection always wins.
    setStyle: async (_id, style) => {
      await styleRequestQueue.push(async () => {
        await apiClient.updateStyle(style)
      })
    },
    sendMessage: async (final, preview) => {
      const clientId = crypto.randomUUID()
      const localOffset = runtimeState.localOffsetCounter++
      const ts = new Date().toISOString()
      const previewPayload = preview ?? toPreviewPayloadFromFinal(await final)

      plannerState.set(getSimulatedEventsAtom, (list) => [
        ...list,
        {
          answerToMessageId: previewPayload.answerToMessageId,
          clientId,
          kind: 'user_message',
          localOffset,
          message: previewPayload.message,
          sentFrom: previewPayload.sentFrom,
          ts,
          uploadedAssets: previewPayload.uploadedAssets,
        } satisfies SimulatedEvent,
      ])
      reapplySession()

      try {
        const resolved = await final
        const result = await apiClient.sendMessage(
          resolved.message,
          resolved.uploadedAssets,
          resolved.answerToMessageId,
          clientId,
          resolved.brandDraftEdits,
          resolved.sentFrom,
        )
        if (result.answerStatus != null && result.answerStatus !== 'accepted') {
          removeSimulatedEventByLocalOffset(localOffset)
          reapplySession()
          return
        }
        if (!result.record) {
          removeSimulatedEventByLocalOffset(localOffset)
          reapplySession()
          throw new Error('sendMessage did not return an input inbox record')
        }
        runtimeState.backendResponseEvents = [
          ...runtimeState.backendResponseEvents,
          { localOffset, record: result.record },
        ]
        reapplySession()
      } catch (err) {
        removeSimulatedEventByLocalOffset(localOffset)
        throw err
      }
    },
    uploadFiles: (files) => {
      const uploadedAt = new Date().toISOString()
      const batch = apiClient.generateUploadUrls(
        files.map((file, index) => ({
          contentType: file.type || 'application/octet-stream',
          fileName: file.name,
          index,
        })),
      )

      return files.map((file, index) =>
        batch.then(async ({ uploads }) => {
          const upload = uploads.find((item) => item.index === index)
          if (!upload) {
            throw new Error(`No upload slot for: ${file.name}`)
          }
          const response = await fetch(upload.signedUrl, {
            body: file,
            headers: { 'Content-Type': file.type || 'application/octet-stream' },
            method: 'PUT',
          })
          if (!response.ok) {
            throw new Error(`Upload failed: ${file.name}`)
          }
          return {
            asset_id: upload.assetId,
            content_type: file.type || 'application/octet-stream',
            file_name: file.name,
            file_path: upload.fileUri,
            uploaded_at: uploadedAt,
          }
        }),
      )
    },
    setTranscriptEditingState: async (active: boolean) => {
      const clientId = getUipClientId(context.sessionId)
      const optimisticOpId = active
        ? applyTranscriptEditingOptimisticSetClientActive(plannerState, clientId)
        : applyTranscriptEditingOptimisticRemoveClient(plannerState, clientId)
      reapplySession()

      // Optimistic state updates should be instant.
      // We only serialize network writes; exact active-value matching per request is not required.
      try {
        return await transcriptEditingRequestQueue.push(async () => {
          const changes = await apiClient.setTranscriptEditingState(active, clientId)
          if (changes) {
            applySessionStateChanges(plannerState, changes, true)
            reapplySession()
          }
          return changes
        })
      } finally {
        // Cleanup must be outside queue fn so coalesced calls still clear their own optimistic layer.
        clearTranscriptEditingOptimisticOp(plannerState, optimisticOpId)
        reapplySession()
      }
    },
    userOperationHeartbeat: () => {
      triggerUserOperationHeartbeat(context.sessionId)
    },
  }
}

// Optimistic auto-continue flip: mirror the server's write-through
// (setting + cleared deadlines on disable) onto the session atom, and drop the
// gate countdowns from the render state immediately so no phantom countdown
// shows while the PATCH round-trips. The next applySession/SSE state patch
// converges on the same values.
function applyAutoContinue(state: PlannerState, enabled: boolean): void {
  state.set(getAdapterSessionAtom, (current) => {
    if (!current) {
      return current
    }
    const currentState = current.state ?? {}
    return {
      ...current,
      state: {
        ...currentState,
        auto_continue_enabled: enabled,
        ...(enabled
          ? {}
          : {
              review_gate: {
                ...currentState.review_gate,
                auto_lock_deadline_at: null,
                review_auto_continue_deadline_at: null,
              },
            }),
      },
    }
  })
  state.set(getRenderStateAtom, (current) => ({
    ...current,
    autoContinueEnabled: enabled,
    ...(enabled
      ? {}
      : {
          autoLockGate: current.autoLockGate
            ? { ...current.autoLockGate, deadlineAt: null }
            : current.autoLockGate,
          scriptReviewGate: current.scriptReviewGate
            ? { ...current.scriptReviewGate, deadlineAt: null }
            : current.scriptReviewGate,
        }),
  }))
}

/**
 * Mirrors the server's voice write onto the session atom. `voice_id`
 * moves with `voice` because readers fall back to it when the object is absent
 * (SessionVoiceoverTtsOwner), so a stale id has the session disagree with itself. An explicit
 * `voiceId` restores whichever pair was there before, for the rollback.
 */
function applyVoice(
  state: PlannerState,
  voice: null | ProjectVoiceOverJson,
  voiceId?: null | string,
): void {
  // With no session there is no voice to mirror.
  if (!state.get(getAdapterSessionAtom)) {
    return
  }
  const nextVoiceId = voiceId === undefined ? (voice?.voiceId ?? null) : voiceId
  state.set(getAdapterSessionAtom, (current) =>
    current ? { ...current, voice, voice_id: nextVoiceId } : current,
  )
}

function toPreviewPayloadFromFinal(final: {
  answerToMessageId?: string
  message: string
  sentFrom?: SimulatedEvent['sentFrom']
  uploadedAssets?: UploadedAsset[]
}): {
  answerToMessageId?: string
  message: string
  sentFrom?: SimulatedEvent['sentFrom']
  uploadedAssets?: SimulatedEvent['uploadedAssets']
} {
  return {
    answerToMessageId: final.answerToMessageId,
    message: final.message,
    sentFrom: final.sentFrom,
    uploadedAssets: final.uploadedAssets,
  }
}
