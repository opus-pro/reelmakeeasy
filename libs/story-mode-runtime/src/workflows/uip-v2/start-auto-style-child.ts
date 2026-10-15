// Do NOT import VALUES from @reelmakeeasy/uip-planner-runtime here -- this file is part
// of the v2 workflow code (types-only imports from the planner runtime).
//
// Auto Style Selection runtime dispatch (preset-only): the
// RUNTIME -- never the planner LLM -- starts the select_auto_style tool child
// right after the brief completes, concurrently with script generation. Mirrors
// the eager brand-extraction precedent (workflow-brand.ts maybeStartBrandChild):
// a self-gated, idempotent function that folds its whole gate from the event log
// and starts an ABANDON tool-runner child. Kept in its own file (like
// start-pre-voiceover-child.ts) so workflow.ts stays under the max-lines cap.

import type { PatchOp, UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'
import {
  ParentClosePolicy,
  startChild,
  uuid4,
  workflowInfo,
} from '@reelmakeeasy/workflow-engine/workflow'

import { UipV2ToolRunnerWorkflow } from '../uip-v2-tool-runner/workflow'

import { appendEvent } from './event-log'
import { foldPhase, foldSpecVersion, hasAudio, toolSucceeded } from './folds'
import { nowIso } from './planner-turn-helpers'
import type { AgentEvent, WorkflowState } from './types'

/**
 * Latest value written to a scalar global_constraints `path` via
 * update_global_field in one spec_patched's ops, or `fallback` if none touch it.
 * Op-shape scan (no value import of patch-apply); later ops win.
 */
function foldGlobalFieldFromOps(
  ops: Extract<AgentEvent, { type: 'spec_patched' }>['ops'],
  path: string,
  fallback: null | string,
): null | string {
  let value = fallback
  for (const op of ops) {
    if (op.op === 'update_global_field' && op.path === path) {
      value = typeof op.value === 'string' ? op.value : null
    }
  }
  return value
}

/**
 * Whether a CONCRETE style is already applied -- style_name or style_text is
 * non-empty after folding the initial snapshot + any `update_global_field` op on
 * `style` (whole object) or its `style.style_name` / `style.style_text` leaves.
 * Read as a belt so the runtime never dispatches select_auto_style over a style
 * the user (manual seed) or a prior auto pick already set. Later events win.
 */
function hasSelectedStyle(events: AgentEvent[]): boolean {
  let styleName = ''
  let styleText = ''
  for (const e of events) {
    if (e.type === 'session_initialized') {
      const style = e.initialSpecSnapshot?.global_constraints?.style
      styleName = style?.style_name ?? ''
      styleText = style?.style_text ?? ''
    } else if (e.type === 'spec_patched') {
      ;({ styleName, styleText } = foldStyleFromOps(e.ops, styleName, styleText))
    }
  }
  return styleName.trim() !== '' || styleText.trim() !== ''
}

/** Apply one spec_patched's `style` / `style.*` writes onto the folded pair. */
function foldStyleFromOps(
  ops: Extract<AgentEvent, { type: 'spec_patched' }>['ops'],
  styleName: string,
  styleText: string,
): { styleName: string; styleText: string } {
  for (const op of ops) {
    if (op.op !== 'update_global_field') {
      continue
    }
    if (op.path === 'style') {
      const value = op.value as null | { style_name?: string; style_text?: string }
      styleName = value?.style_name ?? ''
      styleText = value?.style_text ?? ''
    } else if (op.path === 'style.style_name') {
      styleName = typeof op.value === 'string' ? op.value : ''
    } else if (op.path === 'style.style_text') {
      styleText = typeof op.value === 'string' ? op.value : ''
    }
  }
  return { styleName, styleText }
}

/**
 * Gate condition 3: whether a brand session has COMMITTED a brand
 * look -- brand_style_text or brand_style_directive is set (non-empty / non-null)
 * after folding the initial snapshot + later update_global_field ops on those
 * paths. Such a session confirmed its own styling in brand_review and must NOT
 * get an auto-style pick layered on top. Later events win.
 */
function foldBrandLook(events: AgentEvent[]): {
  brandStyleDirective: null | string
  brandStyleText: null | string
} {
  let brandStyleText: null | string = null
  let brandStyleDirective: null | string = null
  for (const e of events) {
    if (e.type === 'session_initialized') {
      const gc = e.initialSpecSnapshot?.global_constraints
      brandStyleText = gc?.brand_style_text ?? null
      brandStyleDirective = gc?.brand_style_directive ?? null
    } else if (e.type === 'spec_patched') {
      brandStyleText = foldGlobalFieldFromOps(e.ops, 'brand_style_text', brandStyleText)
      brandStyleDirective = foldGlobalFieldFromOps(
        e.ops,
        'brand_style_directive',
        brandStyleDirective,
      )
    }
  }
  return { brandStyleDirective, brandStyleText }
}

// Only a REAL committed brand style suppresses the auto pick --
// a concrete `brand_style_text`, or the `hybrid` directive (whose text may only be
// generated later at bootstrap_script). `keep_existing_style` is deliberately NOT
// a committed look: it means "keep whatever style the flow produces", which for a
// `style_mode: 'auto'` session IS the auto pick. Manual style picks never reach
// here anyway -- they set `style_mode: 'manual'`, caught by the earlier gate.
function hasCommittedBrandStyle(events: AgentEvent[]): boolean {
  const { brandStyleDirective, brandStyleText } = foldBrandLook(events)
  return (brandStyleText?.trim() ?? '') !== '' || brandStyleDirective === 'hybrid'
}

/**
 * Provenance of the CURRENT `style` after folding the initial snapshot +
 * later `update_global_field` ops on `style_source` (later wins). Mirrors the
 * foldBrandLook fold. A runtime auto pick writes `style_source='auto'` only in
 * the activity-side foldSession (never a spec_patched), so it never surfaces here
 * -- this fold is explicitly non-null ('auto_switched'/'manual') ONLY when the
 * user/planner committed a switch via a spec_patched (or the seed snapshot).
 */
function foldStyleSource(events: AgentEvent[]): null | string {
  let source: null | string = null
  for (const e of events) {
    if (e.type === 'session_initialized') {
      source = e.initialSpecSnapshot?.global_constraints?.style_source ?? null
    } else if (e.type === 'spec_patched') {
      source = foldGlobalFieldFromOps(e.ops, 'style_source', source)
    }
  }
  return source
}

/**
 * Whether the CURRENT style is one the user named in their PROMPT:
 * generate_intent_context applies such a style with `style_source: 'manual'`
 * plus `selection_method: 'user_prompt'`.
 *
 * Folded from all three writers the way foldRankingInputs is -- and the brief's
 * OUTPUT is the one that actually carries it, because the brief auto-applies its
 * global_constraints activity-side (foldSession's AUTO_APPLY_TOOLS staging),
 * never as a spec_patched, so the spec_patched-only foldStyleSource above cannot
 * see this at all.
 *
 * A later UI style switch patches `style_source: 'auto_switched'` and so
 * releases this: from then on the session is an ordinary user switch, which the
 * product decision does allow a brief change to re-pick over.
 */
function hasPromptExpressedStyle(events: AgentEvent[]): boolean {
  let source: null | string = null
  let method: null | string = null
  for (const e of events) {
    if (e.type === 'session_initialized') {
      const gc = e.initialSpecSnapshot?.global_constraints
      source = gc?.style_source ?? null
      method = gc?.selection_method ?? null
    } else if (e.type === 'tool_completed' && e.toolName === 'generate_intent_context') {
      const gc = (e.output as undefined | { global_constraints?: Record<string, unknown> })
        ?.global_constraints
      if (typeof gc?.style_source === 'string') {
        source = gc.style_source
      }
      if (typeof gc?.selection_method === 'string') {
        method = gc.selection_method
      }
    } else if (e.type === 'spec_patched') {
      source = foldGlobalFieldFromOps(e.ops, 'style_source', source)
      method = foldGlobalFieldFromOps(e.ops, 'selection_method', method)
    }
  }
  return source === 'manual' && method === 'user_prompt'
}

/**
 * Array index of the last select_auto_style `tool_started` (a pick was
 * launched), or -1 if none. -1 means "never dispatched" -> the first-dispatch
 * path. A concrete index means a prior pick exists -> the re-selection path.
 */
function lastPickStartedIndex(events: AgentEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'tool_started' && e.toolName === 'select_auto_style') {
      return i
    }
  }
  return -1
}

