/**
 * UIP fast-path anchor + visual-script generation, unified onto the SAME
 * uip-planner-runtime code the normal UIP path uses.
 *
 * The fast path (`confirm_fast`) fires at `script_review` with no interactive
 * planner session. These two activities replace the drifted long-take fork
 * (runVideoConsistencyStages + generateLongTakeVisualScript + the
 * initUipFastPathAnchorIndex seed) that UipToStoryModeFastWorkflow used to run:
 *
 *   1. generateUipFastAnchorVsBatchActivity -- reconstruct a SessionState from
 *      storage (buildFastPathSessionState) and run the shared anchor+VS batch core
 *      (runAnchorVsBatch, the exact code the normal `anchor_vs_batch` tool runs),
 *      then commit the shots into the spec and persist it.
 *   2. convertUipFastToLongTakeArtifactsActivity -- convert the resulting spec +
 *      anchor summary into the long-take render artifacts, using the SAME
 *      converters the normal confirm path uses (uip-confirm-orchestration.ts),
 *      and write the `.uip_pre_generated.json` sentinel so the render's anchor
 *      stage short-circuits.
 *
 * Result: a fix to uip-planner-runtime's anchor/VS logic benefits both paths
 * automatically -- zero drift.
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { LongTakeAnchorIndex } from '@reelmakeeasy/common/long-take/types'
import {
  type AnchorAssetPlanArtifact,
  type AnchorAssetsSummary,
  buildAssetManifestEntry,
  buildLongTakeGlobalConstraintsJson,
  buildUserAssetCatalogForTracking,
  buildUserUploadAnchorEntries,
  convertUipAnchorsToStoryModeIndex,
  convertUipSpecToStoryModeVisualScript,
  countGeneratedAnchorsByCategoryForTracking,
  dedupeUploadedAssets,
  type PersistedSessionState,
  type Spec,
} from '@reelmakeeasy/uip-planner-runtime'
// Deep import: persistence helpers are not on the package barrel (same path
// apply-brand-extraction-patch.ts uses). They no-op when NODE_ENV === 'test'.
import {
  createPlannerStorage,
  persistSpecSnapshot,
} from '@reelmakeeasy/uip-planner-runtime/persistence'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'

import {
  LONG_TAKE_ASSET_MANIFEST_PATH,
  LONG_TAKE_WORLD_BIBLE_PATH,
  type LongTakeAssetManifestOutput,
} from '../long-take-experts-analysis'
import { buildPlannerDeps } from '../uip-v2/activity-deps-factory'
import { createInMemorySessionStore } from '../uip-v2/in-memory-session-store'
import { applyToolOutput } from '../uip-v2/session-state'
import { type AnchorVsBatchInput, runAnchorVsBatch } from '../uip-v2/tools/anchor-vs-batch'
import {
  buildFastPathMergedUploads,
  buildFastPathSessionState,
  buildFastPathUserUploads,
} from '../uip-v2/tools/fast-path-session'

import { withActivityHeartbeat } from './common'
import {
  createLongTakeStorage,
  LONG_TAKE_ANCHOR_RAW_INDEX_PATH,
  LONG_TAKE_ANCHOR_STYLED_INDEX_PATH,
  LONG_TAKE_ANCHOR_UIP_SENTINEL_PATH,
  LONG_TAKE_GLOBAL_CONSTRAINTS_PATH,
} from './storage'

const logger = createSubLogger('story-mode-runtime')

const SPEC_CURRENT_PATH = 'spec/current/spec.json'
const SESSION_STATE_PATH = 'session-state.json'
// UIP writes the world bible here (internal_files) as part of ensureWorldBible
// inside the anchor/VS tools; the render reads it from long_take/experts.
const UIP_WORLD_BIBLE_PATH = 'internal_files/world_bible.json'

export interface ConvertUipFastToLongTakeArtifactsParams {
  anchorPlan?: AnchorAssetPlanArtifact
  anchorSummary?: AnchorAssetsSummary
  projectId: string
}

export interface ConvertUipFastToLongTakeArtifactsResult {
  anchorCount: number
  // Shape-compatible with GeneratedAnchorCounts (video-consistency.ts) for the
  // `project.long_take.completed` tracking event.
  generatedAnchorCounts: {
    numActorAssetsGenerated: number
    numAssetsGenerated: number
    numLogoAssetsGenerated: number
    numObjectAssetsGenerated: number
    numOtherAssetsGenerated: number
  }
  shotCount: number
}

export interface GenerateUipFastAnchorVsBatchParams {
  generationResolution?: { imageSize?: string; videoResolution?: string }
  imageModel?: string
  modelSelectorTier?: ModelSelectorAnalyticsTier
  orgId?: string
  projectId: string
  script: string
  transitionVideoModel?: string
}

export interface GenerateUipFastAnchorVsBatchResult {
  anchorPlan?: AnchorAssetPlanArtifact
  anchorSummary?: AnchorAssetsSummary
  ok: boolean
  shotCount: number
}

/**
 * Run the shared anchor+VS batch core from a storage-reconstructed SessionState.
 * Mirrors the normal path's `anchor_vs_batch` tool: fold -> runAnchorVsBatch is
 * replaced by build-from-storage -> runAnchorVsBatch (the same core). Commits the VS
 * shots into the spec and persists it; the anchor images / asset_plan.json /
 * world_bible.json are written to the planner prefix by the tool run itself.
 */
