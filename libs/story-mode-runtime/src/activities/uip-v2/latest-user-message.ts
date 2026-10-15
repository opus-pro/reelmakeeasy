import type { QueuedUserItem } from '@reelmakeeasy/uip-planner-runtime'
import { buildQueuedDrainMessage } from '@reelmakeeasy/uip-planner-runtime'

import type { AgentEvent, UserMessageEvent } from '../../workflows/uip-v2/types'

function toQueuedItem(ev: UserMessageEvent): QueuedUserItem {
  return {
    answer_to_message_id: ev.answerToMessageId,
    created_at: ev.timestamp,
    id: ev.messageId,
    message: ev.message,
    sent_at: ev.sentAt,
    sent_from: ev.sentFrom,
    uploaded_assets: ev.uploadedAssets ?? [],
  }
}

/**
 * The user input that should drive THIS planner / tool turn, or ''.
 *
 * Two rules, both restoring V1 signal semantics that the V2 log-scan otherwise
 * loses:
 *
 * 1. Queued batch: the main loop drains every user_message that
 *    arrived while a prior turn was busy into a SINGLE turn. Feeding only the
 *    last one silently drops the middle edits. Mirror V1's queue drain --
 *    collect the trailing run of consecutive user_messages and render them via
 *    buildQueuedDrainMessage so the planner applies them all in order. (planner_start
 *    and user_wake are turn-internal markers and don't break the run.)
 *
 * 2. CTA trigger: a turn triggered by Create-video continue / plan confirm /
 *    brand-review confirm carries no fresh chat message -- it drives from the
 *    new phase. V1 sets a `__...__` sentinel that is never fed as a user message
 *    (run-planner-turn*.ts); we return ''. Without this a CTA turn re-feeds the
 *    last already-answered message (e.g. an audio-locked "change the transcript")
 *    and the planner re-answers it instead of advancing.
 *
 * 3a. GUI-wake consumed boundary: a debounced GUI wake drives a
 *    turn whose input is the edited artifact, not a chat message. Treat it like
 *    a CTA -- otherwise the scan walks past it to the last already-answered
 *    message and the planner re-answers that instead of reconciling the edit.
 *    It is deliberately NOT added to the rule-1 marker skip list: a wake can
 *    only fire when nothing decision-worthy followed the edit, so a message
 *    after the wake starts a genuinely new batch and the run should break here.
 *
 * 3. Brand-extraction consumed boundary: a brand-input user_message
 *    (e.g. "Here's my brand site: <url>") is consumed by the system-driven brand
 *    extraction, which -- unlike a CTA -- leaves no sentinel. Once extraction
 *    resolves (brand_extraction_ready / brand_extraction_failed), a later
 *    phase-driven turn such as entering brand_review must NOT re-feed that stale
 *    URL; if it does, the planner reads it as a fresh "use this source" and
 *    re-issues change_brand_extraction_source, re-extracting the same site
 *    unprompted. Treat the resolution event as a consumed
 *    boundary, exactly like a CTA. A genuinely new message typed after extraction
 *    arrives later in the scan and still drives the turn.
 *
 * The full transcript still lives in chain memory; this only governs the
 * per-turn "current user message" signal.
 */
export function resolveLatestUserMessage(
  events: AgentEvent[],
  opts?: { includePanelReference?: boolean },
): string {
  // The panel-source reference is a PLANNER-ONLY prompt hint and is
  // OFF by default. It must not reach tools: `prepareToolRuntime` passes this
  // same value into `buildDirectivesExtractionInput` -> `maybeExtractPastedScript`,
  // whose byte-for-byte paste extractor would otherwise treat the
  // synthetic "[Context] ..." line (or the batch "sent from:" line) as part of a
  // pasted script. Only the planner step opts in.
  const includePanelReference = opts?.includePanelReference ?? false
  // Trailing run of consecutive user_messages = the batch drained for this turn.
  const batch: UserMessageEvent[] = []
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (ev.type === 'user_message') {
      batch.push(ev)
      continue
    }
    if (ev.type === 'planner_start' || ev.type === 'user_wake') {
      continue
    }
    break
  }
  if (batch.length > 1) {
    batch.reverse() // newest-first -> chronological / FIFO
    return buildQueuedDrainMessage(batch.map(toQueuedItem), { includePanelReference })
  }

  // 0 or 1 trailing message: a single message drives the turn as-is; a CTA
  // trigger or a resolved brand extraction (hit before any user_message going
  // backward) resolves to '' -- both mark the prior message consumed.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]
    if (
      ev.type === 'user_continue_draft' ||
      ev.type === 'user_confirm' ||
      ev.type === 'user_confirm_brand_review' ||
      ev.type === 'brand_extraction_ready' ||
      ev.type === 'brand_extraction_failed' ||
      ev.type === 'user_gui_wake'
    ) {
      return ''
    }
    if (ev.type === 'user_message') {
      return includePanelReference && ev.sentFrom
        ? `[Context] This message was sent from the ${ev.sentFrom} panel.\n\n${ev.message}`
        : ev.message
    }
  }
  return ''
}
