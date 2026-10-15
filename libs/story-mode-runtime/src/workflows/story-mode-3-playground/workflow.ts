/**
 * Story Mode 3.0 playground: re-run one finished project through the new
 * pipeline and leave both videos side by side.
 *
 * The comparison is necessarily whole-pipeline. A V3 run cannot reuse the
 * baseline's visual script -- the contract has a different shape -- so anchors
 * and the visual script are regenerated from the same planner spec. That
 * regeneration is part of what is being evaluated, not noise around it: the
 * baseline video already IS the V2 answer for this input.
 *
 * Everything lands on a SHADOW project, because `ProjectStore` roots itself at
 * `projects/<projectId>` and the whole render pipeline keys off that id. A synthetic
 * slashed id would get treated as a real projectId by Mongo lookups, tracking
 * and accounting, so the isolation is a real (hidden) project instead.
 */
import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-context'

import { createWorkflowLogger } from '../../utilities/workflow-logger'
import {
  convertUipFastToLongTakeArtifactsActivity,
  generateUipFastAnchorVsBatchActivity,
  seedV3PlaygroundShadow,
  writeV3PlaygroundManifest,
} from '../long-take/activity-proxies'
import type { StoryMode3PlaygroundParams, StoryMode3PlaygroundResult } from '../long-take/types'
import { UipToStoryModeV3Workflow } from '../uip-to-story-mode-v3/workflow'

export async function StoryMode3PlaygroundWorkflow(
  params: StoryMode3PlaygroundParams,
): Promise<StoryMode3PlaygroundResult> {
  const { baselineProjectId, shadowProjectId, userEmail, userId } = params
  setWorkflowScopedContext({ projectId: shadowProjectId, userEmail, userId })
  const logger = createWorkflowLogger({ projectId: shadowProjectId, userId })

  const startedAt = new Date().toISOString()
  let baselineShotCount = 0

  try {
    const seeded = await seedV3PlaygroundShadow({ baselineProjectId, shadowProjectId })
    baselineShotCount = seeded.baselineShotCount
    logger.info('sm3Playground: shadow seeded', {
      baselineProjectId,
      baselineShotCount,
      shadowProjectId,
    })

    // The same activity the fast confirm path uses: build a SessionState from
    // storage and run the shared anchor+VS core. Reused rather than reimplemented so
    // the playground and production generate identically.
    //
    // This commits the shots into the PLANNER spec and writes the planner-side
    // artifacts. It does NOT write the render-side ones -- that is the convert
    // step below, and skipping it is what made the first real run die on a
    // missing `long_take/visual_script.json` three activities later.
    const generated = await generateUipFastAnchorVsBatchActivity({
      ...(params.generationResolution ? { generationResolution: params.generationResolution } : {}),
      ...(params.imageModel ? { imageModel: params.imageModel } : {}),
      ...(params.orgId ? { orgId: params.orgId } : {}),
      projectId: shadowProjectId,
      script: seeded.script,
      ...(params.transitionVideoModel ? { transitionVideoModel: params.transitionVideoModel } : {}),
    })

    // Second half of the fast path's generation pair, in the same order: turn
    // the generated spec + anchors into the render artifacts (visual_script.json,
    // styled/raw anchor indexes, the UIP sentinel, asset_manifest, world_bible,
    // global_constraints) through the SAME shared converters confirm uses. The
    // handoff converter emits the V3 fields here, because the seeded spec pins
    // the snapshot on.
    const converted = await convertUipFastToLongTakeArtifactsActivity({
      ...(generated.anchorPlan ? { anchorPlan: generated.anchorPlan } : {}),
      ...(generated.anchorSummary ? { anchorSummary: generated.anchorSummary } : {}),
      projectId: shadowProjectId,
    })
    logger.info('sm3Playground: anchor + visual script regenerated', {
      anchorCount: converted.anchorCount,
      shadowProjectId,
      shotCount: converted.shotCount,
    })

    // Called in-process rather than started as a child workflow: the playground
    // is the only caller, it wants the render's own failure to surface here, and
    // an in-process call keeps both in one history to read.
    const render = await UipToStoryModeV3Workflow({
      ...params.renderParams,
      projectId: shadowProjectId,
      script: seeded.script,
      userEmail,
      userId,
      // Written by the convert activity above, through the same handoff
      // converter the real confirm uses.
      visualScriptItemCount: converted.shotCount,
      visualScriptPath: 'long_take/visual_script.json',
    })

    // A render that fails INSIDE the V3 workflow returns rather than throwing,
    // so this never reaches the catch below. Say so explicitly instead of
    // leaving a manifest that reads `failed` with no explanation --
    // `UipToStoryModeWorkflowResult` carries no message, and the classified
    // reason the render recorded lives on the project row, which the compare
    // page reads.
    const status = render.status === 'completed' ? 'completed' : 'failed'
    const manifest = await writeV3PlaygroundManifest({
      baselineProjectId,
      baselineShotCount,
      ...(status === 'failed'
        ? { error: 'The V3 render workflow failed; see the project stage detail for the reason.' }
        : {}),
      shadowProjectId,
      shotCount: converted.shotCount,
      startedAt,
      status,
      ...(render.videoUri ? { videoUri: render.videoUri } : {}),
    })

    logger.info('sm3Playground: finished', { shadowProjectId, status })
    return {
      manifestPath: manifest.manifestPath,
      shadowProjectId,
      status,
      ...(render.videoUri ? { videoUri: render.videoUri } : {}),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('sm3Playground: failed', { error: message, shadowProjectId })
    // Best-effort: a run that died in seeding or generation still deserves a
    // manifest, so the compare page can say what happened instead of spinning.
    const manifest = await writeV3PlaygroundManifest({
      baselineProjectId,
      baselineShotCount,
      error: message,
      shadowProjectId,
      startedAt,
      status: 'failed',
    }).catch(() => ({ manifestPath: '' }))
    return {
      error: message,
      manifestPath: manifest.manifestPath,
      shadowProjectId,
      status: 'failed',
    }
  }
}
