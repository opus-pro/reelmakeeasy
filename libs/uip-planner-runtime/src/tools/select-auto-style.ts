/**
 * `select_auto_style` ranking tool (Auto Style Selection V1, preset-only).
 *
 * Pure function: takes a brief + the preset catalog, returns up to 3 ranked
 * `StyleCandidate`s plus the `method` that produced them. No workflow APIs, no
 * session I/O -- the activity wrapper (a later task) supplies `brief` /
 * `presets` and writes the result onto the session.
 *
 * Primary path is an LLM ranking call (`completion`); it is retried up to
 * `maxAttempts` times on failure or a response that fails
 * `selectAutoStyleSchema` / doesn't resolve to at least one known preset id.
 * On exhaustion, falls back to the deterministic `heuristicRank` from
 * `tool-internals/style-catalog` (which already guarantees the
 * anti-Animation guardrail), and reports `method: 'heuristic_fallback'`.
 */

import { completion } from '@reelmakeeasy/common/llm/completion'
import { z } from 'zod'

import { SELECT_AUTO_STYLE_MODELS } from '../model-config'
import {
  heuristicRank,
  rankingSignal,
  type StylePreset,
  toRankingCandidates,
} from '../tool-internals/style-catalog'
// Canonical types (Task 6) -- match Task 2's FE (`api-types.ts`) / backend
// (`uip-timeline-types.ts`) wire copies field-for-field. This tool used to
// declare local mirrors; now imports the single source of truth so
// `GlobalConstraintsSchema.style_candidates` / `.selection_method` and this
// tool's output can never drift apart.
import type { StyleCandidate, StyleSelectionMethod } from '../types'

/** Minimal brief facts needed to rank styles -- mirrors `heuristicRank`'s input shape. */
export interface BriefFacts {
  genre?: string
  tone: string
  topic: string
}

export interface SelectAutoStyleResult {
  candidates: StyleCandidate[]
  method: StyleSelectionMethod
}

const MAX_CANDIDATES = 3

export const selectAutoStyleSchema = z.object({
  ranked_ids: z.array(z.string()),
})

const SELECT_AUTO_STYLE_PROMPT = `You are selecting the best-fit visual styles for a short video.

Video brief:
- topic: {topic}
- tone: {tone}
- genre: {genre}

Candidate styles (id: label / short description / use case):
{candidates}

Return the ${MAX_CANDIDATES} best-fit candidate ids for this brief, best first. Return JSON only, matching:
{ "ranked_ids": ["<id>", "<id>", "<id>"] }

Rules:
- ranked_ids must contain exactly ${MAX_CANDIDATES} ids, each taken verbatim from the candidate list above, no duplicates, best fit first.
- Base the choice on how well each style's use case and description match the brief's topic, tone, and genre.
- Do not default to a generic "anything goes" style just because it seems broadly applicable -- prefer styles whose use case specifically fits this brief.`

export function buildRankingPrompt(brief: BriefFacts, presets: StylePreset[]): string {
  const candidateLines = presets
    .map((p) => `- ${p.id}: ${rankingSignal(p).split('\n').join(' / ')}`)
    .join('\n')
  return SELECT_AUTO_STYLE_PROMPT.replace('{topic}', brief.topic)
    .replace('{tone}', brief.tone)
    .replace('{genre}', brief.genre ?? '(not specified)')
    .replace('{candidates}', candidateLines)
}

function presetToCandidate(preset: StylePreset, isTopPick: boolean): StyleCandidate {
  return {
    is_top_pick: isTopPick,
    label: preset.label,
    style_name: preset.id,
    style_text: preset.styleText,
    thumbnail_url: preset.thumbnailUrl,
  }
}

function toCandidates(ranked: StylePreset[]): StyleCandidate[] {
  return ranked
    .slice(0, MAX_CANDIDATES)
    .map((preset, index) => presetToCandidate(preset, index === 0))
}