/**
 * The brief fields select_auto_style actually ranks from. Its prompt renders
 * exactly topic / tone / genre (uip-planner-runtime's select-auto-style.ts), so
 * these three -- and only these -- are what makes a prior pick stale.
 */
const AUTO_STYLE_RANKING_PATHS = ['genre', 'tone', 'topic'] as const

/** The three ranking inputs, folded. Absent reads as the empty string. */
type RankingInputs = Record<string, string>

/** Whole-object assign from a snapshot's global_constraints (absent clears). */
function assignRankingInputs(value: RankingInputs, gc: Record<string, unknown> | undefined): void {
  for (const path of AUTO_STYLE_RANKING_PATHS) {
    value[path] = typeof gc?.[path] === 'string' ? (gc[path] as string) : ''
  }
}

/** Merge only the fields the brief's output actually carries (absent keeps). */
function mergeRankingInputs(value: RankingInputs, gc: Record<string, unknown> | undefined): void {
  for (const path of AUTO_STYLE_RANKING_PATHS) {
    if (typeof gc?.[path] === 'string') {
      value[path] = gc[path] as string
    }
  }
}

/** Apply one spec_patched's update_global_field ops on the ranking paths. */
function patchRankingInputs(
  value: RankingInputs,
  ops: Extract<AgentEvent, { type: 'spec_patched' }>['ops'],
): void {
  for (const op of ops) {
    if (
      op.op === 'update_global_field' &&
      (AUTO_STYLE_RANKING_PATHS as readonly string[]).includes(op.path)
    ) {
      value[op.path] = typeof op.value === 'string' ? op.value : ''
    }
  }
}

