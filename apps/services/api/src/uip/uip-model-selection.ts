import { parseModelSelectorAnalyticsTier } from '@reelmakeeasy/common/model-config/model-selector-analytics-tier'
import { BadRequestException, ConflictException } from '@nestjs/common'

import type { UipService } from './uip.service'

export interface SelectUipModelsInput {
  image_model: string
  model_selector_tier: 'standard' | 'standard_plus'
  transition_video_model: string
}

/** Retry only an aborted Mongo transaction, never a workflow signal or unknown commit. */
export async function retryModelTransaction<T>(operation: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!error || typeof error !== 'object' || !('code' in error) || error.code !== 'P2034') {
        throw error
      }
      if (attempt === 2) {
        throw new ConflictException('Model selection changed concurrently. Please retry.')
      }
    }
  }
}

/**
 * Per-tier custom model selection. No tier offers a custom model catalog, so a
 * well-formed request from an authorized caller is always rejected as
 * unavailable.
 */
export async function selectUipModels(
  svc: UipService,
  projectId: string,
  input: SelectUipModelsInput,
): Promise<never> {
  const tier = parseModelSelectorAnalyticsTier(input?.model_selector_tier)
  if (
    (tier !== 'standard' && tier !== 'standard_plus') ||
    typeof input?.image_model !== 'string' ||
    !input.image_model.trim() ||
    typeof input?.transition_video_model !== 'string' ||
    !input.transition_video_model.trim()
  ) {
    throw new BadRequestException('A Story Mode tier and both model IDs are required')
  }
  await svc.assertUipAccess(projectId, 'write')
  throw new BadRequestException(
    'The selected models are not available for this tier. Please choose again.',
  )
}
