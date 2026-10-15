import { isSeedance2xModel } from '../veo3/model'

import type { LongTakePromptRoute } from './prompt-router'

export const ABSTRACT_SEEDANCE15_GENERAL_ROUTE_PATCH =
  'long-take/abstract-seedance15-general-route-v1'

/**
 * Story Mode records the Seedance 1.5/default selection as null/undefined.
 * Only explicit Seedance 2.x (and other non-1.x explicit models) keep the
 * abstract generation route.
 */
export function resolveLongTakeGenerationPromptRoute(params: {
  promptRoute: LongTakePromptRoute
  transitionVideoModel?: null | string
}): LongTakePromptRoute {
  if (params.promptRoute !== 'abstract') {
    return params.promptRoute
  }
  if (isSeedance2xModel(params.transitionVideoModel)) {
    return 'abstract'
  }
  if (!params.transitionVideoModel || params.transitionVideoModel.startsWith('seedance-1')) {
    return 'general'
  }
  return 'abstract'
}
