// Do NOT import from workflow.ts
//
// UIP V2 -- select_auto_style TOOL ACTIVITY (Auto Style Selection V1
// spec, "preset-only"). Thin wrapper around the pure `runSelectAutoStyle`
// ranking tool (libs/uip-planner-runtime/src/tools/select-auto-style.ts):
// folds the event log into a V1 SessionState (same `prepareToolRuntime` path
// every sibling tool activity uses), derives `BriefFacts` from the folded
// `global_constraints`, runs the ranking, and FIELD-LEVEL writes the result
// onto `session.spec.global_constraints`: `.style` (top pick only, merged --
// not replacing the sub-object), `.style_candidates`, `.style_source='auto'`,
// `.selection_method`.
//
// Unlike generate-intent-context.ts (which STAGES its output onto
// `cached_artifacts.pending_global_constraints` for a later auto-apply ops
// mapper to fold into the spec), this tool writes the four style fields
// directly. Those fields are independent of the rest of `global_constraints`
// (topic/tone/directives/... written earlier by generate_intent_context), so a
// plain field assignment can never clobber the brief -- there is no risk of
// the "replace the whole object" mistake a naive `gc = {...}` reassignment
// would cause.
//
// Instrumentation happens HERE (the activity layer): `logger.warn` fires only
// when the method degrades off the primary LLM-ranking path (heuristic_fallback
// / fallback_default), so an operator can spot ranking quality regressing in the
// logs.

import { createSubLogger } from '@reelmakeeasy/common/logger'
import type {
  BriefFacts,
  GlobalConstraints,
  StyleCandidate,
  StylePreset,
} from '@reelmakeeasy/uip-planner-runtime'
import { runSelectAutoStyle } from '@reelmakeeasy/uip-planner-runtime'

import { prepareToolRuntime } from './runtime'
import type { ToolActivityInput, ToolActivityResult } from './types'

const logger = createSubLogger('uip-v2-select-auto-style')

/**
 * Extra input this tool needs beyond the fields every tool activity gets
 * (events/currentArtifacts/...). `maxAttempts` rides in via `toolInput`, the
 * same slot generate-visual-script.ts uses for its tool-specific
 * `structure_edit` extra (see runtime.ts / types.ts).
 *
 * The preset catalog (`presets`) is NOT part of this: it is the bundled
 * presets/story-mode/styles.json catalog (`style-catalog.ts` is
 * intentionally I/O-free -- see its module docstring), sourced server-side at
 * session creation and seeded onto the folded session state at
 * `session.spec.meta.style_catalog`. The activity reads it from there below,
 * not from `toolInput`.
 */
export interface SelectAutoStyleActivityOutput {
  global_constraints?: GlobalConstraints
}

export interface SelectAutoStyleToolInput {
  maxAttempts?: number
}

export async function runSelectAutoStyleTool(
  input: ToolActivityInput,
): Promise<ToolActivityResult> {
  const { session } = await prepareToolRuntime(input)
  const gc = session.spec.global_constraints
  const { maxAttempts } = (input.toolInput ?? {}) as Partial<SelectAutoStyleToolInput>
  // Preset ranking catalog, seeded at session creation onto folded
  // meta (Task 6B) -- absent when the auto-style gate was off at creation
  // (or on a pre-feature/legacy session); runSelectAutoStyle degrades
  // gracefully to a heuristic-fallback result with zero candidates in that
  // case (verified in select-auto-style.test.ts), so this never crashes.
  const presets: StylePreset[] = session.spec.meta.style_catalog ?? []

  const brief: BriefFacts = {
    topic: gc.topic,
    tone: gc.tone,
    genre: gc.genre?.primary_genre,
  }
  const result = await runSelectAutoStyle({ brief, maxAttempts, presets })

  // Field-level write: only touch the four auto-selection fields, never
  // reassign `global_constraints` wholesale. `style` is MERGED (not replaced)
  // so a pre-existing `analyze_style` result's extra fields (reusable_prompt,
  // color_palette, ...) on the sub-object survive.
  // The user named a style in their prompt and generate_intent_context
  // already applied it. The ranking still ran, so the rail can offer
  // alternatives -- but the user's own style stays applied, keeps the top slot,
  // and keeps its provenance. The auto-apply mapper drops `style`/`style_source`
  // for a user-committed session anyway; not writing them here keeps this
  // activity's own output artifact honest too.
  const promptStyle = promptStyleCandidate(gc, presets)
  if (promptStyle) {
    gc.style_candidates = withPromptStyleFirst(promptStyle, result.candidates)
  } else {
    const topPick = result.candidates.find((c) => c.is_top_pick) ?? result.candidates[0]
    if (topPick) {
      gc.style = {
        ...gc.style,
        style_name: topPick.style_name,
        style_text: topPick.style_text,
        style_thumbnail_url: topPick.thumbnail_url,
      }
    }
    gc.style_candidates = result.candidates
    gc.style_source = 'auto'
    gc.selection_method = result.method
  }

  if (result.method !== 'llm') {
    logger.warn(`[auto-style] selection fell back to method=${result.method}`, {
      sessionId: session.sessionId,
      workflowId: input.parentWorkflowId,
      method: result.method,
      candidateCount: result.candidates.length,
    })
  }

  const output: SelectAutoStyleActivityOutput = { global_constraints: gc }
  return {
    output,
    toolResult: { code: 'OK', message: '', ok: true, retryable: false },
  }
}

/** How many cards the rail shows, prompt-expressed style included. */
const MAX_RAIL_CANDIDATES = 3

/**
 * The applied style as a candidate card, when it came from the user's prompt
 * -- `style_source: 'manual'` plus `selection_method: 'user_prompt'`,
 * the pair generate_intent_context writes when it captures one. Null for every
 * other session, including a UI style switch ('auto_switched'), whose rail is
 * already built from the pick's own candidates.
 *
 * `label` is the matched preset's human label, so the user's card reads
 * "Claymation" like the ranked cards beside it rather than the raw catalog id
 * (`digital chalk`, `high-quality-product-render`). A free-text style has no
 * preset to name it, so it falls back to its own name and then its text.
 */
function promptStyleCandidate(
  gc: GlobalConstraints,
  presets: StylePreset[],
): null | StyleCandidate {
  if (gc.style_source !== 'manual' || gc.selection_method !== 'user_prompt') {
    return null
  }
  const styleName = gc.style?.style_name?.trim() ?? ''
  const styleText = gc.style?.style_text?.trim() ?? ''
  if (styleName === '' && styleText === '') {
    return null
  }
  const presetLabel = presets.find((preset) => preset.id === styleName)?.label?.trim() ?? ''
  return {
    is_top_pick: true,
    label: presetLabel || styleName || styleText,
    style_name: styleName,
    style_text: styleText,
    thumbnail_url: gc.style?.style_thumbnail_url?.trim() ?? '',
  }
}

/**
 * Rail contents for a prompt-expressed style: the user's own style first and
 * flagged as the top pick, then the ranked alternatives. A ranked candidate for
 * the same preset is dropped rather than shown twice -- the LLM ranking a
 * style the user already asked for is exactly the case where a duplicate card
 * would appear.
 */
function withPromptStyleFirst(
  promptStyle: StyleCandidate,
  ranked: StyleCandidate[],
): StyleCandidate[] {
  const alternatives = ranked
    .filter((candidate) => candidate.style_name !== promptStyle.style_name)
    .slice(0, MAX_RAIL_CANDIDATES - 1)
    .map((candidate) => ({ ...candidate, is_top_pick: false }))
  return [promptStyle, ...alternatives]
}
