import {
  proxyActivitiesWrapper,
  proxyLocalActivitiesWrapper,
} from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'

// TYPE-ONLY imports: a value import would drag the activities' Node deps
// into workflow code. The runtime implementations are registered on the
// workers; here we only need the types to shape the proxy stubs.
import type * as articleExtractionActivities from '../../activities/article-extraction'
import type * as uipV2Activities from '../../activities/uip-v2'

//
// Local activities -- run in the workflow worker process. Short, deterministic,
// must be awaited sequentially (never inside Promise.all, never two at once).
// These are all driven by the MAIN loop, which awaits each sequentially, so no
// two local activities are ever in flight together. (projectAndPersistActivity
// is deliberately NOT here -- the background sync loop runs concurrently with
// the main loop, so it is a REGULAR activity; see
// createPersistProxy below.) Generous retry budget
// (10 attempts, 2s->30s) covers ~3 min of API outage / rolling restart.
export const { applyBrandPatchActivity, applyPatchActivity, sessionControlActivity } =
  proxyLocalActivitiesWrapper<
    Pick<
      typeof uipV2Activities,
      'applyBrandPatchActivity' | 'applyPatchActivity' | 'sessionControlActivity'
    >
  >({
    startToCloseTimeout: '60 seconds',
    retry: {
      maximumAttempts: 10,
      initialInterval: '2 seconds',
      maximumInterval: '30 seconds',
    },
  })

// Pasted-URL router. One flash-tier LLM call inside a local
// activity (same precedent as applyBrandPatchActivity's dedup call); driven
// only by the sequential main loop. Fewer retries than the patch group: a
// failed classification degrades to legacy routing, so burning minutes on
// retries is worse than falling back.
export const { classifyPastedUrlActivity } = proxyLocalActivitiesWrapper<
  Pick<typeof uipV2Activities, 'classifyPastedUrlActivity'>
>({
  startToCloseTimeout: '60 seconds',
  retry: {
    maximumAttempts: 2,
    initialInterval: '2 seconds',
    maximumInterval: '10 seconds',
  },
})

//
// project-and-persist -- a regular activity, run by the background sync loop
// CONCURRENTLY with the main loop. taskQueue is the UIP queue (where it is
// registered).
//
// Timeouts: a worker dying with the task in
// flight used to cost users 120s startToClose + 2s backoff before the retry
// (observed: the event_to_publish 158s max; history fingerprint = attempt 2 +
// Server-source "activity StartToClose timeout" + zero attempt-1 logs). The
// activity heartbeats every 5s (barrel wrap, activities/uip-v2/index.ts), so
// heartbeatTimeout 30s detects a dead worker in ~30s + 2s backoff.
//
// Why not shorter: the server times out on heartbeats RECEIVED, and the SDK
// throttles sends to 0.8x the timeout no matter how often the pump calls
// heartbeat() -- so a healthy worker's slack is structurally 0.2x the timeout
// (30s -> 6s, 15s -> only 3s). That slack must absorb event-loop stalls on a
// worker running up to 40 concurrent activities (synchronous folds, GC,
// network jitter), worst exactly during the churn this cap targets; a false
// trip kills a progressing persist and ADDS retries. Shortening saves seconds
// on a rare event at the cost of a new failure mode under common load.
//
// 90s start-to-close is the hung-but-alive backstop only (heartbeats do not
// extend it): the worst observed cold attempt composes fold + cold publish +
// ~37s cold persist (+ the terminal event_log dump in parallel) to ~50s, so
// 90s never clips a live attempt while still halving the old hang cap.
// Safe to retighten later if no heartbeat timeouts show up on runs that were
// actually alive.
export function createPersistProxy(taskQueue: string) {
  return proxyActivitiesWrapper<Pick<typeof uipV2Activities, 'projectAndPersistActivity'>>({
    taskQueue,
    startToCloseTimeout: '90 seconds',
    heartbeatTimeout: '30 seconds',
    retry: {
      maximumAttempts: 10,
      initialInterval: '2 seconds',
      maximumInterval: '30 seconds',
    },
  })
}

//
// Short orchestration local activities (relocated from activities/uip into
// activities/uip-v2 in the v1 cleanup). `triggerNextActionActivity`
// nudges the API to send the next authoritative signal (new-protocol wake /
// self-chain); `cleanupPlannerChainActivity` deletes the orphaned OpenAI
// response chain on session exit. Registered on the worker; here we only type
// their proxies (type-only import).
export const { claimNextActionActivity, cleanupPlannerChainActivity } = proxyLocalActivitiesWrapper<
  Pick<typeof uipV2Activities, 'claimNextActionActivity' | 'cleanupPlannerChainActivity'>
>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2 seconds',
    maximumInterval: '15 seconds',
  },
})