/** Route one event to the writer for its source. */
function applyRankingInputEvent(value: RankingInputs, e: AgentEvent): void {
  if (e.type === 'session_initialized') {
    assignRankingInputs(
      value,
      e.initialSpecSnapshot?.global_constraints as Record<string, unknown> | undefined,
    )
  } else if (e.type === 'tool_completed' && e.toolName === 'generate_intent_context') {
    mergeRankingInputs(
      value,
      (e.output as undefined | { global_constraints?: Record<string, unknown> })
        ?.global_constraints,
    )
  } else if (e.type === 'spec_patched') {
    patchRankingInputs(value, e.ops)
  }
}

/**
 * Fold the pick's ranking inputs over `events[0, untilIdx)`, serialized so two
 * folds compare with `===`. Later writes win, from all three places these fields
 * actually move:
 *   - the initial spec snapshot;
 *   - generate_intent_context's `tool_completed` OUTPUT (the brief auto-applies
 *     its global_constraints through the output, never a spec_patched);
 *   - `update_global_field` ops on those paths.
 *
 * That last source is the one this feature originally missed. Verified against a
 * real lane session: a chat-driven topic change
 * lands as a single planner-sourced `spec_patched` writing `topic`, and
 * generate_intent_context does NOT run a second time. The whole 91-event log held
 * exactly one brief completion, so a trigger keyed on "a newer brief completion"
 * could never fire -- the user saw the summary card update (it renders
 * global_constraints.topic) while the workflow saw no new brief at all.
 *
 * JSON, not a delimiter join: a topic is free text and may contain any separator.
 */
function foldRankingInputs(events: AgentEvent[], untilIdx: number): string {
  const value: RankingInputs = { genre: '', tone: '', topic: '' }
  const end = Math.min(untilIdx, events.length)
  for (let i = 0; i < end; i++) {
    applyRankingInputEvent(value, events[i])
  }
  return JSON.stringify(AUTO_STYLE_RANKING_PATHS.map((path) => value[path]))
}

