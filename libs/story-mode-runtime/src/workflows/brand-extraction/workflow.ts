// BrandExtractionWorkflow. Sibling child of UipSessionWorkflow, spawned when the
// planner sets `global_constraints.brand_extraction_input`. Three stages:
//   1. URL kind: `crawlBrandSiteActivity` (Playwright + storage staging). Skipped for freeform.
//   2. `synthesizeBrandActivity`: single completion() -> content-only BrandBank.
//   3. Inline signal back to the parent with content + asset manifest. Uses
//      `getExternalWorkflowHandle().signal()`; never `signalWithStart`
//      because `ParentClosePolicy.ABANDON` may have closed the parent.
//
// Errors are caught, mapped to a `BrandExtractionFailureReason`, and signalled via
// the failed signal so the workflow itself always returns `{ outcome }` cleanly.

import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'
import type { AssetDescriptionItem } from '@reelmakeeasy/uip-planner-runtime'
import {
  getExternalWorkflowHandle,
  log as workflowLog,
  workflowInfo,
} from '@reelmakeeasy/workflow-engine/workflow'

import {
  crawlBrandSiteActivity,
  describeStagedAssetsActivity,
  synthesizeBrandActivity,
} from './activity-proxies'
import {
  brandExtractionFailedSignal,
  type BrandExtractionFailedSignalPayload,
  type BrandExtractionFailureReason,
  brandExtractionReadySignal,
  type BrandExtractionReadySignalPayload,
} from './signals'
import type { BrandExtractionWorkflowParams, BrandExtractionWorkflowResult } from './types'

export async function BrandExtractionWorkflow(
  params: BrandExtractionWorkflowParams,
): Promise<BrandExtractionWorkflowResult> {
  const { runId, projectId, parentWorkflowId, input, userId, userEmail } = params

  // Bind context so child activities emit structured `projectId` log fields,
  // matching the pre-voiceover convention (`workflows/pre-voiceover/workflow.ts:66`).
  setWorkflowScopedContext({ projectId, userId, userEmail })

  workflowLog.info(
    `[brand-extraction] Starting brand extraction ${JSON.stringify({
      runId,
      kind: input.kind,
      parentWorkflowId,
      workflowId: workflowInfo().workflowId,
    })}`,
  )

  let crawlResult: Awaited<ReturnType<typeof crawlBrandSiteActivity>> | null = null
  try {
    if (input.kind === 'url') {
      crawlResult = await crawlBrandSiteActivity({
        runId,
        projectId,
        userId,
        userEmail,
        url: input.url,
      })
    }

    const crawledCandidates = crawlResult?.stagedAssetCandidates ?? {
      logo: [],
      product: [],
      character: [],
    }
    const synthesisInput = {
      runId,
      projectId,
      userId,
      userEmail,
      input,
      screenshotUris: crawlResult?.screenshotUris,
    }
    const usesDescribePass = hasAnyStagedAssets(crawledCandidates)

    let stagedAssetCandidates = crawledCandidates
    let assetDescriptions: AssetDescriptionItem[] = []
    let bankWithoutAssets: Awaited<ReturnType<typeof synthesizeBrandActivity>>['bankWithoutAssets']

    if (usesDescribePass) {
      // Synthesize first, then describe with the brand name threaded in so
      // describe can drop non-brand (sponsor / third-party) logos.
      const synthesis = await synthesizeBrandActivity(synthesisInput)
      bankWithoutAssets = synthesis.bankWithoutAssets
      const describeResult = await describeStagedAssetsActivity({
        brandName: bankWithoutAssets.basic_info.business_name,
        projectId,
        runId,
        stagedAssetCandidates: crawledCandidates,
      })
      stagedAssetCandidates = describeResult.rebucketedCandidates
      assetDescriptions = describeResult.assetDescriptions
    } else {
      const synthesis = await synthesizeBrandActivity(synthesisInput)
      bankWithoutAssets = synthesis.bankWithoutAssets
    }

    await signalParentReady(parentWorkflowId, {
      runId,
      bankWithoutAssets,
      stagedAssetCandidates,
      ...(assetDescriptions.length > 0 ? { assetDescriptions } : {}),
    })

    // Also return the synthesis inline so a standalone caller can read it off
    // `handle.result()` without a parent to receive the signal (the UIP parent
    // ignores this and folds the signal).
    return {
      outcome: 'completed',
      bankWithoutAssets,
      stagedAssetCandidates,
      ...(assetDescriptions.length > 0 ? { assetDescriptions } : {}),
      ...(crawlResult?.screenshotUris ? { screenshotUris: crawlResult.screenshotUris } : {}),
    }
  } catch (err) {
    const reason = mapErrorToReason(err)
    const message = err instanceof Error ? err.message : String(err)
    workflowLog.warn(`[brand-extraction] failed ${JSON.stringify({ runId, reason, message })}`)
    await signalParentFailed(parentWorkflowId, { runId, reason, message })
    return { outcome: 'failed', failureReason: reason }
  }
}

