import { jsonrepair } from 'jsonrepair'
import { z } from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'

import { chatEndpoint, llmConfig, tierModel } from './config'
import { toChatParts } from './content'
import type {
  ChatTransport,
  ChatTransportRequest,
  ChatTransportResolver,
  CompletionOptions,
  CompletionWithMetaResult,
  Model,
  ModelTier,
  Usage,
} from './types'

const TIERS = new Set<string>(['flash', 'lite', 'pro'])
const DEFAULT_TIMEOUT_MS = 360_000
const ATTEMPTS_PER_MODEL = 2

let currentResolver: ChatTransportResolver | null = null

/** Registers a resolver that may return a transport for the current call (e.g. Codex), or clears it with `null`. */
export function setChatTransportResolver(resolver: ChatTransportResolver | null): void {
  currentResolver = resolver
}

function resolveTransport(): ChatTransport | null {
  try {
    return currentResolver?.() ?? null
  } catch (err) {
    throw new Error(`chat transport resolver failed: ${(err as Error).message}`)
  }
}

function tierFor(model: string): ModelTier {
  const m = model.toLowerCase()
  if (/lite|nano|mini|haiku|small/.test(m)) return 'lite'
  if (/pro|opus|sonnet|gpt-5(?!.*mini)|large|o3/.test(m)) return 'pro'
  return 'flash'
}

/**
 * Maps requested models onto the configured endpoint. Tier names use the
 * configured tier models; concrete ids pass through when they belong to the
 * endpoint (Gemini ids on the Gemini endpoint, or anything with
 * LLM_PASSTHROUGH=1), otherwise they fall back to the matching tier.
 */
export function resolveChatModels(requested: CompletionOptions<z.ZodTypeAny>['models']): Model[] {
  const endpoint = chatEndpoint()
  const passthrough =
    process.env['LLM_PASSTHROUGH'] === '1'
      ? () => true
      : (m: string) => endpoint.name === 'gemini' && m.startsWith('gemini-')
  const list = Array.isArray(requested) ? requested : [requested]
  const out: Model[] = []
  for (const entry of list) {
    const model = TIERS.has(entry) ? tierModel(entry as ModelTier) : passthrough(entry) ? entry : tierModel(tierFor(entry))
    if (!out.includes(model)) out.push(model)
  }
  return out.length ? out : [tierModel('flash')]
}

/**
 * A transport (e.g. Codex) doesn't live behind the env-selected endpoint, so none of
 * `resolveChatModels`' tier/passthrough mapping applies and `chatEndpoint()` must not be
 * called. It also ignores the model, so the pipeline's fallback list would only repeat a
 * failing call (and multiply its timeouts): it gets exactly one entry, its own name. A
 * retryable failure is still tried `ATTEMPTS_PER_MODEL` times.
 */
function modelsForTransport(transportName: string): Model[] {
  return [transportName]
}

interface ChatMessage {
  content: unknown
  role: 'assistant' | 'system' | 'tool' | 'user'
  tool_call_id?: string
  tool_calls?: ToolCall[]
}

interface ToolCall {
  function: { arguments: string; name: string }
  id: string
  type: 'function'
}

interface ChatResponse {
  choices?: { finish_reason?: string; message?: { content?: null | string; tool_calls?: ToolCall[] } }[]
  id?: string
  model?: string
  usage?: {
    completion_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
    prompt_tokens?: number
    prompt_tokens_details?: { cached_tokens?: number }
    total_tokens?: number
  }
}

class RetryableError extends Error {}

async function postChat(body: Record<string, unknown>, timeoutMs: number): Promise<ChatResponse> {
  const { apiKey, baseUrl } = chatEndpoint()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      method: 'POST',
      signal: controller.signal,
    })
    const text = await res.text()
    if (!res.ok) {
      const message = `chat completion failed (${res.status}): ${text.slice(0, 500)}`
      throw res.status === 429 || res.status >= 500 ? new RetryableError(message) : new Error(message)
    }
    return JSON.parse(text) as ChatResponse
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw new RetryableError(`chat completion timed out after ${timeoutMs}ms`)
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Sends one chat request through the resolved transport, or `postChat` when there isn't one. */
async function sendChatRequest(
  transport: ChatTransport | null,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<ChatResponse> {
  if (!transport) return postChat(body, timeoutMs)
  return (await transport.send(body as ChatTransportRequest, timeoutMs)) as unknown as ChatResponse
}

function toUsage(usage: ChatResponse['usage']): Usage {
  return {
    cacheTextTokens: usage?.prompt_tokens_details?.cached_tokens,
    inputTextTokens: usage?.prompt_tokens,
    outputReasoningTokens: usage?.completion_tokens_details?.reasoning_tokens,
    outputTextTokens: usage?.completion_tokens,
    totalTokens: usage?.total_tokens,
  }
}

function addUsage(a: Usage, b: Usage): Usage {
  const sum = (x?: number, y?: number) => (x === undefined && y === undefined ? undefined : (x ?? 0) + (y ?? 0))
  return {
    cacheTextTokens: sum(a.cacheTextTokens, b.cacheTextTokens),
    inputTextTokens: sum(a.inputTextTokens, b.inputTextTokens),
    outputReasoningTokens: sum(a.outputReasoningTokens, b.outputReasoningTokens),
    outputTextTokens: sum(a.outputTextTokens, b.outputTextTokens),
    totalTokens: sum(a.totalTokens, b.totalTokens),
  }
}

function isStringSchema(schema: z.ZodTypeAny): boolean {
  return schema instanceof z.ZodString
}

function parseStructured<T extends z.ZodTypeAny>(raw: string, schema: T): z.infer<T> {
  if (isStringSchema(schema)) return schema.parse(raw)
  const unfenced = raw.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()
  let value: unknown
  try {
    value = JSON.parse(unfenced)
  } catch {
    value = JSON.parse(jsonrepair(unfenced))
  }
  return schema.parse(value)
}

/**
 * The openApi3 target writes `.positive()` / `.gt()` / `.lt()` as OpenAPI 3.0 boolean
 * bounds (`exclusiveMinimum: true` next to `minimum`). Gemini rejects that and wants the
 * JSON Schema number form, so rewrite them in place: `{ exclusiveMinimum: 0 }`.
 */
function toNumericExclusiveBounds(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) toNumericExclusiveBounds(item)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  for (const [exclusive, bound] of [
    ['exclusiveMinimum', 'minimum'],
    ['exclusiveMaximum', 'maximum'],
  ] as const) {
    if (typeof obj[exclusive] !== 'boolean') continue
    if (obj[exclusive] && typeof obj[bound] === 'number') {
      obj[exclusive] = obj[bound]
      delete obj[bound]
    } else {
      delete obj[exclusive]
    }
  }
  for (const value of Object.values(obj)) toNumericExclusiveBounds(value)
}