/**
 * Start the select_auto_style tool child once the brief is complete (spec
 * section 5). Idempotent: every guard is an event-log fold.
 * The child fires ONCE PER BRIEF: the first-ever pick on a fresh auto session (no
 * prior select_auto_style tool_started, no concrete seed style, no committed brand
 * look), and a RE-selection whenever a fresh generate_intent_context completes AFTER
 * the last pick launched -- a chat-driven topic change, or the brand re-entry
 * (brand_review -> bootstrap_script). Unlike the retired Task 8B rule, a
 * user-committed style does NOT block the re-selection; the provenance is reset to
 * 'auto' first so the new pick can land, and the UI surfaces the swap.
 * The child ABANDONs so it survives a parent continueAsNew; its result folds
 * back via the existing AUTO_APPLY_TOOLS staging (Task 7a).
 *
 * Called AFTER the planner turn (workflow.ts, right after maybeReExtractBrandChild)
 * so it runs CONCURRENTLY with the planner's generate_explainer_script: both
 * ABANDON children are in flight and the loop parks at the 7f.1 open-tool guard
 * until BOTH complete. Dispatching before the planner turn would serialize them.
 */
export async function maybeStartAutoStyleChild(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
  taskQueue: string,
): Promise<void> {
  if (
    // styleMode is pinned from spec.global_constraints.style_mode; the API layer
    // forces 'manual' whenever autoStyleEnabled is false, so this alone is the
    // feature gate. Absent => manual (legacy / pre-feature).
    params.styleMode !== 'auto' ||
    // Brief complete: generate_intent_context succeeded.
    !toolSucceeded(state.events, 'generate_intent_context')
  ) {
    return
  }

  // Phase gate. bootstrap_script and script_review qualify -- script_review not
  // just for the re-run: a fresh auto session with no prior
  // pick that somehow reaches script_review still needs one dispatched here, or it
  // renders on the catalog-first fallback preset (phase-machine.ts's
  // maybeSeedFallbackStyle, seeded on the script_review -> bootstrap_visual advance)
  // instead of a brief-ranked pick. bootstrap_visual and later stay closed: past the
  // visual-render lock a style change is discarded anyway.
  const phase = foldPhase(state.events)
  if (phase !== 'bootstrap_script' && phase !== 'script_review') {
    return
  }

  // Gate condition 3: exempt a brand session that committed a CONCRETE brand
  // style ("a real committed style", not any brand directive, so
  // keep_existing_style + style_mode='auto' does not suppress the pick).
  if (hasCommittedBrandStyle(state.events)) {
    return
  }

  // Idempotency + re-selection. The pick fires ONCE PER BRIEF: a fresh
  // generate_intent_context that completes after the last pick launched re-opens
  // it. The gate is monotone (each brief completion unlocks at most one dispatch),
  // so it cannot loop.
  const pickStartedIdx = lastPickStartedIndex(state.events)
  let resetProvenance = false
  if (pickStartedIdx < 0) {
    // First-ever dispatch. Belt: never clobber a concrete style already set at
    // seed (manual) or by a prior spec_patched.
    if (hasSelectedStyle(state.events)) {
      return
    }
  } else {
    // Re-pick when the pick's RANKING INPUTS moved since the last dispatch -- not
    // when the brief tool re-ran. See foldRankingInputs for the lane evidence: a
    // chat topic change patches `topic` and never re-runs generate_intent_context,
    // so the brief-completion test this replaces could not fire at all.
    //
    // Comparing folded values rather than event positions also means a planner
    // rewriting a field to the value it already held is not a change, so it costs
    // no pick.
    if (
      foldRankingInputs(state.events, pickStartedIdx) ===
      foldRankingInputs(state.events, state.events.length)
    ) {
      return
    }
    // Never re-pick over a style the user named in their prompt. The
    // topic-change re-pick exists to replace a STALE AGENT GUESS; a style the
    // user asked for in words is not a guess, and swapping it out is the exact
    // complaint that ticket filed.
    if (hasPromptExpressedStyle(state.events)) {
      return
    }
    // hasSelectedStyle is deliberately NOT re-checked: the prior pick's style is
    // concrete but stale, which is the whole reason we are re-picking.
    //
    // A user-committed source would make the new pick's auto-apply drop its
    // style / style_source writes (globalConstraintArtifactFieldsForTool), so the
    // re-run would silently do nothing. Reset it to 'auto' below. Conditional so
    // an ordinary re-run writes no redundant op, and so the provenance stays
    // honest for sessions the user never touched.
    const committedSource = foldStyleSource(state.events)
    resetProvenance = committedSource === 'auto_switched' || committedSource === 'manual'
  }

  // Hand the re-pick a non-user-committed provenance so its auto-apply is allowed
  // to write `style` again. Deliberately kept in the workflow rather than relaxing
  // auto-apply-runtime's suppression: that suppression also protects the FIRST
  // pick from landing on top of a user who switched while it was still in flight,
  // and that protection must stay. Ordering matters -- the reset must be in the
  // log before the child starts, because the child folds the events snapshot it is
  // handed.
  //
  // Accepted inaccuracy: between here and the pick landing, style_source reads
  // 'auto' while the applied style is still the user's earlier choice; a re-pick
  // that then fails leaves it permanently mislabelled. The field is read at confirm
  // and in analytics only.
  if (resetProvenance) {
    const resetOps: PatchOp[] = [{ op: 'update_global_field', path: 'style_source', value: 'auto' }]
    appendEvent(state, {
      type: 'spec_patched',
      ops: resetOps,
      source: 'system',
      specVersionAfter: foldSpecVersion(state.events) + 1,
      timestamp: nowIso(),
    })
  }

  const parentWorkflowId = workflowInfo().workflowId
  const toolCallId = uuid4()
  const childWorkflowId = `ao:${params.projectId}:tool:${toolCallId}`
  const startedAt = nowIso()

  // toolInput is {}: the activity reads the preset catalog off meta.style_catalog
  // and the brief off global_constraints from the folded session -- it needs
  // nothing tool-specific here (see select-auto-style.ts).
  await startChild(UipV2ToolRunnerWorkflow, {
    args: [
      {
        currentArtifacts: state.currentArtifacts,
        events: [...state.events],
        parentWorkflowId,
        projectId: params.projectId,
        taskQueue,
        toolCallId,
        toolInput: {},
        toolName: 'select_auto_style',
      },
    ],
    parentClosePolicy: ParentClosePolicy.ABANDON,
    taskQueue,
    workflowId: childWorkflowId,
  })

  appendEvent(state, {
    type: 'tool_started',
    childWorkflowId,
    startedAt,
    toolCallId,
    toolInput: {},
    toolName: 'select_auto_style',
  })
  state.activeToolCalls.set(toolCallId, {
    childWorkflowId,
    startedAt,
    toolName: 'select_auto_style',
  })
}