//
// triggerNextActionActivity MUST be a REGULAR (not local) activity: the ReqCtx
// workflow interceptor only injects the X-REELMAKEEASY-REQ-CTX header on
// scheduleActivity (regular), not scheduleLocalActivity. As a local activity the
// internal /trigger-next-action call runs with an empty request context.
// Regular activity =>
// ReqCtx (org/user/login/pii) propagates to the activity and onward to the
// internal API. taskQueue is passed in by the caller. Mirrors V1's
// createTriggerNextActionProxy.
export function createTriggerNextActionProxy(taskQueue: string) {
  return proxyActivitiesWrapper<Pick<typeof uipV2Activities, 'triggerNextActionActivity'>>({
    taskQueue,
    startToCloseTimeout: '60 seconds',
    retry: {
      maximumAttempts: 10,
      initialInterval: '2 seconds',
      maximumInterval: '30 seconds',
    },
  })
}

//
// checkDeadlineExpiredActivity (reused V1 regular activity): POSTs to the internal
// /deadline-expired endpoint so the API runs the SAME orchestration as a user
// "Generate now" (executeConfirmOrchestration -> start story-mode + set lockedAt)
// and signals uip-confirm back. The V2 sync-loop owns the timer +
// the busy-defer/extend decision; this only EXECUTES the action once the workflow
// has decided to fire. Must be REGULAR (not local) for the same ReqCtx-header
// reason as triggerNextActionActivity -- the internal call needs the
// real user context. taskQueue passed in.
export function createCheckDeadlineExpiredProxy(taskQueue: string) {
  return proxyActivitiesWrapper<Pick<typeof uipV2Activities, 'checkDeadlineExpiredActivity'>>({
    taskQueue,
    startToCloseTimeout: '60 seconds',
    retry: {
      maximumAttempts: 10,
      initialInterval: '2 seconds',
      maximumInterval: '30 seconds',
    },
  })
}

//
// Planner step -- a single LLM planning call (NOT the whole loop). Regular
// activity on the tool task queue. taskQueue is passed in. 5 min start-to-close
// bounds one call (V1's createPlannerTurnProxy runs the full 40-step loop, hence
// its 30 min / 5 min).
// heartbeatTimeout 30s gives fast dead-worker / pod-churn detection; the activity
// heartbeats every 5s (barrel wrap, activities/uip-v2/index.ts), so the 30s cap
// applies to heartbeat GAPS (a dead worker) rather than a healthy call's duration
// -- which is bounded by the 5 min start-to-close. Without that pump a 30s timeout
// would kill live calls (no_decision rounds + slow LLM calls run past 30s).
// maximumAttempts=3 recovers transient infra blips.
/** The proxied single planner-step activity fn (one LLM call = one activity). */
export type PlannerStepFn = ReturnType<typeof createPlannerStepProxy>['plannerStepActivity']

export function createPlannerStepProxy(taskQueue: string) {
  return proxyActivitiesWrapper<Pick<typeof uipV2Activities, 'plannerStepActivity'>>({
    taskQueue,
    startToCloseTimeout: '5 minutes',
    heartbeatTimeout: '30 seconds',
    retry: {
      maximumAttempts: 3,
      initialInterval: '5 seconds',
      maximumInterval: '1 minute',
    },
  })
}

//
// Tool activities -- the 6 asset/LLM generation tools, run as long regular
// activities on the tool task queue (mirrors V1 createPlannerTurnProxy's long
// config: real visual-script / beat-sheet / anchor-asset generation). 30 min
// start-to-close + 5 min heartbeat; maximumAttempts=2 keeps transient
// infra-failure recovery without a retry storm of expensive generation.
export function createToolActivitiesProxy(taskQueue: string) {
  return proxyActivitiesWrapper<
    Pick<
      typeof uipV2Activities,
      | 'anchorAndVisualScriptBatchActivity'
      | 'describeUploadedImagesActivity'
      | 'generateAnchorAssetsActivity'
      | 'generateIntentContextActivity'
      | 'generateScriptActivity'
      | 'generateVisualScriptActivity'
      | 'planAssetAssignmentActivity'
      | 'runSelectAutoStyleTool'
    >
  >({
    taskQueue,
    startToCloseTimeout: '30 minutes',
    heartbeatTimeout: '5 minutes',
    retry: {
      maximumAttempts: 2,
      initialInterval: '30 seconds',
      maximumInterval: '2 minutes',
    },
  })
}

// Article extraction. Runs on the
// brand-extraction task queue where Playwright is deployed; the queue name is
// resolved API-side and rides in on params.articleExtractionTaskQueue. The
// activity heartbeats every 20s (withActivityHeartbeat), so 60s detects a
// dead worker; 2 min start-to-close bounds how long the pre-planner turn can
// stall on a slow site. maximumAttempts=2: content-level failures return a
// typed failure (no retry); only infra errors throw, and one retry covers a
// pod churn without a crawl storm.
export function createArticleExtractionProxy(taskQueue: string) {
  return proxyActivitiesWrapper<Pick<typeof articleExtractionActivities, 'extractArticleActivity'>>(
    {
      taskQueue,
      startToCloseTimeout: '2 minutes',
      heartbeatTimeout: '60 seconds',
      retry: {
        maximumAttempts: 2,
        initialInterval: '5 seconds',
        maximumInterval: '30 seconds',
      },
    },
  )
}
