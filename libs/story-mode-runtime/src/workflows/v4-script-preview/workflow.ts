import { proxyActivitiesWrapper } from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'

import type * as activities from '../long-take/activities'

const { generateV4Script } = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: { maximumAttempts: 1 },
})

export interface V4ScriptPreviewWorkflowParams {
  hasUserLengthRequest?: boolean
  maxWords: number
  projectId: string
  rawInput: string
  targetWords: number
  userId: string
}

export interface V4ScriptPreviewWorkflowResult {
  productMissing: boolean
  script: string
  usedV4: boolean
}

/**
 * Single-activity workflow: runs the short scriptwriter prompt directly.
 * Content-type classification and per-category word budgeting are folded
 * into the prompt itself -- one LLM call handles classification, budget
 * selection, and generation.
 *
 * Pass-through of `hasUserLengthRequest`: when the user explicitly
 * specified a length, the prompt pins to that exact budget; otherwise
 * the prompt self-selects from its internal Marketing / Narrative /
 * Explainer budget table.
 */
export async function V4ScriptPreviewWorkflow(
  params: V4ScriptPreviewWorkflowParams,
): Promise<V4ScriptPreviewWorkflowResult> {
  const { hasUserLengthRequest, maxWords, projectId, rawInput, targetWords, userId } = params

  const { script } = await generateV4Script({
    hasUserLengthRequest: Boolean(hasUserLengthRequest),
    maxWords,
    projectId,
    rawInput,
    targetWords,
    userId,
  })

  if (!script) {
    return { productMissing: false, script: '', usedV4: false }
  }

  return { productMissing: false, script, usedV4: true }
}
