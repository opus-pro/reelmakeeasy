// Pure folds for the pasted-URL router. Split out
// of folds.ts to keep that file under the max-lines budget; same bundle rules
// apply (pure, no value imports from the planner runtime).

import { findLast } from './folds'
import type { AgentEvent } from './types'

// Confidence floor for routing a pasted URL without asking: at or
// above this the door opens silently; below it the director asks the user.
export const URL_ROUTE_CONFIDENCE_THRESHOLD = 0.95

// Re-classification budget: an uncertain verdict may be retried (with the
// user's clarifying answer now in the transcript) at most this many times,
// so a stubbornly ambiguous link can never loop the classifier forever.
export const URL_ROUTE_MAX_RUNS = 3

/**
 * Latest pasted-URL router verdict; null until the classifier has
 * run. An 'error' verdict means routing falls back to today's behavior.
 */
export function latestUrlClassification(
  events: AgentEvent[],
): Extract<AgentEvent, { type: 'url_classification_completed' }> | null {
  const found = findLast(events, (e) => e.type === 'url_classification_completed')
  return found?.type === 'url_classification_completed' ? found : null
}

/** Confident article verdict: the pasted URL routes to the article door. */
export function urlRouteIsArticle(events: AgentEvent[]): boolean {
  const latest = latestUrlClassification(events)
  return latest?.classification === 'article' && latest.confidence >= URL_ROUTE_CONFIDENCE_THRESHOLD
}

/** Confident brand verdict: the pasted URL routes to brand extraction. */
export function urlRouteIsBrand(events: AgentEvent[]): boolean {
  const latest = latestUrlClassification(events)
  return latest?.classification === 'brand' && latest.confidence >= URL_ROUTE_CONFIDENCE_THRESHOLD
}

/**
 * Unresolved verdict: a non-error classification below the confidence floor.
 * Suppresses BOTH doors and prompts the director's clarifying question; a new
 * user message allows a re-run while the run budget lasts. Callers deciding
 * whether to KEEP blocking must pair this with `urlRouteExhausted` -- an
 * uncertain verdict with no runs left can never resolve, so parking on it
 * would strand the session.
 */
export function urlRouteIsUncertain(events: AgentEvent[]): boolean {
  const latest = latestUrlClassification(events)
  return (
    latest !== null &&
    latest.classification !== 'error' &&
    latest.confidence < URL_ROUTE_CONFIDENCE_THRESHOLD
  )
}

/**
 * Terminal ambiguity: the verdict is still uncertain AND the re-classification
 * budget is spent, so the classifier can never run again. Routing must stop
 * treating the URL as blocking and fall back to today's behavior (brand
 * auto-start), otherwise both doors stay parked with no path to progress.
 */
export function urlRouteExhausted(events: AgentEvent[]): boolean {
  return urlRouteIsUncertain(events) && urlClassificationRunCount(events) >= URL_ROUTE_MAX_RUNS
}

/** How many times the router has run this session (bounds re-classification). */
export function urlClassificationRunCount(events: AgentEvent[]): number {
  return events.reduce((n, e) => (e.type === 'url_classification_completed' ? n + 1 : n), 0)
}

/**
 * True when a NEW user message arrived after the latest (uncertain) verdict --
 * the signal that the director's clarifying question was answered and the
 * classifier may re-run with the answer in the transcript.
 */
export function hasUserMessageAfterUrlClassification(events: AgentEvent[]): boolean {
  let seenLatest = false
  const latest = latestUrlClassification(events)
  if (!latest) {
    return false
  }
  for (const e of events) {
    if (e === latest) {
      seenLatest = true
      continue
    }
    if (seenLatest && e.type === 'user_message') {
      return true
    }
  }
  return false
}
