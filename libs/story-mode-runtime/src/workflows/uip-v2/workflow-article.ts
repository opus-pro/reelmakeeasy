// Do NOT import VALUES from @reelmakeeasy/uip-planner-runtime here -- this file is part
// of the v2 workflow code (types-only imports from the planner runtime).
//
// Article-extraction orchestration for the v2 session workflow
// (news-article-to-video door). Unlike brand extraction there is no
// child workflow, no review gate, and no spec field: the pasted URL is probed
// activity-side (same detector as the brand auto-start), the extraction
// activity runs cross-queue on the brand-extraction worker, and the result is
// appended as an article_extraction_completed event that foldSession projects
// onto SessionState.bootstrap.article_context. The await is deliberate: the
// planner's first grounded turn should read the article, and a bounded
// (2 min start-to-close, 2 attempts) stall beats an ungrounded reply -- the
// factual-accuracy kernel is the point of this ticket.

import type { UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'
import { isCancellation, uuid4 } from '@reelmakeeasy/workflow-engine/workflow'

import {
  applyBrandPatchActivity,
  classifyPastedUrlActivity,
  createArticleExtractionProxy,
} from './activity-proxies'
import { appendEvent } from './event-log'
import {
  brandStatus,
  foldEntryUseCase,
  foldPhase,
  hasArticleExtractionRun,
  hasBrandAutoStartUrlCandidate,
  hasBrandInput,
} from './folds'
import {
  hasUserMessageAfterUrlClassification,
  URL_ROUTE_MAX_RUNS,
  urlClassificationRunCount,
  urlRouteExhausted,
  urlRouteIsArticle,
  urlRouteIsUncertain,
} from './folds-url-route'
import { nowIso } from './planner-turn-helpers'
import type { WorkflowState } from './types'

/**
 * True when this session takes the article door instead of the brand door:
 * feature gate snapshot on, and EITHER the session entered via the
 * news-article-to-video front door (spec.meta.entry_use_case
 * step 1) OR the pasted-URL router classified the link as an article with
 * confidence at/above the routing floor (entrance pivot: links in
 * the main box route by content, not by entry chip). The caller uses this to
 * short-circuit brand auto-extraction.
 */
export function articleDoorEngaged(state: WorkflowState): boolean {
  if (state.articleExtractionEnabled !== true) {
    return false
  }
  if (foldEntryUseCase(state.events) === 'news-article-to-video') {
    return true
  }
  return urlRouteIsArticle(state.events)
}

/**
 * True when the session came through the news front door, which forbids the
 * brand auto-start from claiming the pasted link: that link is the article to
 * turn into a video, never the user's own site.
 *
 * Deliberately NOT gated on `articleExtractionEnabled`, unlike every other
 * door check here. That gate is pinned once per session at session creation
 * and can read false, and since the static registry flip the news
 * entry is Story Mode unconditionally -- it no longer falls back to the legacy
 * /videos pipeline when the gate reads false. Without this guard, such a
 * session hands the pasted article URL to brand extraction and crawls the
 * PUBLISHER as the user's brand.
 */
export function newsDoorBlocksBrandAutoStart(state: WorkflowState): boolean {
  return foldEntryUseCase(state.events) === 'news-article-to-video'
}

/**
 * True when the pasted-URL router forbids the brand auto-start this wake: a
 * confident article verdict routes the URL to the article door, and an
 * uncertain verdict parks BOTH doors while the director asks the user. An
 * 'error' verdict (or the router being off) leaves brand auto-start exactly
 * as it behaves today. An uncertain verdict with the re-classification budget
 * spent (urlRouteExhausted) also releases the block: the classifier can never
 * run again, so keeping both doors parked would strand the session -- at the
 * cap we fall back to today's behavior instead.
 */
export function urlRouteBlocksBrandAutoStart(state: WorkflowState): boolean {
  if (state.articleExtractionEnabled !== true) {
    return false
  }
  if (urlRouteIsArticle(state.events)) {
    return true
  }
  return urlRouteIsUncertain(state.events) && !urlRouteExhausted(state.events)
}

/**
 * Classify a pasted URL as article vs brand before either door fires.
 * Runs only for sessions that did NOT enter via
 * the news front door (there the entry decides), at most URL_ROUTE_MAX_RUNS
 * times: the first run happens as soon as a URL candidate appears in
 * mode_confirmation; re-runs happen only while the verdict is uncertain AND
 * the user has since replied (the director's clarifying answer is then in
 * the transcript, so the classifier can resolve it). All guards are
 * in-process folds; failures degrade to an 'error' verdict -- LLM failures
 * inside the activity, and activity-level failures (timeout, exhausted
 * activity retries) via the catch below -- which routing treats as
 * "behave like today".
 */
export async function maybeClassifyPastedUrl(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
): Promise<void> {
  if (state.articleExtractionEnabled !== true || !params.articleExtractionTaskQueue) {
    return // router rides the article-door gate; off or misconfigured -> legacy routing
  }
  if (foldEntryUseCase(state.events) === 'news-article-to-video') {
    return // entry door already decided; nothing to classify
  }
  if (foldPhase(state.events) !== 'mode_confirmation') {
    return
  }
  if (hasBrandInput(state.events) || brandStatus(state.events) !== null) {
    return // brand door already armed (brief, carry, or earlier auto-start)
  }
  if (hasArticleExtractionRun(state.events)) {
    return
  }
  if (!hasBrandAutoStartUrlCandidate(state.events)) {
    return
  }
  const runCount = urlClassificationRunCount(state.events)
  if (runCount >= URL_ROUTE_MAX_RUNS) {
    return
  }
  if (
    runCount > 0 &&
    (!urlRouteIsUncertain(state.events) || !hasUserMessageAfterUrlClassification(state.events))
  ) {
    return // decided (or error) verdicts are final; uncertain waits for a reply
  }
  let url: null | string | undefined
  try {
    const probe = await applyBrandPatchActivity({
      action: { kind: 'article_probe' },
      currentArtifacts: state.currentArtifacts,
      events: state.events,
    })
    url = probe.articleUrl
    if (!url) {
      return
    }
    const verdict = await classifyPastedUrlActivity({
      currentArtifacts: state.currentArtifacts,
      events: state.events,
      projectId: params.projectId,
      runCount,
      url,
      userId: params.userId,
    })
    appendEvent(state, {
      type: 'url_classification_completed',
      classification: verdict.classification,
      confidence: verdict.confidence,
      runId: uuid4(),
      timestamp: nowIso(),
      url,
    })
  } catch (err) {
    // Workflow cancellation surfaces through the awaited activity promise --
    // re-throw so the main loop's cancellation handling unwinds normally.
    if (isCancellation(err)) {
      throw err
    }
    // Terminal activity error (timeout, worker churn, retries exhausted):
    // the activity's internal try/catch never got to run, so append the
    // 'error' verdict here -- routing then falls back to today's behavior
    // and the decided-verdict guard keeps the classifier from re-firing.
    appendEvent(state, {
      type: 'url_classification_completed',
      classification: 'error',
      confidence: 0,
      runId: uuid4(),
      timestamp: nowIso(),
      url: url ?? '',
    })
  }
}

/**
 * Probe for a pasted URL and run the article extraction, at most once per
 * session. Idempotent and cheap to call on every mode_confirmation wake: all
 * guards are in-process folds; the URL-candidate pre-check keeps the no-op
 * case activity-free (same discipline as the brand auto-start). Failures
 * never throw past this function -- a failed extraction
 * appends a failed-outcome event and the session proceeds ungrounded.
 */
export async function maybeRunArticleExtraction(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
): Promise<void> {
  if (!articleDoorEngaged(state)) {
    return
  }
  if (!params.articleExtractionTaskQueue) {
    return // gate on but no queue resolved -- misconfigured session, skip
  }
  if (foldPhase(state.events) !== 'mode_confirmation') {
    return
  }
  if (hasArticleExtractionRun(state.events)) {
    return
  }
  if (!hasBrandAutoStartUrlCandidate(state.events)) {
    return
  }
  const probe = await applyBrandPatchActivity({
    action: { kind: 'article_probe' },
    currentArtifacts: state.currentArtifacts,
    events: state.events,
  })
  const url = probe.articleUrl
  if (!url) {
    return
  }
  const runId = uuid4()
  appendEvent(state, {
    type: 'article_extraction_started',
    runId,
    timestamp: nowIso(),
    url,
  })
  const { extractArticleActivity } = createArticleExtractionProxy(params.articleExtractionTaskQueue)
  try {
    const result = await extractArticleActivity({
      projectId: params.projectId,
      runId,
      url,
      userId: params.userId,
    })
    appendEvent(state, {
      type: 'article_extraction_completed',
      result,
      runId,
      timestamp: nowIso(),
    })
  } catch (err) {
    // Workflow cancellation surfaces through the awaited activity promise --
    // re-throw so the main loop's cancellation handling unwinds normally
    // instead of the session continuing with a phantom failed extraction.
    if (isCancellation(err)) {
      throw err
    }
    // Terminal activity error (infra, post-retries). Record a failed outcome
    // so hasArticleExtractionRun stays true and the trigger never re-fires.
    appendEvent(state, {
      type: 'article_extraction_completed',
      result: { failureKind: 'internal_error', outcome: 'failed' },
      runId,
      timestamp: nowIso(),
    })
  }
}
