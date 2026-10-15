type ReasoningEffort = 'high' | 'low' | 'medium' | 'minimal' | null
type Reasoning = { effort?: ReasoningEffort; summary?: 'auto' | 'concise' | 'detailed' | null }

export const OpenAiModels = [
  'gpt-4o-mini',
  'gpt-4o',
  'gpt-4.1-mini',
  'gpt-4.1',
  'gpt-5',
  'gpt-5.2',
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6-luna',
  'gpt-5-mini',
  'gpt-5-nano',
  'o4-mini',
  'o3',
  'gpt-image-2',
  'gpt-image-1',
  'gpt-image-1-mini',
] as const

export type OpenAiModel = (typeof OpenAiModels)[number]

const reasoningModels = [
  'o4-mini',
  'o3',
  'gpt-5',
  'gpt-5.2',
  'gpt-5.4',
  'gpt-5.5',
  'gpt-5.6-luna',
  'gpt-5-mini',
]

export const openAiModelExtension = {
  models: OpenAiModels,

  supports(model: string): boolean {
    return OpenAiModels.includes(model as OpenAiModel)
  },

  supportsImageGen(model: string): boolean {
    return this.supports(model) && model.includes('image')
  },

  isReasoningModel(model: string): boolean {
    return reasoningModels.includes(model)
  },

  convertReasoningEffort(
    model: OpenAiModel,
    useOpenAiTool: boolean,
    reasoningEffort: ReasoningEffort = 'minimal',
    summary = false,
  ): Reasoning | undefined {
    if (!this.isReasoningModel(model)) {
      return undefined
    }

    if (model.startsWith('gpt-5') && !useOpenAiTool) {
      return { effort: reasoningEffort, summary: summary ? 'auto' : undefined }
    }

    if (reasoningEffort === 'minimal') {
      return undefined
    }

    return { effort: reasoningEffort, summary: summary ? 'auto' : undefined }
  },

  toAlias(model: OpenAiModel, enableSearch?: boolean): string {
    const alias = model.split('-preview')[0]
    return enableSearch ? `${alias}-search` : alias
  },
}
