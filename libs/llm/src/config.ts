import { resolveRole } from './registry'
import type { ModelTier } from './types'

const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

export interface LLMLogger {
  debug(message: string): void
  error(message: string, stack?: string): void
  info(message: string): void
  warn(message: string, stack?: string): void
}

export interface LLMConfig {
  /** Resolves storage URIs (e.g. `store://`) the transport can't fetch itself. */
  resolveUri?: (uri: string) => Promise<string>
  logger: LLMLogger
}

const state: LLMConfig = {
  logger: {
    debug: () => undefined,
    error: (m) => console.error(m),
    info: (m) => console.info(m),
    warn: (m) => console.warn(m),
  },
}

export function configureLLM(overrides: Partial<LLMConfig>): void {
  Object.assign(state, overrides)
}

export function llmConfig(): LLMConfig {
  return state
}

export interface ChatEndpoint {
  apiKey: string
  baseUrl: string
  name: string
}

/** Which endpoint `chatEndpoint()` uses: Gemini's, the custom one, or null for the env rule. */
export type ChatEndpointPreference = 'endpoint' | 'gemini' | null

/** Read on every `chatEndpoint()` call: none until the API registers the AI chosen in Setup. */
let endpointPreference: () => ChatEndpointPreference = () => null

/**
 * Registers which endpoint calls without a transport use. The API passes a function, read on
 * every call, so a call pinned to Gemini and a change in Setup both apply at once.
 */
export function setChatEndpointPreference(
  pref: (() => ChatEndpointPreference) | ChatEndpointPreference,
): void {
  endpointPreference = typeof pref === 'function' ? pref : () => pref
}

/**
 * The OpenAI-compatible chat endpoint. With a preference, Gemini's endpoint (GEMINI_API_KEY) or
 * the custom one (LLM_BASE_URL + LLM_API_KEY: OpenRouter, OpenAI, Ollama, vLLM). Without one,
 * as before: LLM_BASE_URL when set, else Gemini when GEMINI_API_KEY is set. GEMINI_API_KEY is
 * only ever sent to Google's host, never to a custom endpoint.
 */
export function chatEndpoint(): ChatEndpoint {
  const baseUrl = process.env['LLM_BASE_URL']?.replace(/\/$/, '')
  const geminiKey = process.env['GEMINI_API_KEY']
  const preference = endpointPreference()
  if (preference === 'gemini') {
    if (!geminiKey) {
      throw new Error('Gemini is chosen for writing and planning, but GEMINI_API_KEY is not set')
    }
    return { apiKey: geminiKey, baseUrl: GEMINI_OPENAI_BASE_URL, name: 'gemini' }
  }
  if (preference === 'endpoint' && !baseUrl) {
    throw new Error(
      'Your own endpoint is chosen for writing and planning, but LLM_BASE_URL is not set',
    )
  }
  if (baseUrl) {
    const host = new URL(baseUrl).hostname
    const googleKey = host === new URL(GEMINI_OPENAI_BASE_URL).hostname ? geminiKey : undefined
    return { apiKey: process.env['LLM_API_KEY'] || googleKey || '', baseUrl, name: host }
  }
  if (geminiKey) return { apiKey: geminiKey, baseUrl: GEMINI_OPENAI_BASE_URL, name: 'gemini' }
  throw new Error('No chat model configured: set GEMINI_API_KEY, or LLM_BASE_URL and LLM_API_KEY')
}

/** Used only when the registry disables a chat role (`"chat.<tier>": null`). */
const DEFAULT_TIER_MODELS: Record<ModelTier, string> = {
  flash: 'gemini-3.5-flash',
  lite: 'gemini-3.1-flash-lite',
  pro: 'gemini-3.8-flash',
}

/**
 * The chat model id for a tier, from the registry's `chat.<tier>` role
 * (`LLM_MODEL_<TIER>` and `CHAT_<TIER>_MODEL` override it).
 */
export function tierModel(tier: ModelTier): string {
  return resolveRole(`chat.${tier}`)?.model ?? DEFAULT_TIER_MODELS[tier]
}

export function falKey(): string {
  const key = process.env['FAL_KEY']
  if (!key) throw new Error('FAL_KEY is not set: image, video and music generation need it')
  return key
}

export function geminiKey(): string {
  const key = process.env['GEMINI_API_KEY']
  if (!key)
    throw new Error('GEMINI_API_KEY is not set: Gemini pictures, clips, voices and music need it')
  return key
}