/**
 * Extract the classification token from an error that may have crossed the
 * activity / workflow boundary. `instanceof` can't be used because a thrown
 * `CrawlBrandSiteError` is wrapped in an `ApplicationFailure`: its `name`
 * becomes the generic `'ApplicationFailure'`, but its `type` preserves the
 * original class name. Prefer `.type`,
 * falling back to `.name` for un-serialized errors and for the
 * `ActivityFailure` / `TimeoutFailure` wrappers (which carry no `.type`).
 *
 * Reading `.name` alone silently collapsed every boundary-crossed
 * `CrawlBrandSiteError` to the `internal_error` fallback.
 */
function errorType(err: unknown): string {
  if (err && typeof err === 'object') {
    if ('type' in err && typeof err.type === 'string' && err.type) {
      return err.type
    }
    if ('name' in err && typeof err.name === 'string') {
      return err.name
    }
  }
  return ''
}

function hasAnyStagedAssets(
  candidates: BrandExtractionReadySignalPayload['stagedAssetCandidates'],
): boolean {
  return candidates.logo.length + candidates.product.length + candidates.character.length > 0
}

function isParentClosedError(err: unknown): boolean {
  const name = errorType(err)
  const message = err instanceof Error ? err.message : ''
  // `WorkflowExecutionAlreadyCompleted` is what `signal()` actually throws
  // on a closed external workflow, but the spec calls out `WorkflowNotFoundError`
  // and admission-side code (`apps/services/story-mode/src/activities/admission/utils.ts:235`)
  // checks both name strings. Mirror that defensive check.
  //
  // The `ExternalWorkflowExecutionNotFound` case (parent never existed, e.g.
  // already-deleted by retention or the dev shim's synthetic parent ID) may
  // surface as a generic ApplicationFailure with the message below instead of
  // one of those names. Match by message content so we swallow it too.
  return (
    name === 'WorkflowExecutionAlreadyCompleted' ||
    name === 'WorkflowNotFoundError' ||
    name === 'WorkflowExecutionAlreadyCompletedError' ||
    /Unable to signal external workflow because it was not found/.test(message)
  )
}

function mapErrorToReason(err: unknown): BrandExtractionFailureReason {
  const name = errorType(err)
  const message = err instanceof Error ? err.message : ''
  if (name === 'CrawlBrandSiteError') {
    // The activity's `kind` is not carried on the activity failure (only the
    // message is), so re-derive it from the message text. Order matters
    // and the patterns must be specific: both the SSRF-reject messages
    // (invalid_url kind: `blocked hostname: ...`, `blocked RFC1918 ...`) and the
    // bot-wall message (crawl_blocked kind: `...from https://...; site likely
    // blocked the bot`) contain the words `blocked` / `https`, so a broad
    // `/https/i` or an early `/blocked/i` would cross-classify them.
    if (/timeout|timed out/i.test(message)) {
      return 'crawl_timeout'
    }
    // invalid_url comes from `validateOutboundUrl`: `invalid url: ...`,
    // `only https:// is allowed ...`, or the SSRF `blocked <hostname|RFC1918|
    // private IPv6>: ...` rejects. Match these before the generic crawl signals.
    if (/invalid url|only https|blocked (?:hostname|rfc1918|private)/i.test(message)) {
      return 'invalid_url'
    }
    // crawl_blocked: zero-pages bot-wall or a Chromium name/connection error.
    if (/blocked|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_REFUSED/i.test(message)) {
      return 'crawl_blocked'
    }
    return 'internal_error'
  }
  if (name === 'BrandSynthesisError') {
    return 'synthesis_failed'
  }
  // The engine wraps activity errors as ActivityFailure / TimeoutFailure.
  // The underlying typed error is in `cause`; recurse so we hit the inner
  // CrawlBrandSiteError / BrandSynthesisError name check.
  if (name === 'ActivityFailure' || name === 'TimeoutFailure') {
    const inner = (err as { cause?: unknown })?.cause
    if (inner && inner !== err) {
      return mapErrorToReason(inner)
    }
    if (name === 'TimeoutFailure') {
      return 'crawl_timeout'
    }
  }
  // Fallback: walk the cause chain in case anything else wraps a typed error.
  const wrapped = (err as { cause?: unknown })?.cause
  if (wrapped && wrapped !== err) {
    return mapErrorToReason(wrapped)
  }
  return 'internal_error'
}

async function signalParentFailed(
  parentWorkflowId: string,
  payload: BrandExtractionFailedSignalPayload,
): Promise<void> {
  try {
    const parent = getExternalWorkflowHandle(parentWorkflowId)
    await parent.signal(brandExtractionFailedSignal, payload)
  } catch (err) {
    if (isParentClosedError(err)) {
      workflowLog.warn(
        `[brand-extraction] parent closed before failed signal ${JSON.stringify({
          parentWorkflowId,
          runId: payload.runId,
        })}`,
      )
      return
    }
    throw err
  }
}

async function signalParentReady(
  parentWorkflowId: string,
  payload: BrandExtractionReadySignalPayload,
): Promise<void> {
  try {
    const parent = getExternalWorkflowHandle(parentWorkflowId)
    await parent.signal(brandExtractionReadySignal, payload)
  } catch (err) {
    if (isParentClosedError(err)) {
      workflowLog.warn(
        `[brand-extraction] parent closed before ready signal -- bank lives in storage staging ${JSON.stringify(
          { parentWorkflowId, runId: payload.runId },
        )}`,
      )
      return
    }
    throw err
  }
}
