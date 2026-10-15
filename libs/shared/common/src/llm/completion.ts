import { LLM } from '@reelmakeeasy/llm'
import { modelRegistry } from '@reelmakeeasy/llm/registry'
import { z } from 'zod'
import zodToJsonSchema from 'zod-to-json-schema'

import { getLogger } from '../logger'
import { isPresetUri } from '../storage/address'
import { filePath } from '../storage/file-store'
import { presetFilePath } from '../storage/presets'

import { ClientCompletionOptions, type EnableSearch } from './clients/client'
import { normalizeContentsForDevCache, tryRead, tryWrite } from './llm-cache'
import { type Model, type ModelTier, normalizeCompletionModelId } from './models'

const logger = getLogger('completion')

// The SDK hands the originating error's stack as a second argument.
// pino drops a trailing argument unless the
// message carries a format placeholder, and the SDK's messages are already
// interpolated, so the stack has to become a field to survive into the logs.
const llmLogger = {
  debug: (message: string): void => logger.debug(message),
  error: (message: string, stack?: string): void =>
    stack ? logger.error({ stack }, message) : logger.error(message),
  info: (message: string): void => logger.info(message),
  warn: (message: string, stack?: string): void =>
    stack ? logger.warn({ stack }, message) : logger.warn(message),
}
const DEFAULT_BIZ = 'E2E-Video'

/**
 * The service-level `biz` tag configured at `initLLM` (e.g. 'Story-Mode',
 * 'Api'), kept here so provider calls that meter cost directly can tag their
 * cost with the same `biz`. Falls back to the default before `initLLM` runs.
 */
let configuredBiz = DEFAULT_BIZ

/** At least two fallback models -- mirrors the SDK's `parseModels` invariant. */
export type ModelChain = [Model, Model, ...Model[]]

/**
 * Escapes the two-model minimum, mirroring the SDK's own skip conditions in
 * `parseModels`: `ignoreFallbackModel`, `enableSearch`, and chain mode
 * (`enableResponseChain` or `previousResponseId`). Video requests are the
 * SDK's fourth skip condition but aren't expressible here -- `contents`
 * entries aren't typed as video at this layer.
 */
export type CompletionOptions<T extends z.ZodTypeAny> = CompletionOptionsBase<T> &
  (
    | (SingleModelEscape & { models: [Model, ...Model[]] | ModelTier })
    | { models: ModelChain | ModelTier }
  )

type CompletionOptionsBase<T extends z.ZodTypeAny> = Omit<
  ClientCompletionOptions<T>,
  'model' | 'models'
> & {
  /** Dev-cache: override `contents` in cache key (e.g. content hashes instead of URIs). */
  _devCacheContents?: unknown[]
  extractGroundingUrls?: boolean
  responseValidator?: (response: z.infer<T>) => boolean
}

type SingleModelEscape =
  | { enableResponseChain: true }
  // `false` is excluded: the SDK's skip condition is truthiness, so
  // `enableSearch: false` would compile yet still throw at runtime
  | { enableSearch: Exclude<EnableSearch, false> }
  | { ignoreFallbackModel: true }
  | { previousResponseId: string }

export function getConfiguredBiz(): string {
  return configuredBiz
}

/**
 * Locally-declared mirror of the SDK's `CompletionWithMetaResult`. The
 * SDK exports the interface but under a `bundler` module-resolution
 * tsconfig (Next.js) the re-export is unreachable -- the
 * underlying alias chain crosses a `type`-only declaration boundary
 * that `bundler` resolution refuses to traverse. We declare the shape
 * locally to keep this wrapper type-safe across both `node` and
 * `bundler` resolution. `model` / `usage` from the SDK type are
 * omitted -- callers in this codebase never read them. Structural
 * typing covers the extra fields the SDK returns at runtime.
 */
export interface CompletionWithMetaResult<T extends z.ZodTypeAny> {
  responseId?: string
  result: z.infer<T>
}

export async function completion<T extends z.ZodTypeAny>(
  options: CompletionOptions<T>,
): Promise<z.infer<T>> {
  const normalizedOptions = normalizeCompletionOptions(options)
  // Defensive: a chain-mode call accidentally routed through this
  // non-chain wrapper would hit the prompt-hash cache and either
  // (1) skip provider-side `store: true` on cache hit -- the next turn
  // fails because its previousResponseId is unknown to OpenAI, or
  // (2) splice unrelated chains together when two chains happen to hit
  // the same cache key. Route to `completionWithMeta` so the chain
  // path handles cache bypass + meta envelope correctly. Caller loses
  // the `responseId` field here; they should be using
  // `completionWithMeta` directly for chain mode anyway.
  if (isChainModeRequested(normalizedOptions)) {
    const out = await completionWithMeta(normalizedOptions)
    return out.result
  }
  // completionWithMeta has its own cache; only need to cover the SDK path
  const params = extractCompletionCacheParams(normalizedOptions)
  const cached = await tryRead<z.infer<T>>(params)
  if (cached) {
    return cached
  }
  const result = await LLM.completion(normalizedOptions)
  tryWrite(params, result)
  return result
}

