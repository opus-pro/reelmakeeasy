/** Provider-side web search tool config; forwarded as-is where supported. */
type WebSearchTool = { [key: string]: unknown; type: string }
import { z } from 'zod'

import { type GenAIReasoningEffort, type Model } from '../models'

export type AudioContent = {
  audioUrl: string
  mimeType?: string
  type: 'audio_url'
}
export interface Client {
  completion<T extends z.ZodTypeAny>(options: ClientCompletionOptions<T>): Promise<z.infer<T>>
  generateImage(options: ClientImageGenerationOptions): Promise<ClientImageGenerationResult>
  supports(model: string): boolean
  supportsImageGen(model: string): boolean
}
export type ClientCompletionOptions<T extends z.ZodTypeAny> = {
  allowedTools?: string[]
  contents?: Content[]
  dumpPathPrefix?: string
  /**
   * OpenAI / BytePlus Responses API chain support (forwarded to libs/llm).
   * Setting either field opts the call into
   * chain mode: the provider stores prior turns server-side, the caller
   * sends only the new user turn, and a `responseId` flows back via
   * `completionWithMeta`. Use `enableResponseChain: true` on the first
   * turn (no id yet) and `previousResponseId` on continuations. Chain
   * mode pins a single provider+model -- callers should pass a one-item
   * `models` array; the SDK already bypasses the multi-model fallback
   * requirement when chain fields are set. Ignored by non-Responses
   * providers (GenAI / Minimax / Fal).
   */
  enableResponseChain?: boolean
  enableSearch?: EnableSearch
  extractGroundingUrls?: boolean
  maxTokens?: number
  maxToolUseSteps?: number
  model: Model
  /**
   * See `enableResponseChain` -- pass the id returned from the prior
   * `completionWithMeta` call to continue a chain. The SDK strips
   * `systemPrompt` automatically when this is set, so callers do not
   * need to resend it.
   */
  previousResponseId?: string
  prompt: string
  reasoningEffort?: ReasoningEffort
  reasoningSink?: (reasoningSummary: string) => Promise<void>

  responseFormat: T
  responseMimeType?: string
  seed?: number
  store?: boolean
  systemPrompt?: string
  // We referred litellm to use modelAlias in metrics https://docs.litellm.ai/docs/completion/model_alias
  task: string
  temperature?: number

  timeout?: number
  tools?: LlmTool[]
  topP?: number
}
export type ClientImageGenerationOptions = {
  aspectRatio?: string // only for genai
  background?: 'auto' | 'opaque' | 'transparent' | null // sample: "transparent"
  // genai: multimodal parts. openai: image_url entries are harvested into the
  // images.edit input (the SDK's OpenAIProvider.generateImage), so reference
  // images DO reach gpt-image-* models -- this is not genai-only.
  contents?: Content[]
  grounding?: {
    enableImageGrounding?: boolean
    enableTextGrounding?: boolean
  }
  image?: File // for gpt image generation
  // Gemini image size tier; mapped to imageConfig.imageSize by
  // the image adapter (libs/llm) for models that support it (gemini-3-pro image family).
  // Older bundles and 1K-only models ignore it. ImageSizeTier in media/types.
  imageSize?: '1K' | '2K' | '4K'
  mask?: File // for gpt image editing
  model: Model
  n?: number // default: 1
  prompt: string
  quality?: 'auto' | 'high' | 'low' | 'medium'
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto' // only for op
  task: string
  timeout?: number
}
export type ClientImageGenerationResult = {
  imageBase64: string
}
export type Content = AudioContent | DocumentContent | ImageContent | TextContent | VideoContent
export type DocumentContent = {
  documentUrl: string
  filename?: string
  mimeType?: string
  type: 'document_url'
}
export type EnableSearch = boolean | WebSearchTool
export type ImageContent = {
  imageUrl: string
  type: 'image_url'
}

// Please use `defineTool` to create tools instead of creating them manually.
export type LlmTool = {
  description: string
  fn: (params: object) => Promise<string>
  name: string
  paramsSchema: z.AnyZodObject
}
export type NormalizedSearch = {
  enabled: boolean
  tool?: WebSearchTool
}
export type TextContent = {
  text: string
  type: 'text'
}
export type VideoContent = {
  fps?: number
  type: 'video_url'
  videoUrl: string
}

type ReasoningEffort = GenAIReasoningEffort

export function defineTool<T extends z.AnyZodObject>({
  name,
  description,
  paramsSchema,
  fn,
}: {
  description: string
  fn: (params: z.infer<T>) => Promise<string>
  name: string
  paramsSchema: T
}): LlmTool {
  return {
    name,
    description,
    paramsSchema,
    fn: async (params) => {
      return await fn(params as z.infer<T>)
    },
  }
}
export function normalizeEnableSearch(enableSearch?: EnableSearch): NormalizedSearch {
  if (enableSearch && typeof enableSearch === 'object') {
    return { enabled: true, tool: enableSearch }
  }

  return { enabled: Boolean(enableSearch) }
}
