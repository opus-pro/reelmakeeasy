import { isKnownModel, legacyTarget } from '@reelmakeeasy/llm/registry'

import { type GenAIModel, GenAIModels } from './gen-ai-models'
import { type OpenAiModel, OpenAiModels } from './open-ai-models'

export const AnthropicModels = ['claude-fable-5'] as const
export type AnthropicModel = (typeof AnthropicModels)[number]

export type Model = AnthropicModel | GenAIModel | OpenAiModel

export const ModelList = [...new Set([...AnthropicModels, ...GenAIModels, ...OpenAiModels])]

export type ModelTier = 'flash' | 'lite' | 'pro'

// Known = a registry image model (key, alias or endpoint) or a legacy id the
// registry still maps onto a role, e.g. one persisted on an old project.
export function isImageGenModel(model: string): boolean {
  return isKnownModel('image', model) || legacyTarget('image', model) !== null
}

export const ModelTierMap: Record<ModelTier, Model[]> = {
  lite: ['gemini-3.1-flash-lite', 'gpt-5-nano'],
  flash: ['gemini-3.5-flash', 'gpt-4.1', 'gpt-4o'],
  pro: ['gemini-2.5-pro', 'gpt-5', 'gpt-4.1'],
}

export * from './completion-model-normalization'
export * from './gen-ai-models'
export * from './image-model-normalization'
export * from './open-ai-models'
