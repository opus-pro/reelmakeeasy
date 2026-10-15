import { diffWords } from 'diff'

/**
 * Ceiling on a rendered delta.
 *
 * A delta exists to answer "how big was this edit", and past a point the honest
 * answer is "big" -- spelling that out word by word would embed a second copy of
 * a script that can run to SCRIPT_WORD_CAP, in the persisted spec AND in every
 * planner payload until the entry clears. Past the cap the rendering degrades to
 * counts.
 */
export const MAX_SOURCE_DELTA_CHARS = 400

/** Longest run of changed words still worth quoting rather than counting. */
const MAX_QUOTED_WORDS = 12

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function quote(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) {
    return '(nothing)'
  }
  if (words.length <= MAX_QUOTED_WORDS) {
    return `"${words.join(' ')}"`
  }
  return `"${words.slice(0, MAX_QUOTED_WORDS).join(' ')} ..." (${words.length} words)`
}

/**
 * A compact description of what one edit changed, for the planner to judge
 * whether the edit invalidated anything.
 *
 * Returns null when the value did not move.
 *
 * Why this exists: a ledger entry that carries only the source's END STATE tells
 * the planner "this changed, here is how it reads now", which it can only act on
 * by re-auditing the whole artifact. In one session a single
 * synonym swap therefore surfaced a `key_entities` gap that had been there since
 * bootstrap, and the user -- who had fixed a typo -- was told the brief had been
 * synced. The delta is what lets a cosmetic edit be recognised as cosmetic.
 *
 * Word-level, not character-level: the planner reasons about wording, and a
 * character diff of prose produces fragments that read as noise.
 */
export function describeSourceDelta(previous: string | undefined, next: string): null | string {
  const before = previous ?? ''
  if (before === next) {
    return null
  }

  const parts = diffWords(before, next)
  const totalWords = Math.max(countWords(next), countWords(before))

  // Pair each removed run with the added run that replaced it, so a swap reads
  // as one substitution rather than two unrelated events -- and counts as the
  // words it AFFECTED, not removed plus added. Summing both sides would report a
  // one-word synonym swap as "2 words changed", which reads like twice the edit
  // it was, on exactly the cosmetic case this is meant to make recognisable.
  const lines: string[] = []
  let changedWords = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (part.removed === true) {
      const replacement = parts[i + 1]
      if (replacement?.added === true) {
        changedWords += Math.max(countWords(part.value), countWords(replacement.value))
        lines.push(`${quote(part.value)} -> ${quote(replacement.value)}`)
        i++
        continue
      }
      changedWords += countWords(part.value)
      lines.push(`removed ${quote(part.value)}`)
      continue
    }
    if (part.added === true) {
      changedWords += countWords(part.value)
      lines.push(`added ${quote(part.value)}`)
    }
  }

  // Clamp: diffWords splits a rewrite into many interleaved regions, since common
  // words still match across two unrelated texts. Summing each region overruns
  // the total -- one session rendered "87 of 72 words changed" for
  // a wholesale rewrite. Directionally right, but a count larger than the whole
  // reads as a broken number, and the planner is being asked to trust it.
  const scale = `${Math.min(changedWords, totalWords)} of ${totalWords} words changed`

  const rendered = [scale, ...lines].join('; ')
  return rendered.length <= MAX_SOURCE_DELTA_CHARS ? rendered : scale
}
