/**
 * BrandExtractionWorkflow -- spawned as a sibling child by `UipSessionWorkflow`
 * when the planner emits a patch setting
 * `global_constraints.brand_extraction_input`. Runs Playwright crawl
 * (URL kind only) + LLM synthesis, then signals the parent with a
 * content-only `BrandBank` payload for the parent to apply via
 * `seed_brand_synthesis` patch op.
 *
 * `parentClosePolicy: ABANDON` -- if the parent closes (user locks the
 * brief) while the child is mid-run, the child still completes and writes
 * its outputs to storage staging. The parent-signal call is wrapped to swallow
 * `WorkflowExecutionAlreadyCompleted` / `WorkflowNotFoundError` so a closed
 * parent does not fail the child or get resurrected via signalWithStart.
 */

import type {
  AssetDescriptionItem,
  BrandBank,
  StagedAssetRef,
} from '@reelmakeeasy/uip-planner-runtime'

import type { BrandExtractionFailureReason } from './signals'

export type BrandExtractionInput = { kind: 'freeform'; text: string } | { kind: 'url'; url: string }

export interface BrandExtractionWorkflowParams {
  input: BrandExtractionInput
  parentWorkflowId: string
  projectId: string
  runId: string
  userEmail?: string
  userId: string
}

export interface BrandExtractionWorkflowResult {
  // The synthesized brand, also returned inline (not just signalled to the
  // parent) so a standalone, parent-less caller -- create-brand-in-library --
  // can read it straight off `handle.result()`. The UIP parent ignores these
  // and folds the equivalent `brandExtractionReadySignal` payload instead.
  // Populated on a 'completed' outcome; mirror the ready-signal field shapes.
  assetDescriptions?: AssetDescriptionItem[]
  bankWithoutAssets?: Omit<BrandBank, 'staged_assets'>
  // Set on a 'failed' outcome so the caller can surface the right copy.
  failureReason?: BrandExtractionFailureReason
  outcome: 'completed' | 'failed'
  // Website screenshots staged by the crawl (url kind), for downstream style gen.
  screenshotUris?: string[]
  stagedAssetCandidates?: {
    character: StagedAssetRef[]
    logo: StagedAssetRef[]
    product: StagedAssetRef[]
  }
}

/**
 * Workflow run timeout. Caps total wall time end-to-end across crawl
 * (15 min) + synthesis (5 min) + signal-back. 20 minutes leaves headroom
 * for the rare slow-crawl case while still catching genuinely-stuck runs
 * (e.g. dispatched to a queue with no worker, or a hung signal call) that
 * would otherwise sit in `Running` until namespace retention drops them.
 *
 * Both the dev shim and the UIP parent must pass this when starting
 * the workflow.
 */
export const BRAND_EXTRACTION_WORKFLOW_RUN_TIMEOUT = '20 minutes'