function jsonSchemaFor(schema: z.ZodTypeAny): Record<string, unknown> {
  const json = zodToJsonSchema(schema, { $refStrategy: 'none', target: 'openApi3' }) as Record<string, unknown>
  delete json['$schema']
  toNumericExclusiveBounds(json)
  return json
}

async function completeOnce<T extends z.ZodTypeAny>(
  options: CompletionOptions<T>,
  model: Model,
  transport: ChatTransport | null,
): Promise<CompletionWithMetaResult<T>> {
  const structured = !isStringSchema(options.responseFormat)
  const schema = structured ? jsonSchemaFor(options.responseFormat) : undefined
  const tools = (options.tools ?? []).filter((t) => !options.allowedTools || options.allowedTools.includes(t.name))

  const system = [
    options.systemPrompt,
    structured && tools.length
      ? `When you give your final answer, reply with only JSON matching this schema:\n${JSON.stringify(schema)}`
      : undefined,
  ]
    .filter(Boolean)
    .join('\n\n')
  const userParts = [{ text: options.prompt, type: 'text' as const }, ...(await toChatParts(options.contents))]
  const messages: ChatMessage[] = [
    ...(system ? [{ content: system, role: 'system' as const }] : []),
    { content: userParts, role: 'user' },
  ]

  const base: Record<string, unknown> = {
    model,
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.topP === undefined ? {} : { top_p: options.topP }),
    ...(options.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
    ...(options.reasoningEffort ? { reasoning_effort: options.reasoningEffort } : {}),
  }
  if (tools.length) {
    base['tools'] = tools.map((t) => ({
      function: { description: t.description, name: t.name, parameters: jsonSchemaFor(t.paramsSchema) },
      type: 'function',
    }))
  } else if (structured) {
    base['response_format'] = {
      json_schema: { name: 'response', schema, strict: false },
      type: 'json_schema',
    }
  }

  const timeoutMs = options.timeout ?? DEFAULT_TIMEOUT_MS
  const maxSteps = options.maxToolUseSteps ?? 10
  let usage: Usage = {}
  for (let step = 0; ; step++) {
    const response = await sendChatRequest(transport, { ...base, messages }, timeoutMs)
    usage = addUsage(usage, toUsage(response.usage))
    const message = response.choices?.[0]?.message
    const calls = message?.tool_calls ?? []
    if (calls.length && step < maxSteps) {
      messages.push({ content: message?.content ?? null, role: 'assistant', tool_calls: calls })
      for (const call of calls) {
        const tool = tools.find((t) => t.name === call.function.name)
        let output: string
        try {
          if (!tool) throw new Error(`Unknown tool ${call.function.name}`)
          output = await tool.fn(tool.paramsSchema.parse(JSON.parse(call.function.arguments || '{}')))
        } catch (err) {
          output = `Error: ${(err as Error).message}`
        }
        messages.push({ content: output, role: 'tool', tool_call_id: call.id })
      }
      continue
    }
    const raw = message?.content ?? ''
    if (!raw) throw new RetryableError('chat completion returned no content')
    const result = parseStructured(raw, options.responseFormat)
    if (options.responseValidator && !options.responseValidator(result)) {
      throw new RetryableError('response rejected by validator')
    }
    const provider = transport?.name ?? chatEndpoint().name
    return { model, provider, providerModel: response.model ?? model, responseId: response.id, result, usage }
  }
}

export async function completionWithMeta<T extends z.ZodTypeAny>(
  options: CompletionOptions<T>,
): Promise<CompletionWithMetaResult<T>> {
  const transport = resolveTransport()
  const models = transport ? modelsForTransport(transport.name) : resolveChatModels(options.models)
  const { logger } = llmConfig()
  let lastError: unknown
  for (const model of models) {
    for (let attempt = 1; attempt <= ATTEMPTS_PER_MODEL; attempt++) {
      try {
        return await completeOnce(options, model, transport)
      } catch (err) {
        lastError = err
        const retryable = err instanceof RetryableError || err instanceof z.ZodError || err instanceof SyntaxError
        logger.warn(`[llm] ${options.task} on ${model} attempt ${attempt} failed: ${(err as Error).message}`)
        if (!retryable) break
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError))
}

export async function completion<T extends z.ZodTypeAny>(options: CompletionOptions<T>): Promise<z.infer<T>> {
  return (await completionWithMeta(options)).result
}
