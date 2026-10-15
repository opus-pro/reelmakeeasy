import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'
import {
  CANCELLABLE_TOOL_NAMES,
  type CancellableToolName,
} from '@reelmakeeasy/common/workflow/uip-v2-signal-names'
import { atom } from 'jotai'

import { isAssetReady } from '../../planner/assetStatus'
import type { AssetRef, StoryModeQuickQuestionCardModel } from '../../state-types'
import { mapDraftFileType } from '../../utils/draft-file-utils'
import { getRenderStateAtom, getStopRequestedToolCallKeysAtom } from '../atoms/planner'
import { getDraftFileUploadsAtom, getDraftMessageAtom } from '../atoms/planner'

export const getIsQuickQuestionModeAtom = createWeakMapFn((scope) => {
  const a = atom((get) => get(getRenderStateAtom(scope)).quickOptions.length > 0)
  a.debugLabel = 'storyModeUip/computed/isQuickQuestionMode'
  return a
})

// Single source of the auto-continue default: the server only sends `false` for
// an explicit opt-out, so anything else (including a session predating the
// setting) is Auto. Both the mode selector and the composer's accent read this.
export const getIsAutoModeAtom = createWeakMapFn((scope) => {
  const a = atom((get) => get(getRenderStateAtom(scope)).autoContinueEnabled !== false)
  a.debugLabel = 'storyModeUip/computed/isAutoMode'
  return a
})

export const getIsPlannerActiveAtom = createWeakMapFn((scope) => {
  const a = atom((get) => get(getRenderStateAtom(scope)).status === 'active')
  a.debugLabel = 'storyModeUip/computed/isPlannerActive'
  return a
})

export const getQuickQuestionCardModelAtom = createWeakMapFn((scope) => {
  const a = atom<StoryModeQuickQuestionCardModel>((get) => {
    const renderState = get(getRenderStateAtom(scope))
    // The Stage 1 brand prompt is locked to A/B per the design;
    // hide the free-text composer row when those option ids appear.
    const isBrandBriefPrompt = renderState.quickOptions.some(
      (option) => option.id === 'paste_url' || option.id === 'write_description',
    )
    return {
      id: 'reply_options',
      expectAssets: renderState.expectAssets,
      options: renderState.quickOptions.map((option, index) => ({
        expectAssets: option.expectAssets,
        id: option.id,
        leadingLabel: String.fromCharCode(65 + index),
        text: option.text,
      })),
      showCustomOption: !isBrandBriefPrompt,
      title: renderState.assistantPrompt || 'Please choose one option.',
    }
  })

  a.debugLabel = 'storyModeUip/computed/quickQuestionCardModel'
  return a
})

export const getCanSubmitComposerAtom = createWeakMapFn((scope) => {
  const a = atom((get) => {
    const hasMessage = get(getDraftMessageAtom(scope)).trim().length > 0
    const hasAssets = get(getDraftFileUploadsAtom(scope)).length > 0
    return hasMessage || hasAssets
  })
  a.debugLabel = 'storyModeUip/computed/canSubmitComposer'
  return a
})

// ---------------------------------------------------------------------------
// Composer action (Send / Stop)
// ---------------------------------------------------------------------------

export interface CancellableRunningToolCall {
  /**
   * Identity of ONE running tool call: `${toolCallId}@${startedAt}`. The id alone
   * is the tool name (buildStartedToolCallState), so a re-run would reuse it --
   * pairing it with startedAt makes a later run a distinct key.
   */
  key: string
  toolName: CancellableToolName
}

export interface ComposerAction {
  /** Whether pressing the button does anything in the current state. */
  canPress: boolean
  mode: 'send' | 'stop'
}

/**
 * The running tool calls the user may stop. "Agent busy" for the composer means
 * exactly this list being non-empty: a tool running is the only thing the backend
 * can cancel (`POST /uip-sessions/:id/tool-cancellations`), so offering
 * Stop for any other kind of activity would promise something it cannot do.
 * Non-cancellable tools (e.g. generate_brand_styling) still paint "Thinking...";
 * they just leave the button on Send.
 */
