/**
 * Auto Style Selection (V1) phase-advance folds.
 *
 * Pure projections over the AgentEvent log that back the two phase-machine
 * behavior changes in Task 8 (advanceBootstrapScript terminal-state gate +
 * advanceScriptReview empty-style fallback). Kept out of the general `folds.ts`
 * so that module stays under its max-lines cap and the auto-style-advance logic
 * is cohesive with the dispatch gate in start-auto-style-child.ts.
 *
 * Runs in workflow code, kept light: types from `@reelmakeeasy/uip-planner-runtime` are
 * imported via `import type` ONLY; all event types come from the local
 * `./types` module.
 */

import type { StylePreset } from '@reelmakeeasy/uip-planner-runtime'

import type { AgentEvent } from './types'

/** The runtime-dispatched Auto Style Selection tool name. */
const AUTO_STYLE_TOOL_NAME = 'select_auto_style'

/**
 * Whether the LATEST `select_auto_style` dispatch is still in flight and the
 * bootstrap_script -> script_review advance must therefore hold for it.
 *
 * Gates on the outcome of the LAST dispatch, not on "any terminal ever seen":
 *   - Returns FALSE when NO `select_auto_style` `tool_started` exists. The
 *     section 5 dispatch gate (start-auto-style-child.ts) can intentionally SKIP the pick
 *     (e.g. a committed brand look), so no event ever arrives -- holding on a
 *     `toolReachedTerminal` miss there hung bootstrap_script to the idle timeout.
 *   - Returns FALSE once the latest dispatch settles -- `tool_completed`,
 *     `tool_failed`, OR `tool_cancelled` (cancellation counts as terminal). A
 *     FAILED / cancelled pick still unblocks; the empty-style fallback at
 *     bootstrap_visual entry seeds a safe default.
 *   - Returns TRUE while the latest dispatch has no matching terminal, EVEN IF
 *     an OLDER dispatch already reached a terminal state -- a re-selection
 *     in flight must still hold, which a name-only
 *     `toolReachedTerminal` scan (satisfied by the stale terminal) would miss.
 *
 * A dispatch is identified by its `toolCallId`; the terminal is matched on the
 * same id. Pure fold over the event log.
 */
export function autoStyleSelectionPending(events: AgentEvent[]): boolean {
  let latestStarted: Extract<AgentEvent, { type: 'tool_started' }> | undefined
  for (const e of events) {
    if (e.type === 'tool_started' && e.toolName === AUTO_STYLE_TOOL_NAME) {
      latestStarted = e
    }
  }
  if (!latestStarted) {
    return false
  }
  const settled = events.some(
    (e) =>
      (e.type === 'tool_completed' || e.type === 'tool_failed' || e.type === 'tool_cancelled') &&
      e.toolCallId === latestStarted.toolCallId,
  )
  return !settled
}

/**
 * Whether this session was seeded in AUTO style-selection mode --
 * `global_constraints.style_mode === 'auto'` on the initial spec snapshot.
 * `style_mode` is pinned at session creation (the API layer forces 'manual' when
 * the gate is off) and is deliberately excluded from `update_global_field`'s
 * allowlist, so it never changes after seed -- folding the initial snapshot is
 * replay-safe, and the snapshot (`session_initialized`) always survives
 * continueAsNew compaction. Absent snapshot / style_mode folds to non-auto
 * (legacy / pre-feature).
 */
export function isAutoStyleSession(events: AgentEvent[]): boolean {
  const init = events.find((e) => e.type === 'session_initialized')
  if (init?.type !== 'session_initialized') {
    return false
  }
  return init.initialSpecSnapshot?.global_constraints?.style_mode === 'auto'
}

/**
 * The Auto Style Selection ranking catalog (Task 6B) seeded onto the initial
 * spec snapshot's `meta.style_catalog`, or `[]` when absent (gate-off / legacy
 * seed). Read from the `session_initialized` snapshot, which survives
 * continueAsNew compaction; the fallback-default seeding at bootstrap_visual
 * entry picks the first non-Animation preset from it.
 */
export function foldStyleCatalog(events: AgentEvent[]): StylePreset[] {
  const init = events.find((e) => e.type === 'session_initialized')
  if (init?.type !== 'session_initialized') {
    return []
  }
  return init.initialSpecSnapshot?.meta?.style_catalog ?? []
}

/**
 * The brief tool. Like `select_auto_style` it auto-applies
 * `global_constraints.style` through its `tool_completed` OUTPUT rather than a
 * `spec_patched` event, so the fold below only sees its style by reading the
 * output: a brand session that committed a style (`brand_style_directive:
 * 'hybrid'`) has its brand look copied onto `style.style_text` by the brief
 * activity (tool-runtime-asset-context-tools.ts).
 */
const BRIEF_TOOL_NAME = 'generate_intent_context'

/** The folded style plus the provenance that decides whether the brief may write it. */
interface StyleFold {
  source: null | string
  styleName: string
  styleText: string
}

