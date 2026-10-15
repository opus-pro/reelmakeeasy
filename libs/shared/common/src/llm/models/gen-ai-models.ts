export const GenAIModels = [
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-image',
  'gemini-3.1-pro-preview',
  'gemini-3-pro-image',
  'gemini-3-flash-preview',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'seed-2-0-pro-260328',
  // Vertex retired these -preview image ids (now 404). Kept as
  // deprecated aliases so persisted / in-flight / config values still validate;
  // generateImage() normalizes them to their GA id at the provider boundary.
  // Remove after the persisted-row backfill (contract step).
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  // Google retired this completion id. Keep the alias
  // type-valid while persisted and in-flight values drain; completion()
  // normalizes it to gemini-3.1-flash-lite before provider dispatch.
  'gemini-3.1-flash-lite-preview',
] as const

export type GenAIModel = (typeof GenAIModels)[number]

const googleSearchGroundingModels: readonly GenAIModel[] = [
  'gemini-2.5-flash',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
  'gemini-3.1-flash-preview',
  'gemini-3.1-flash-lite',
  'gemini-3.1-flash-image',
  'gemini-3.1-pro-preview',
  'gemini-3-pro-image',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  // Deprecated -preview aliases, kept for legacy value compat.
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
  'gemini-3.1-flash-lite-preview',
]

export const genAIModelExtension = {
  Models: GenAIModels,

  supports(model: string): boolean {
    return GenAIModels.includes(model as GenAIModel)
  },

  supportsImageGen(model: string): boolean {
    return this.supports(model) && model.includes('image')
  },

  supportsGoogleSearchGrounding(model: string): boolean {
    return googleSearchGroundingModels.includes(model as GenAIModel)
  },

  supportsImageSearchGrounding(model: string): boolean {
    // Only the flash image model supports SEARCH_TYPE_IMAGE grounding. Accept
    // the deprecated -preview alias too until legacy values drain.
    return model === 'gemini-3.1-flash-image' || model === 'gemini-3.1-flash-image-preview'
  },

  toAlias(model: GenAIModel, enableSearch?: boolean, enableReasoning?: boolean): string {
    let result: string = model
    if (model.includes('-preview')) {
      result = model.split('-preview')[0]
    }
    if (enableSearch) {
      result = `${result}-search`
    }
    if (enableReasoning) {
      result = `${result}-reasoning`
    }
    return result
  },

  supportThinkingBudget(model: GenAIModel): boolean {
    return model.includes('2.5') || model.includes('gemini-3')
  },

  // https://ai.google.dev/gemini-api/docs/thinking#set-budget
  convertEffortToThinkingBudget(
    model: GenAIModel,
    reasoningEffort: GenAIReasoningEffort = 'minimal',
  ): number {
    return model.includes('flash')
      ? flashThinkingBudgets[reasoningEffort]
      : proThinkingBudgets[reasoningEffort]
  },

  isThinkingModel(model: GenAIModel, reasoningEffort: GenAIReasoningEffort = 'minimal'): boolean {
    if (model.includes('flash')) {
      return flashThinkingBudgets[reasoningEffort] > 0
    }
    if (model.includes('pro')) {
      return true
    }
    return false
  },
}

export type GenAIReasoningEffort = 'high' | 'low' | 'medium' | 'minimal'

const flashThinkingBudgets: Record<GenAIReasoningEffort, number> = {
  high: 24576,
  medium: 12288,
  low: 6144,
  minimal: 0,
}

const proThinkingBudgets: Record<GenAIReasoningEffort, number> = {
  high: 32768,
  medium: 16384,
  low: 8192,
  minimal: 128,
}