export async function generateUipFastAnchorVsBatchActivity(
  params: GenerateUipFastAnchorVsBatchParams,
): Promise<GenerateUipFastAnchorVsBatchResult> {
  const {
    generationResolution,
    imageModel,
    modelSelectorTier,
    orgId,
    projectId,
    script,
    transitionVideoModel,
  } = params
  // Anchor-image generation runs ~5-6 min -- far past the proxy heartbeatTimeout.
  // Pump a heartbeat (every 20s) for the whole activity so the server does not
  // treat the worker as dead and retry mid-generation (the same fix
  // withToolHeartbeat applies to the UIP-worker tool activities).
  return withActivityHeartbeat(async () => {
    const plannerStorage = createPlannerStorage(projectId)
    const [spec, persisted] = await Promise.all([
      plannerStorage.readJsonFile<Spec>(SPEC_CURRENT_PATH),
      plannerStorage.readJsonFile<PersistedSessionState>(SESSION_STATE_PATH),
    ])

    const nowIso = new Date().toISOString()
    const session = buildFastPathSessionState({
      generationResolution,
      imageModel,
      modelSelectorTier,
      nowIso,
      orgId,
      persisted,
      projectId,
      script,
      spec,
      transitionVideoModel,
      userUploadedAssets: buildFastPathUserUploads(persisted),
    })

    // Same runtime wiring prepareToolRuntime builds (minus SSE/progress signalers,
    // which the fast path does not stream). buildPlannerDeps is not engine-coupled.
    const runtime = buildPlannerDeps(createInMemorySessionStore())

    // FULL-scope first generation: let the anchor arm plan all anchors from the
    // world bible / script (anchor_requests: null => not a refinement batch), and
    // the VS arm build the full shot list with a fresh world bible + beat sheet.
    // Like every batch, it succeeds only when BOTH arms commit.
    const batchInput: AnchorVsBatchInput = {
      anchor: { anchor_requests: null, edit_mode: 'CREATIVE', scope: 'FULL' },
      anchorToolCallId: 'fast_anchor',
      structure_edit: null,
      vs: {
        edit_mode: 'CREATIVE',
        refresh_beat_sheet: true,
        refresh_world_bible: true,
        scope: 'FULL',
      },
      vsToolCallId: 'fast_vs',
    }

    const result = await runAnchorVsBatch({ batchInput, runtime, session, userMessage: script })
    if (!result.toolResult.ok) {
      const message = `UIP fast-path anchor+VS batch failed: ${result.toolResult.message}`
      // Preserve the arm's retryability -- a transient image-gen failure is worth a
      // whole-activity retry; a deterministic failure is not.
      throw result.toolResult.retryable
        ? ApplicationFailure.create({ message, type: 'uip_fast_anchor_vs_failed' })
        : ApplicationFailure.nonRetryable(message, 'uip_fast_anchor_vs_failed')
    }

    // Commit the batch output: the VS arm's shots merge into spec.visual_script.shots
    // via the auto-apply mapper (same as foldSession's tool_completed replay).
    applyToolOutput(session, 'anchor_vs_batch', result.output, nowIso)

    const shotCount = session.spec.visual_script?.shots?.length ?? 0
    if (shotCount === 0) {
      throw ApplicationFailure.nonRetryable(
        'UIP fast-path visual script produced no shots',
        'uip_fast_empty_visual_script',
      )
    }

    await persistSpecSnapshot(projectId, session.spec)

    const anchorCount = session.cached_artifacts.anchor_assets_summary?.anchors?.length ?? 0
    logger.info(
      `[uip-fast-path] anchor+VS batch committed projectId=${projectId} shots=${shotCount} anchors=${anchorCount}`,
    )

    return {
      anchorPlan: session.cached_artifacts.anchor_plan,
      anchorSummary: session.cached_artifacts.anchor_assets_summary,
      ok: true,
      shotCount,
    }
  })
}

/**
 * Convert the generated spec + anchor summary into the long-take render
 * artifacts, using the SAME shared converters the normal confirm path uses
 * (uip-confirm-orchestration.ts). Writes visual_script.json, the styled+raw
 * anchor indexes, the UIP sentinel, asset_manifest.json, world_bible.json, and
 * global_constraints.json. Cheap + idempotent, so a convert retry never re-runs
 * the ~5-minute generation.
 */