/**
 * Fold the current `global_constraints.style` name/text from the initial spec
 * snapshot plus any later `update_global_field` op on `style` (whole object) or
 * its `style.style_name` / `style.style_text` leaves. Later events win. Mirrors
 * the dispatch-gate fold in start-auto-style-child.ts; used at bootstrap_visual
 * entry to decide whether a concrete style is already applied (skip the
 * fallback) or the render would go out unstyled (seed a safe default).
 *
 * It also folds generate_intent_context's output style. Without
 * that, a brand session that committed a style -- whose look
 * arrives ONLY that way, because the pick is suppressed by design -- reads as
 * unstyled and the fallback overwrites the user's brand style with the first
 * catalog preset.
 *
 * The brief branch mirrors its auto-apply mapper EXACTLY
 * (globalConstraintArtifactFieldsForTool), because for this tool an empty output
 * style is a destructive ASSIGNMENT, not an absence of information: the brief
 * rebuilds `style` from the seed on every run (generate-intent-context.ts) and the
 * seed is dropped outright for auto sessions (uip-create-session.ts), so a re-run
 * legitimately empties the style. Hence:
 *   - no provenance yet (style_source null) -> the mapper writes `style`, so the
 *     fold ASSIGNS it, empty included (a brand re-entry that dropped 'hybrid' must
 *     still get the fallback);
 *   - provenance set -> the mapper DROPS `style`, so the fold ignores the brief
 *     entirely (a landed pick / user switch / seeded fallback is never undone).
 * Reading the brief as "keep previous when empty" instead would leave the fold
 * claiming a style the spec no longer has, skipping the fallback and shipping a
 * genuinely unstyled render.
 */
export function foldGlobalStyle(events: AgentEvent[]): { styleName: string; styleText: string } {
  let fold: StyleFold = { source: null, styleName: '', styleText: '' }
  for (const e of events) {
    fold = foldStyleEvent(fold, e)
  }
  return { styleName: fold.styleName, styleText: fold.styleText }
}

/** Apply one event to the running style + provenance fold. */
function foldStyleEvent(fold: StyleFold, e: AgentEvent): StyleFold {
  if (e.type === 'session_initialized') {
    const gc = e.initialSpecSnapshot?.global_constraints
    return {
      source: gc?.style_source ?? null,
      styleName: gc?.style?.style_name ?? '',
      styleText: gc?.style?.style_text ?? '',
    }
  }
  if (e.type === 'spec_patched') {
    return {
      ...applyStyleOps(e.ops, fold),
      source: styleSourceFromOps(e.ops, fold.source),
    }
  }
  if (e.type !== 'tool_completed') {
    return fold
  }
  if (e.toolName === AUTO_STYLE_TOOL_NAME) {
    // The pick's output carries the WHOLE global_constraints with `style` merged
    // (never blanked) plus style_source='auto', so keep-previous-on-empty here is
    // a belt, not a semantic: it can only ever be a no-op.
    const applied = outputStyle(e.output)
    return {
      ...(applied && (applied.style_name || applied.style_text)
        ? { styleName: applied.style_name ?? '', styleText: applied.style_text ?? '' }
        : { styleName: fold.styleName, styleText: fold.styleText }),
      source: outputStyleSource(e.output) ?? fold.source,
    }
  }
  if (e.toolName !== BRIEF_TOOL_NAME || fold.source != null) {
    return fold
  }
  const applied = outputStyle(e.output)
  if (!applied) {
    return fold
  }
  // The brief may now also OWN the provenance -- it writes
  // style_source='manual' + selection_method='user_prompt' when it captures a
  // style the user named in their prompt, and the mapper lets both land. Adopt
  // it here or this fold claims "no provenance" while the spec has one, and a
  // later brief re-run (whose style the mapper drops) would be folded as an
  // empty ASSIGN -- reading the session as unstyled and letting the
  // bootstrap_visual fallback overwrite the user's style with the first catalog
  // preset. A pre-change brief output carries no style_source, so
  // `?? fold.source` reproduces the old value exactly.
  return {
    source: outputStyleSource(e.output) ?? fold.source,
    styleName: applied.style_name ?? '',
    styleText: applied.style_text ?? '',
  }
}

/** `global_constraints.style` off a tool_completed output, or undefined. */
function outputStyle(output: unknown): undefined | { style_name?: string; style_text?: string } {
  return (
    output as
      | undefined
      | { global_constraints?: { style?: { style_name?: string; style_text?: string } } }
  )?.global_constraints?.style
}

/** `global_constraints.style_source` off a tool_completed output, or undefined. */
function outputStyleSource(output: unknown): string | undefined {
  const source = (output as undefined | { global_constraints?: { style_source?: unknown } })
    ?.global_constraints?.style_source
  return typeof source === 'string' && source !== '' ? source : undefined
}

/** Latest `style_source` written by one spec_patched's ops; later ops win. */
function styleSourceFromOps(
  ops: Extract<AgentEvent, { type: 'spec_patched' }>['ops'],
  fallback: null | string,
): null | string {
  let source = fallback
  for (const op of ops) {
    if (op.op === 'update_global_field' && op.path === 'style_source') {
      source = typeof op.value === 'string' ? op.value : null
    }
  }
  return source
}

/** Apply one spec_patched's `style` / `style.*` writes onto the folded pair. */
function applyStyleOps(
  ops: Extract<AgentEvent, { type: 'spec_patched' }>['ops'],
  style: { styleName: string; styleText: string },
): { styleName: string; styleText: string } {
  let { styleName, styleText } = style
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
