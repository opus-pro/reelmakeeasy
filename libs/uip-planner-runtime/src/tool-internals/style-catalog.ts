/**
 * Pure ranking internals for Auto Style Selection (V1, preset-only).
 *
 * No I/O, no workflow APIs, no LLM: the caller (the auto-style-selection tool /
 * workflow) sources the preset array from the preset style catalog
 * (presets/story-mode/styles.json) and passes it in here. This module only
 * transforms and ranks it.
 *
 * The ranking signal is deliberately `label` + `shortDescription` +
 * `useCase` -- never `styleText`. `styleText` is the raw prompt fragment fed
 * to the image/video model; it's full of visual jargon (camera moves, render
 * engines, color grading) that keyword-overlaps against almost any topic and
 * would make ranking noisy/arbitrary. `useCase` is the field editors
 * hand-write specifically to say *when a human should pick this style*,
 * which is exactly what we're trying to approximate heuristically.
 */

export interface StylePreset {
  id: string
  label: string
  shortDescription: string
  styleText: string
  thumbnailUrl: string
  useCase: string
}

/**
 * The 3D animation preset id in the preset style catalog. Animation reads as
 * broadly "fun" across many keyword overlaps (it tends to carry generic
 * words like "story", "character", "engaging"), so left unchecked the
 * keyword heuristic over-selects it for topics it doesn't actually suit.
 * `heuristicRank` special-cases this id -- see the guard there.
 */
export const ANIMATION_ID = '3d-animation'

/**
 * Filters the raw preset pool down to candidates safe to rank. A preset
 * missing `label` has nothing for `rankingSignal` to key off of (an empty
 * label collapses the signal to just description+useCase, which still ranks
 * but is a sign of a malformed catalog entry upstream), so we drop it here
 * rather than let it silently skew results. Ids are kept byte-for-byte --
 * some real catalog ids contain a literal space (`'digital chalk'`) or mixed
 * capitals (`'Lowpoly'`), and normalizing here would desync this module's
 * output from the id the caller uses to look the preset back up later.
 */
export function toRankingCandidates(presets: StylePreset[]): StylePreset[] {
  return presets.filter((p) => p.label.trim().length > 0)
}

/**
 * The text a preset is ranked against. Concatenates the three human-authored
 * fields that describe *what this style is for* -- deliberately excludes
 * `styleText` (see module docstring).
 */
export function rankingSignal(p: StylePreset): string {
  return `${p.label}\n${p.shortDescription}\n${p.useCase}`
}

/**
 * Minimum label length considered for the containment pass. Two-character
 * labels ("2D") match inside unrelated words often enough that a wrong preset
 * is likelier than a right one; those still resolve through the exact pass.
 */
const MIN_CONTAINED_LABEL_LENGTH = 4

/** Lowercase, collapse every non-alphanumeric run to a single space, trim. */
function normalizeStyleName(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * Whether `needle` appears in `haystack` on whole-word boundaries. Every
 * occurrence is checked, not just the first: a label can appear mid-word before
 * it appears as a word ("watercolored watercolor look"), and stopping at the
 * first hit would drop a preset the user did name.
 */
function containsWholePhrase(haystack: string, needle: string): boolean {
  for (
    let index = haystack.indexOf(needle);
    index !== -1;
    index = haystack.indexOf(needle, index + 1)
  ) {
    const afterIndex = index + needle.length
    const boundedBefore = index === 0 || haystack[index - 1] === ' '
    const boundedAfter = afterIndex === haystack.length || haystack[afterIndex] === ' '
    if (boundedBefore && boundedAfter) {
      return true
    }
  }
  return false
}

/**
 * Resolve a style the user named in their own words (e.g. "claymation") to a
 * catalog preset. Matches `label` and `id` case-insensitively with punctuation
 * and whitespace collapsed: catalog ids are deliberately inconsistent (a
 * literal space in `digital chalk`, mixed capitals in `Lowpoly`, opaque hashes
 * for org-custom entries), so only the COMPARISON is normalized -- the returned
 * preset keeps its id byte-for-byte, which is what the caller looks it back up
 * by (see the module docstring).
 *
 * Two passes, no fuzzy scoring:
 *   1. exact match on the normalized label or id;
 *   2. the longest preset label appearing as a whole phrase inside the name,
 *      so "premium stop-motion claymation" still resolves to `claymation`.
 *
 * A name that matches nothing returns undefined rather than the closest
 * preset -- the caller applies it as free-text style, which is a better outcome
 * than a confidently wrong preset.
 */
export function matchPresetByName(presets: StylePreset[], name: string): StylePreset | undefined {
  const normalized = normalizeStyleName(name)
  if (normalized === '') {
    return undefined
  }

  const exact = presets.find(
    (preset) =>
      normalizeStyleName(preset.label) === normalized ||
      normalizeStyleName(preset.id) === normalized,
  )
  if (exact) {
    return exact
  }

  let best: StylePreset | undefined
  let bestLength = 0
  for (const preset of presets) {
    const label = normalizeStyleName(preset.label)
    if (label.length < MIN_CONTAINED_LABEL_LENGTH || label.length <= bestLength) {
      continue
    }
    if (containsWholePhrase(normalized, label)) {
      best = preset
      bestLength = label.length
    }
  }
  return best
}

/**
 * Cheap, dependency-free fallback ranking: scores each preset by keyword
 * overlap between the brief (topic/tone/genre) and its useCase+
 * shortDescription, highest first, ties broken by catalog order. This is not
 * the primary (LLM-based) selection path -- it's the deterministic fallback
 * a caller reaches for when the LLM step is unavailable/fails, so it must
 * degrade gracefully rather than throw.
 *
 * Anti-Animation guardrail: `ANIMATION_ID` reads as generically applicable
 * under naive keyword overlap and must never win the top slot by default.
 * If it scores highest, we demote it one slot (swap with the runner-up)
 * rather than drop it, unless it's the only preset in the pool.
 */
export function heuristicRank(
  brief: { genre?: string; tone: string; topic: string },
  presets: StylePreset[],
): StylePreset[] {
  if (presets.length <= 1) {
    return [...presets]
  }

  const briefKeywords = tokenize(`${brief.topic} ${brief.tone} ${brief.genre ?? ''}`)

  const scored = presets.map((preset, index) => ({
    index,
    preset,
    score: overlapScore(briefKeywords, tokenize(`${preset.useCase} ${preset.shortDescription}`)),
  }))

  scored.sort((a, b) => {
    if (b.score !== a.score) {
      return b.score - a.score
    }
    return a.index - b.index
  })

  const ranked = scored.map((s) => s.preset)

  if (ranked[0].id === ANIMATION_ID) {
    // Swap Animation out of the top slot with the runner-up. It stays in
    // the result (just not first) so callers still see it as an option.
    ;[ranked[0], ranked[1]] = [ranked[1], ranked[0]]
  }

  return ranked
}

function overlapScore(briefKeywords: Set<string>, candidateKeywords: Set<string>): number {
  let score = 0
  for (const word of candidateKeywords) {
    if (briefKeywords.has(word)) {
      score += 1
    }
  }
  return score
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 2),
  )
}