export async function convertUipFastToLongTakeArtifactsActivity(
  params: ConvertUipFastToLongTakeArtifactsParams,
): Promise<ConvertUipFastToLongTakeArtifactsResult> {
  const { anchorPlan, anchorSummary, projectId } = params
  // Cheap I/O, but a large multi-artifact storage write could cross the proxy's
  // heartbeatTimeout on a slow network; pump a heartbeat so it is never wrongly
  // retried as a dead worker.
  return withActivityHeartbeat(async () => {
    const plannerStorage = createPlannerStorage(projectId)
    const [spec, persisted] = await Promise.all([
      plannerStorage.readJsonFile<Spec>(SPEC_CURRENT_PATH),
      plannerStorage.readJsonFile<PersistedSessionState>(SESSION_STATE_PATH),
    ])

    // Generated anchors (styled) resolved to their planner-prefix store:// URIs, plus
    // raw user-upload passthroughs bound directly to shots. Uses the PRE-dedup
    // merge so brand-synthetic ids the script writer force-bound still resolve.
    const anchorIndexAssets = convertUipAnchorsToStoryModeIndex(anchorSummary, (relativePath) =>
      plannerStorage.getFullPath(relativePath),
    )
    const uipPrefix = `projects/${projectId}/user-intent-planner`
    const mergedUploads = buildFastPathMergedUploads(persisted, spec)
    for (const entry of buildUserUploadAnchorEntries(spec, mergedUploads, uipPrefix, projectId)) {
      anchorIndexAssets.push(entry)
    }
    const anchorIndex: LongTakeAnchorIndex = { assets: anchorIndexAssets }

    const visualScript = convertUipSpecToStoryModeVisualScript(spec)
    const shotCount = visualScript.length
    const assetManifest: LongTakeAssetManifestOutput = {
      asset_manifest: (anchorPlan?.candidates ?? []).map(buildAssetManifestEntry),
    }
    const globalConstraintsJson = buildLongTakeGlobalConstraintsJson(spec)
    const worldBible = await loadUipWorldBible(plannerStorage, projectId)

    const longTakeStorage = createLongTakeStorage(projectId)
    await Promise.all([
      longTakeStorage.writeJsonFile('long_take/visual_script.json', visualScript),
      longTakeStorage.writeJsonFile(LONG_TAKE_ANCHOR_STYLED_INDEX_PATH, anchorIndex),
      longTakeStorage.writeJsonFile(LONG_TAKE_ANCHOR_RAW_INDEX_PATH, anchorIndex),
      // Sentinel: presence short-circuits generateLongTakeAnchorAssets so the
      // render reuses these UIP-produced indexes verbatim.
      longTakeStorage.writeJsonFile(LONG_TAKE_ANCHOR_UIP_SENTINEL_PATH, {
        anchorCount: anchorIndexAssets.length,
        generatedAt: new Date().toISOString(),
        projectId,
      }),
      longTakeStorage.writeJsonFile(LONG_TAKE_ASSET_MANIFEST_PATH, assetManifest),
      ...(globalConstraintsJson
        ? [
            longTakeStorage.writeJsonFile(
              LONG_TAKE_GLOBAL_CONSTRAINTS_PATH,
              JSON.parse(globalConstraintsJson),
            ),
          ]
        : []),
      ...(worldBible
        ? [longTakeStorage.writeJsonFile(LONG_TAKE_WORLD_BIBLE_PATH, worldBible)]
        : []),
    ])

    // Per-category generated-anchor counts for `project.long_take.completed`,
    // derived the SAME way the normal confirm path does: the anchor-assets picker
    // names uploads `Actor/Logo/Object image N`, so generated anchors split by
    // category via source_file_ids -> upload shortname. Failed + passthrough
    // (raw upload) anchors are excluded.
    const generatedAnchorCounts = countGeneratedAnchorsByCategoryForTracking(
      anchorIndexAssets,
      buildUserAssetCatalogForTracking(dedupeUploadedAssets(mergedUploads)),
    )

    logger.info(
      `[uip-fast-path] wrote long-take render artifacts projectId=${projectId} shots=${shotCount} anchors=${anchorIndexAssets.length} generated=${generatedAnchorCounts.numAssetsGenerated}`,
    )

    return {
      anchorCount: anchorIndexAssets.length,
      generatedAnchorCounts,
      shotCount,
    }
  })
}

/**
 * Read UIP's `internal_files/world_bible.json` for verbatim handoff to
 * `long_take/experts/world_bible.json`. Missing file is tolerated (a no-anchor
 * flow never wrote one) -- the caller skips the handoff write.
 */
async function loadUipWorldBible(
  storage: ReturnType<typeof createPlannerStorage>,
  projectId: string,
): Promise<null | unknown> {
  try {
    return await storage.readJsonFile<unknown>(UIP_WORLD_BIBLE_PATH)
  } catch (err) {
    logger.info(
      `[uip-fast-path] no UIP world_bible.json, skipping handoff projectId=${projectId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return null
  }
}