export const getCancellableRunningToolCallsAtom = createWeakMapFn((scope) => {
  const a = atom<CancellableRunningToolCall[]>((get) => {
    // `?? []`: the field is required on RenderState, but a partial payload (or a
    // fixture built before it existed) must leave the composer on Send rather than
    // throw out of the whole planner tree.
    const toolCallStates = get(getRenderStateAtom(scope)).toolCallStates ?? []
    const running: CancellableRunningToolCall[] = []
    for (const toolCall of toolCallStates) {
      if (toolCall.status !== 'running') {
        continue
      }
      for (const tool of toolCall.tools) {
        if (isCancellableToolName(tool)) {
          running.push({ key: `${toolCall.id}@${toolCall.startedAt}`, toolName: tool })
        }
      }
    }
    return running
  })
  a.debugLabel = 'storyModeUip/computed/cancellableRunningToolCalls'
  return a
})

/**
 * True once every currently-running cancellable tool call has been asked to stop
 * and none has reported back yet. Self-clearing: a tool call that lands its
 * `tool_cancelled` leaves the running list, and a NEW tool call (new key) makes
 * this false again so the user can stop that one too.
 */
export const getIsStoppingToolsAtom = createWeakMapFn((scope) => {
  const a = atom((get) => {
    const running = get(getCancellableRunningToolCallsAtom(scope))
    if (running.length === 0) {
      return false
    }
    const requested = get(getStopRequestedToolCallKeysAtom(scope))
    return running.every((toolCall) => requested.includes(toolCall.key))
  })
  a.debugLabel = 'storyModeUip/computed/isStoppingTools'
  return a
})

/**
 * The one composer button, resolved (prototyped in
 * /playground/chat-stop-send-button):
 * - a cancellable tool is running AND the composer is empty -> Stop (disabled only
 *   while a stop is already in flight),
 * - otherwise -> Send, pressable exactly when there is something to send.
 *
 * Typing while the agent is busy therefore keeps Send: that message is queued and
 * runs after the current step, which stays the way to follow up without stopping.
 */
export const getComposerActionAtom = createWeakMapFn((scope) => {
  const a = atom<ComposerAction>((get) => {
    const canSubmit = get(getCanSubmitComposerAtom(scope))
    const isBusy = get(getCancellableRunningToolCallsAtom(scope)).length > 0
    if (isBusy && !canSubmit) {
      return { canPress: !get(getIsStoppingToolsAtom(scope)), mode: 'stop' }
    }
    return { canPress: canSubmit, mode: 'send' }
  })
  a.debugLabel = 'storyModeUip/computed/composerAction'
  return a
})

function isCancellableToolName(tool: string): tool is CancellableToolName {
  return (CANCELLABLE_TOOL_NAMES as readonly string[]).includes(tool)
}

export const getAssetsPoolByIdAtom = createWeakMapFn((scope) => {
  const a = atom((get) => {
    const { assetsPool } = get(getRenderStateAtom(scope))
    return new Map(assetsPool.map((asset) => [asset.id, asset]))
  })

  a.debugLabel = 'storyModeUip/computed/assetsPoolById'
  return a
})

export const getComposerAssetsAtom = createWeakMapFn((scope) => {
  const a = atom((get) => {
    const { uploadedAssetsPool, anchorAssetsPool } = get(getRenderStateAtom(scope))
    const draftFileUploads = get(getDraftFileUploadsAtom(scope))
    const draftUploadAssets: AssetRef[] = draftFileUploads.map((upload) => ({
      id: upload.id,
      label: upload.file.name,
      previewUrl: upload.file.type.startsWith('image/') ? upload.blobUrl : undefined,
      type: mapDraftFileType(upload.file.type),
    }))
    // Only ready anchors are mentionable: the pool now also carries failed/generating ones for
    // display, and @-mentioning those would hand the agent a tag with no image behind it.
    return [...draftUploadAssets, ...uploadedAssetsPool, ...anchorAssetsPool.filter(isAssetReady)]
  })

  a.debugLabel = 'storyModeUip/computed/composerAssets'
  return a
})

export const getAnchorAssetsPoolByIdAtom = createWeakMapFn((scope) => {
  const a = atom((get) => {
    const { anchorAssetsPool } = get(getRenderStateAtom(scope))
    return new Map(anchorAssetsPool.map((asset) => [asset.id, asset]))
  })

  a.debugLabel = 'storyModeUip/computed/anchorAssetsPoolById'
  return a
})

export const getBrandReviewGateAtom = createWeakMapFn((scope) => {
  const a = atom((get) => get(getRenderStateAtom(scope)).brandReviewGate)
  a.debugLabel = 'storyModeUip/computed/brandReviewGate'
  return a
})