/**
 * Audio-only EARLY dispatch, called before advancePhase (workflow.ts 7d.3).
 *
 * An audio session's `audioScriptReady` advance trigger is satisfied by the
 * brief's own `tool_completed`, so bootstrap_script -> script_review fires on that
 * very wake -- and the normal 7g.3 dispatch, which runs after advancePhase, would
 * observe script_review and skip the pick forever (the session then renders on the
 * catalog-first fallback preset). Dispatching here keeps it inside the window;
 * advancePhase then holds on the existing autoStyleSelectionPending gate and 7f.1
 * parks the planner while the pick runs.
 *
 * Audio-only on purpose. Holding the phase instead would make the planner take a
 * turn in a stale bootstrap_script, which the recovery validator rejects as a
 * system-owned phase boundary -- the user sees a "ran into the same
 * issue" message. And dispatching early for NON-audio sessions would serialize the
 * pick ahead of generate_explainer_script (7f.1 parks the planner once a tool is
 * open), losing the concurrency 7g.3 exists for; those sessions advance on the
 * script tool, so their window stays open and 7g.3 already works.
 *
 * Delegates to the same self-gated maybeStartAutoStyleChild, so every dispatch
 * guard (feature gate, brief, brand suppression, idempotency) still applies and a
 * second call at 7g.3 is a no-op.
 */
export async function maybeStartAutoStyleChildEarly(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
  taskQueue: string,
): Promise<void> {
  if (!hasAudio(state.events)) {
    return
  }
  await maybeStartAutoStyleChild(state, params, taskQueue)
}
