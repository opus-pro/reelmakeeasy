import { toast } from '@shared/ui'

import { isPastUserEditWindow } from '@/components/story-mode-canvas/sections/sectionLock'

import type { SummaryUpdateInput } from '../../adapter/api-types'
import type { SummaryDraft } from '../../state-types'
import {
  getApiAtom,
  getRenderStateAtom,
  getSummaryCommitChainAtom,
  getSummaryDraftAtom,
  getSummaryDraftBaselineAtom,
  getSummaryDraftEditedAtom,
} from '../atoms/planner'
import type { PlannerApi } from '../planner-api'
import type { PlannerState } from '../planner-state'

const EMPTY_SUMMARY_DRAFT: SummaryDraft = { description: '', directives: [], mustNotViolate: [] }

interface PendingSummaryEdit {
  api: PlannerApi
  draft: SummaryDraft
  globalConstraints: SummaryUpdateInput['globalConstraints']
  snapshot: string
}

function listsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

// Reads the current draft synchronously and decides whether there is
// anything to send. Diffs against the baseline so a commit only sends the
// fields the user actually changed -- otherwise every commit would resend
// the whole draft, including a description that's still showing the "No
// summary yet." placeholder text.
function buildPendingSummaryEdit(state: PlannerState): null | PendingSummaryEdit {
  if (!state.get(getSummaryDraftEditedAtom)) {
    return null
  }

  if (isPastUserEditWindow(state.get(getRenderStateAtom))) {
    // Past this point the API rejects the save (409) and the modal no longer
    // offers a way to flush it, so drop the pending edit instead of retrying it.
    state.set(getSummaryDraftEditedAtom, false)
    return null
  }

  const draft = state.get(getSummaryDraftAtom)
  if (!draft) {
    return null
  }

  const api = state.get(getApiAtom)
  if (!api) {
    toast.error('Planner API is not ready yet.')
    return null
  }

  const baseline = state.get(getSummaryDraftBaselineAtom) ?? EMPTY_SUMMARY_DRAFT
  const directives = draft.directives.filter((s) => s.trim().length > 0)
  const mustNotViolate = draft.mustNotViolate.filter((s) => s.trim().length > 0)

  const globalConstraints: SummaryUpdateInput['globalConstraints'] = {}
  if (draft.description !== baseline.description) {
    globalConstraints.topic = draft.description
  }
  if (!listsEqual(draft.directives, baseline.directives)) {
    globalConstraints.directives = directives
  }
  if (!listsEqual(draft.mustNotViolate, baseline.mustNotViolate)) {
    globalConstraints.must_not_violate = mustNotViolate
  }

  if (Object.keys(globalConstraints).length === 0) {
    return null
  }

  return { api, draft, globalConstraints, snapshot: JSON.stringify(draft) }
}

async function sendPendingSummaryEdit(state: PlannerState, pending: PendingSummaryEdit) {
  // Re-check here, not just in buildPendingSummaryEdit: a save queued behind
  // the commit chain can sit until the phase flips past the window, and the
  // build-time check can't see a flip that happens while it's waiting.
  if (isPastUserEditWindow(state.get(getRenderStateAtom))) {
    state.set(getSummaryDraftEditedAtom, false)
    return
  }

  try {
    await pending.api.sendSummaryUpdate({
      globalConstraints: pending.globalConstraints,
      requestId: crypto.randomUUID(),
    })
    state.set(getSummaryDraftBaselineAtom, pending.draft)
    // Only clear dirty if no newer edit landed while this send was in flight;
    // a newer edit's own commit will send it, and the SSE-rehydration guard
    // must keep treating the draft as dirty until then.
    if (JSON.stringify(state.get(getSummaryDraftAtom)) === pending.snapshot) {
      state.set(getSummaryDraftEditedAtom, false)
    }
  } catch (error) {
    if (isPastUserEditWindow(state.get(getRenderStateAtom))) {
      state.set(getSummaryDraftEditedAtom, false)
      return
    }
    const errorMessage = error instanceof Error ? error.message : 'Failed to save summary edits'
    toast.error(errorMessage)
  }
}

// Persists the editable Summary card via the passive POST /summary
// endpoint. No-ops when the user hasn't touched the card, or when the draft
// hasn't actually diverged from its baseline. On success the dirty flag
// clears so the next SSE-pushed block rehydrates the draft; on failure the
// flag is left set so a retry (next send) re-sends the pending edit.
//
// Saves are serialized per planner: while a save is in flight, a subsequent
// commit's POST is queued behind it instead of firing concurrently -- an
// older POST resolving after a newer one would otherwise overwrite the
// user's latest edit on the next SSE-pushed block.
export function commitSummaryEdit(state: PlannerState): Promise<void> {
  const pending = buildPendingSummaryEdit(state)
  if (!pending) {
    return Promise.resolve()
  }

  const inFlight = state.get(getSummaryCommitChainAtom)
  const next = inFlight
    ? inFlight.then(() => sendPendingSummaryEdit(state, pending))
    : sendPendingSummaryEdit(state, pending)

  state.set(getSummaryCommitChainAtom, next)
  void next.finally(() => {
    if (state.get(getSummaryCommitChainAtom) === next) {
      state.set(getSummaryCommitChainAtom, null)
    }
  })

  return next
}
