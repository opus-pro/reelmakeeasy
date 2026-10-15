import type { z } from 'zod'

import type { ImageRole, VideoRole } from './registry/schema'

export interface AudioContent {
  audioUrl: string
  mimeType?: string
  type: 'audio_url'
}

export interface AudioGenerationOptions {
  [option: string]: unknown
  /** The length to compose, in seconds, for models that take one. */
  durationSec?: number
  format?: 'mp3' | 'wav'
  models: Model | Model[]
  negativePrompt?: string
  prompt: string
  role?: 'music'
  /** Comma-separated style tags, for models that take tags rather than prose. */
  tags?: string
  task: string
}

export interface AudioGenerationResult {
  audioBase64: string
  model: Model
}

export interface ChatTransport {
  /** Provider name recorded on results (e.g. 'codex'). */
  name: string
  send(request: ChatTransportRequest, timeoutMs: number): Promise<ChatTransportResponse>
}

/** One OpenAI-style chat request, exactly what `postChat` would send. */
export interface ChatTransportRequest {
  [key: string]: unknown // temperature, top_p, max_tokens, reasoning_effort
  messages: unknown[] // ChatMessage[] as built in completeOnce
  model: string
  response_format?: {
    json_schema: { name: string; schema: Record<string, unknown>; strict: boolean }
    type: 'json_schema'
  }
  tools?: unknown[]
}

/** Returns a transport for the current call, or null for the env-selected endpoint. */
export type ChatTransportResolver = () => ChatTransport | null

/** The subset of an OpenAI chat response that completeOnce reads. */
export interface ChatTransportResponse {
  choices: { message: { content: null | string; tool_calls?: unknown[] } }[]
  id?: string
  model?: string
  usage?: Record<string, number>
}

export type CompletionModels = Array<Model | ModelTier> | Model | Model[] | ModelTier

export interface CompletionOptions<T extends z.ZodTypeAny> {
  [option: string]: unknown
  allowedTools?: string[]
  biz?: string
  contents?: Content[]
  /** Provider-specific; ignored by the OpenAI-compatible transport. */
  enableSearch?: unknown
  maxTokens?: number
  maxToolUseSteps?: number
  models: CompletionModels
  prompt: string
  reasoningEffort?: string
  responseFormat: T
  responseValidator?: (response: z.infer<T>) => boolean
  systemPrompt?: string
  task: string
  temperature?: number
  timeout?: number
  tools?: LLMTool[]
  topP?: number
}

export interface CompletionWithMetaResult<T extends z.ZodTypeAny> {
  model: Model
  provider: string
  providerModel: string
  responseId?: string
  result: z.infer<T>
  usage: Usage
}

export type Content = AudioContent | DocumentContent | ImageContent | TextContent | VideoContent

export interface DocumentContent {
  cacheControl?: unknown
  documentUrl: string
  filename?: string
  mimeType?: string
  type: 'document_url'
}

export interface ImageContent {
  cacheControl?: unknown
  imageUrl: string
  type: 'image_url'
}

export interface ImageGenerationOptions {
  [option: string]: unknown
  aspectRatio?: string
  contents?: Content[]
  imageSize?: '1K' | '2K' | '4K'
  /** A registry key, alias, legacy id or fal endpoint. The first entry is used. */
  models: Model | Model[]
  prompt: string
  /** The role to use when `models` is empty, legacy or unknown. Defaults to image.edit with references, else image.generate. */
  role?: ImageRole
  task: string
}

export interface ImageGenerationWithMetaResult {
  imageBase64: string
  model: Model
  usage: Usage
}

export interface LLMTool {
  description: string
  fn: (params: object) => Promise<string>
  name: string
  paramsSchema: z.AnyZodObject
}

export type Model = string

export type ModelTier = 'flash' | 'lite' | 'pro'

export interface TextContent {
  cacheControl?: unknown
  text: string
  type: 'text'
}

export interface Usage {
  cacheTextTokens?: number
  inputTextTokens?: number
  outputReasoningTokens?: number
  outputTextTokens?: number
  outputVideoTokens?: number
  totalTokens?: number
}

export interface VideoContent {
  fps?: number
  processing?: string
  type: 'video_url'
  videoUrl: string
}

export interface VideoGenerationOptions {
  [option: string]: unknown
  aspectRatio?: string
  audioUrls?: string[]
  durationSeconds?: number
  /** A length the clip must have (a loop's 4 s clip); refused when the model can't make it. */
  exactDurationSeconds?: number
  firstFrameUrl?: string
  generateAudio?: boolean
  imageUrls?: string[]
  lastFrameUrl?: string
  models: Model | Model[]
  negativePrompt?: string
  outputPath: string
  prompt: string
  referenceVideoUrl?: string
  resolution?: VideoResolution
  /** The role to use when `models` is empty, legacy or unknown. Defaults to the video.* role matching the frames. */
  role?: VideoRole
  task: string
  timeout?: number
}

export interface VideoGenerationWithMetaResult {
  height: number
  model: Model
  path: string
  processedDuration: number
  providerTaskId?: string
  usage: Usage
  width: number
}

export type VideoResolution = '4K' | '480p' | '720p' | '768p' | '1080p'

export function defineTool<T extends z.AnyZodObject>(input: {
  description: string
  fn: (params: z.infer<T>) => Promise<string>
  name: string
  paramsSchema: T
}): LLMTool {
  return { ...input, fn: async (params: object) => input.fn(params as z.infer<T>) }
}
