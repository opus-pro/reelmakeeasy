// Removal-intent classification of a user edit prompt. Shared rather than editor-local
// because the public-state projection reads it too: a pure deletion routes to the eraser
// model, which the editor UI has to know about to price a retry correctly.

// `clear` needs its particle: bare `clear` also means sharp ("make the text clear"),
// which is not a removal.
export const REMOVAL_VERBS_RE =
  /\b(remove|delete|erase|get rid of|take out|clear (?:out|away)|eliminate|hide)\b/gi

// A negator within two words before the verb flips the intent ("do not remove the logo").
// Punctuation ends the window, so "keep the logo, remove the text" is still a removal.
const NEGATED_BEFORE_RE =
  /\b(?:do not|don't|dont|never|avoid|without|keep|preserve|retain|instead of)\b(?:\s+\w+){0,2}\s*$/i

// Anything hinting that content comes back in place of what was removed. Deliberately
// broad: an eraser-routed replace loses the replacement content, while a v2v-routed pure
// deletion just keeps today's behavior, so ambiguity must land on `removal_replace`.
const REPLACEMENT_INTENT_RE =
  /\b(?:replace[sd]?|swap|substitute[sd]?|instead|add|insert|put|place|change (?:\w+\s+){0,3}?(?:in)?to\b|turn (?:\w+\s+){0,3}?into|make (?:it|them|the)\b|with (?:a|an|the|some)\b)/i

// A clause boundary after the removal target ("remove the text and write hello").
const CONTINUATION_RE = /(?:\b(?:and|then)\b|[,;])\s*/gi

// What follows a clause boundary WITHOUT starting a new action: a second removal target
// ("and the watermark"), another removal verb ("and delete the caption"), or a trailing
// politeness/modifier phrase (", please"). Anything else is read as an added action.
const CONTINUATION_NON_ACTION_RE =
  /^(?:remove|delete|erase|get|take|clear|eliminate|hide|the|a|an|its|his|her|their|our|my|this|that|these|those|all|any|some|other|another|both|it|them|him|he|she|they|also|please|too|not|no|nothing|everything|else|as|at|for|from|in|of|on|with|without)\b/i

export type RemovalEditKind = 'none' | 'pure_deletion' | 'removal_replace'

export function classifyRemovalEdit(userPrompt: string): RemovalEditKind {
  if (!userPrompt) {
    return 'none'
  }
  const verbs: string[] = []
  let firstEnd = -1
  for (const match of userPrompt.matchAll(REMOVAL_VERBS_RE)) {
    if (NEGATED_BEFORE_RE.test(userPrompt.slice(0, match.index))) {
      continue
    }
    if (firstEnd < 0) {
      firstEnd = match.index + match[0].length
    }
    verbs.push(match[0].toLowerCase())
  }
  if (firstEnd < 0) {
    return 'none'
  }
  // `hide` is occlusion intent ("hide the tattoo under a sleeve") -- the eraser can only
  // delete, never cover -- so ANY hide intent keeps the whole edit on the v2v path.
  const replaces =
    verbs.includes('hide') ||
    REPLACEMENT_INTENT_RE.test(userPrompt) ||
    hasActionContinuation(userPrompt.slice(firstEnd))
  return replaces ? 'removal_replace' : 'pure_deletion'
}

export function isRemovalEdit(userPrompt: string): boolean {
  return classifyRemovalEdit(userPrompt) !== 'none'
}

function hasActionContinuation(afterRemoval: string): boolean {
  for (const boundary of afterRemoval.matchAll(CONTINUATION_RE)) {
    const tail = afterRemoval.slice(boundary.index + boundary[0].length)
    if (tail && !CONTINUATION_NON_ACTION_RE.test(tail)) {
      return true
    }
  }
  return false
}
