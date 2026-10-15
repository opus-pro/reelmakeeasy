import { readInpaintState } from '@reelmakeeasy/common/inpaint/state-store'
import type { EditPlanTaskResult, InpaintGlobalState } from '@reelmakeeasy/common/inpaint/state'
import type { InpaintModelFamily } from '@reelmakeeasy/common/inpaint/types'
import { BadRequestException } from '@nestjs/common'
import type { DebugSettings } from '@shared/types/project/debug-settings'

import { resolveInpaintModel } from './inpaint-model-resolution.util'

// Finds a resolved edit-plan run's result by run id across all plan records.
function findResolvedPlanResult(
  state: InpaintGlobalState,
  planRunId: string,
): EditPlanTaskResult | undefined {
  for (const entry of Object.values(state.tasks.editPlanRecords)) {
    for (const run of entry.runs) {
      if (run.state === 'resolved' && run.id === planRunId) {
        return run.result
      }
    }
  }
  return undefined
}

/**
 * The model family a confirmed plan generates with, resolved server-side from the
 * source video's provenance (never from the client). v1 plans resolve against their
 * planCase (so the ref-ceiling pre-check has real durations); legacy v0 plans have no
 * per-transition durations and resolve without one, but must list the family.
 */
export async function resolvePlanModelFamily(
  projectId: string,
  planRunId: string,
  debugSettings: DebugSettings,
  orgId: string,
): Promise<InpaintModelFamily> {
  const state = await readInpaintState(projectId)
  if (!state) {
    throw new BadRequestException('inpaint state not found')
  }
  const result = findResolvedPlanResult(state, planRunId)
  if (!result) {
    throw new BadRequestException(`plan run not found or not resolved: ${planRunId}`)
  }
  if (result.v === 1) {
    const { modelFamily } = resolveInpaintModel(debugSettings, orgId, result.planCase)
    return modelFamily
  }
  const { modelFamily } = resolveInpaintModel(debugSettings, orgId)
  if (!result.plans.some((p) => p.modelFamily === modelFamily)) {
    throw new BadRequestException(`no plan for modelFamily=${modelFamily}`)
  }
  return modelFamily
}