/**
 * Chain-aware completion that returns the SDK's full `CompletionWithMetaResult`
 * -- including the `responseId` callers need to thread back as
 * `previousResponseId` on subsequent turns.
 *
 * Cache policy: when the caller opts into Responses API chain mode (either
 * field of `{ enableResponseChain, previousResponseId }` is set), this
 * wrapper **bypasses the local LLM cache entirely**. Three reasons:
 *
 *   1. Chain mode forces `store: true` provider-side. A cache hit would skip
 *      the SDK call, so the provider never stores the response -- the next
 *      turn's `previousResponseId` 4xx's (id unknown to provider).
 *   2. The local cache key is a prompt-hash; chain id is the real cache
 *      key. A hit for the same prompt across two unrelated chains would
 *      return a stale `responseId`, splicing the chains together.
 *   3. Reusing a cached `responseId` would write a non-current id back into
 *      `cached_artifacts.planner_response_id`, breaking subsequent chain
 *      continuations.
 *
 * Non-chain calls keep the existing cache behaviour and are wrapped to
 * return the same `CompletionWithMetaResult` shape so callers can treat
 * `responseId` as optional uniformly.
 */
export async function completionWithMeta<T extends z.ZodTypeAny>(
  options: CompletionOptions<T>,
): Promise<CompletionWithMetaResult<T>> {
  const normalizedOptions = normalizeCompletionOptions(options)
  if (isChainModeRequested(normalizedOptions)) {
    return await LLM.completionWithMeta(normalizedOptions)
  }
  // Non-chain: reuse the cached path for parity with `completion()` and
  // wrap the cache hit in the `{ result }` envelope. `responseId` stays
  // undefined (matches the SDK contract for non-chain calls).
  const params = extractCompletionCacheParams(normalizedOptions)
  const cached = await tryRead<z.infer<T>>(params)
  if (cached) {
    return { result: cached }
  }
  const out = await LLM.completionWithMeta(normalizedOptions)
  tryWrite(params, out.result)
  return out
}

export function initLLM(opts: { biz?: string; serviceName: string }) {
  configuredBiz = opts.biz || DEFAULT_BIZ
  // Stored and preset files are already on this disk: the LLM reads them in place.
  LLM.init({
    logger: llmLogger,
    resolveUri: async (uri) => (isPresetUri(uri) ? presetFilePath(uri) : filePath(uri)),
  })
  // Load reelmakeeasy.models.json now so a bad config fails at boot, not mid-run.
  modelRegistry()
  logger.info(`[llm] initialized for ${opts.serviceName}`)
}

function isChainModeRequested<T extends z.ZodTypeAny>(options: CompletionOptions<T>): boolean {
  return options.enableResponseChain === true || typeof options.previousResponseId === 'string'
}

function normalizeCompletionOptions<T extends z.ZodTypeAny>(
  options: CompletionOptions<T>,
): CompletionOptions<T> {
  if (!Array.isArray(options.models)) {
    return options
  }
  const models = options.models.map((model) =>
    normalizeCompletionModelId(model),
  ) as typeof options.models
  return {
    ...options,
    models,
  } as CompletionOptions<T>
}

// --- Dev cache helpers ---

function extractCompletionCacheParams<T extends z.ZodTypeAny>(
  options: CompletionOptions<T>,
  resolvedModels?: Model[],
): Record<string, unknown> {
  return {
    contents: options._devCacheContents ?? normalizeContentsForDevCache(options.contents),
    enableSearch: options.enableSearch,
    maxTokens: options.maxTokens,
    models: resolvedModels ?? options.models,
    prompt: options.prompt,
    reasoningEffort: options.reasoningEffort,
    responseFormat: safeZodToJson(options.responseFormat),
    responseMimeType: options.responseMimeType,
    seed: options.seed,
    systemPrompt: options.systemPrompt,
    task: options.task,
    temperature: options.temperature,
    tools: options.tools?.map((t) => ({
      description: t.description,
      name: t.name,
      paramsSchema: safeZodToJson(t.paramsSchema),
    })),
    topP: options.topP,
  }
}

function safeZodToJson(schema: undefined | z.ZodTypeAny): unknown {
  if (!schema) {
    return undefined
  }
  try {
    return zodToJsonSchema(schema)
  } catch {
    return schema.description
  }
}
