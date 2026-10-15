import type { Spec } from '@reelmakeeasy/uip-planner-runtime'
import { extractScriptFromSpec } from '@reelmakeeasy/uip-planner-runtime'
import { createPlannerStorage } from '@reelmakeeasy/uip-planner-runtime/persistence'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/common'

import type {
  SeedV3PlaygroundShadowActivityParams,
  SeedV3PlaygroundShadowActivityResult,
} from '../../workflows/long-take/types'
import { formatLogFields, logger, withActivityHeartbeat } from '../long-take/common'

const SPEC_CURRENT_PATH = 'spec/current/spec.json'

/**
 * Copy a finished project's planner artifacts onto a shadow project and force
 * the Story Mode 3.0 contract on for the copy.
 *
 * The playground compares a real project's delivered video against what the new
 * pipeline produces from the SAME planner inputs. It cannot reuse the baseline's
 * visual script -- the V3 contract has a different shape (`core_description` is
 * a whole take, there is no `entry_action`/`exit_action`) -- so anchors and the
 * visual script are regenerated from the spec. That regeneration is part of what
 * is being evaluated, not noise around it.
 *
 * The whole planner prefix is copied rather than a curated list: it is a
 * playground, and a missing artifact would surface as a confusing generation
 * failure rather than an obvious one. Stale anchor artifacts in the copy are
 * harmless -- `buildFastPathSessionState` rebuilds `cached_artifacts` from
 * scratch and carries over only `bootstrap`, the uploads and the prompt route,
 * so the anchor arm always replans.
 */
export async function seedV3PlaygroundShadow(
  params: SeedV3PlaygroundShadowActivityParams,
): Promise<SeedV3PlaygroundShadowActivityResult> {
  const { baselineProjectId, shadowProjectId } = params
  return withActivityHeartbeat(async () => {
    const baseline = createPlannerStorage(baselineProjectId)
    const shadow = createPlannerStorage(shadowProjectId)

    const baselineSpec = await baseline.readJsonFile<Spec>(SPEC_CURRENT_PATH).catch(() => null)
    if (!baselineSpec?.visual_script?.shots?.length) {
      // Almost always the real cause: a URL for a project that never reached a
      // confirmed storyboard, or a non-UIP project. Say which rather than
      // failing later inside anchor generation.
      throw ApplicationFailure.nonRetryable(
        `Baseline project ${baselineProjectId} has no confirmed planner spec to replay`,
        'V3_PLAYGROUND_NO_BASELINE_SPEC',
      )
    }

    await shadow.copyFolderFromStorage(baseline, '')

    // The pinned snapshot is what every V3 branch reads -- the visual-script
    // prompt contract, the handoff converter's extra fields, and (for a real
    // session) confirm routing. The shadow project has no UIP session to pin it
    // at creation, so the playground pins it here instead.
    const shadowSpec: Spec = {
      ...baselineSpec,
      meta: { ...baselineSpec.meta, story_mode_v3_enabled: true },
    }
    await shadow.writeJsonFile(SPEC_CURRENT_PATH, shadowSpec)

    const script = extractScriptFromSpec(shadowSpec)
    logger.info(
      `[sm3-playground] Shadow seeded ${formatLogFields({
        baselineProjectId,
        shadowProjectId,
        baselineShotCount: baselineSpec.visual_script.shots.length,
        scriptChars: script.length,
      })}`,
    )

    return {
      baselineShotCount: baselineSpec.visual_script.shots.length,
      script,
    }
  })
}