/**
 * Attempts one LLM ranking call and resolves `ranked_ids` against the known
 * preset pool. Returns `null` (rather than throwing) on any failure --
 * network error, schema-parse failure, or a response that resolves to zero
 * known presets -- so the retry loop in `runSelectAutoStyle` can treat every
 * failure mode uniformly.
 */
// Per-attempt LLM timeout for preset ranking -- a HANG cap, not the expected
// latency: a healthy light ranking (low reasoning, ~25 short presets) returns in
// a few seconds. Trimmed from 30s so a stalled attempt fails fast and retries /
// falls back sooner instead of stalling the candidate card ~30s+ per hang (the
// card cannot render until this tool completes). Tune against the
// agent.auto_style.selection.duration_ms distribution once the gate has real
// volume -- a too-low cap converts LLM successes into lower-quality heuristic
// fallbacks, so raise it if healthy p95 approaches this value.
const SELECT_AUTO_STYLE_LLM_TIMEOUT_MS = 20_000

export async function runSelectAutoStyle(input: {
  brief: BriefFacts
  maxAttempts?: number
  presets: StylePreset[]
}): Promise<SelectAutoStyleResult> {
  const { brief, presets } = input
  const maxAttempts = input.maxAttempts ?? 3
  const candidatePool = toRankingCandidates(presets)

  // An absent / fully-filtered catalog folds to []: ranking has nothing to
  // resolve against, so every LLM attempt would burn a full-timeout call and
  // return the same empty result. Short-circuit to the empty fallback the loop
  // would reach anyway, so the phase gate is not delayed by
  // maxAttempts * SELECT_AUTO_STYLE_LLM_TIMEOUT_MS.
  if (candidatePool.length === 0) {
    return { candidates: [], method: 'heuristic_fallback' }
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const ranked = await attemptLlmRanking(brief, candidatePool)
    if (ranked) {
      return { candidates: toCandidates(ranked), method: 'llm' }
    }
  }

  const heuristicRanked = heuristicRank(brief, candidatePool)
  return { candidates: toCandidates(heuristicRanked), method: 'heuristic_fallback' }
}

async function attemptLlmRanking(
  brief: BriefFacts,
  presets: StylePreset[],
): Promise<null | StylePreset[]> {
  const byId = new Map(presets.map((p) => [p.id, p]))
  try {
    const raw = await completion({
      models: SELECT_AUTO_STYLE_MODELS,
      prompt: buildRankingPrompt(brief, presets),
      responseFormat: selectAutoStyleSchema,
      // 'minimal' = thinking OFF for the flash primary (flashThinkingBudgets.minimal
      // = 0) and minimal reasoning for the gpt fallback. Ranking ~25 presets by
      // label/description is a direct structured judgment, not a reasoning task, so
      // 'low' (a 6144-token flash thinking budget) was pure latency -- it made the
      // pick ~20s+, slower than the script it runs concurrently with, delaying the
      // candidate card. One effort applies to the whole model chain.
      reasoningEffort: 'minimal',
      task: 'user-intent-planner-select_auto_style',
      temperature: 0.1,
      timeout: SELECT_AUTO_STYLE_LLM_TIMEOUT_MS,
    })
    const parsed = selectAutoStyleSchema.parse(raw)
    // Dedupe ranked_ids (keep first occurrence) before resolving. The LLM can
    // return a non-permutation with a repeated id (e.g. ['schematic',
    // 'schematic', 'claymation']); mapping it 1:1 would surface the same preset
    // as multiple candidate cards. First occurrence wins so the top pick is
    // preserved; unknown ids drop out.
    const seen = new Set<string>()
    const ranked: StylePreset[] = []
    for (const id of parsed.ranked_ids) {
      if (seen.has(id)) {
        continue
      }
      seen.add(id)
      const preset = byId.get(id)
      if (preset) {
        ranked.push(preset)
      }
    }
    return ranked.length > 0 ? ranked : null
  } catch {
    return null
  }
}
