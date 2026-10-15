import { hasElevenLabsKey } from '@reelmakeeasy/common/elevenlabs/key'
import { LLM_NOT_SET_UP_MESSAGE } from '@reelmakeeasy/llm'
import type { GenerationProvider as LlmGenerationProvider } from '@reelmakeeasy/llm/registry'
import {
  type AgentHarnessName,
  type AgentStatusResponse,
  HARNESS_UNAVAILABLE_REASON,
  type HarnessStatus,
} from '@shared/types/api/agent'
import type {
  DictationSetting,
  GenerationProvider,
  LlmProvider,
  SetupKeys,
  SetupOption,
  SetupStatus,
} from '@shared/types/api/setup'

/** The choices saved in settings.json, over the `.env` defaults. */
export interface SetupStored {
  /** Voice typing's engine (`DICTATION` in .env is the default). */
  dictation?: DictationSetting
  generationProvider?: GenerationProvider
  llmProvider?: LlmProvider
}

/** Every voice typing choice: the engines in the order `auto` tries them, then auto and off. */
export const DICTATION_SETTINGS: readonly DictationSetting[] = [
  'auto',
  'gemini',
  'local',
  'fal',
  'browser',
  'off',
]

export const isDictationSetting = (value: unknown): value is DictationSetting =>
  DICTATION_SETTINGS.includes(value as DictationSetting)

/** Every LLM provider id, in the order Setup lists them. */
export const LLM_PROVIDERS: readonly LlmProvider[] = ['claude', 'codex', 'gemini', 'endpoint']

/** Every generation provider id, in the order an unset choice falls back through. */
export const GENERATION_PROVIDERS: readonly GenerationProvider[] = ['fal', 'google']

/** Fails the type-check unless `T` is `true`. */
type Assert<T extends true> = T
/** True when A and B are the same type. */
type Equals<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false

/** The generation provider union is written out twice: `GenerationProvider` (shared types) and
 *  libs/llm's own (libs/llm doesn't import shared types). The API type-check fails here when
 *  they drift. */
export type GenerationProviderUnionsMatch = Assert<
  Equals<GenerationProvider, LlmGenerationProvider>
>

/** Each AI's name, as Setup shows it. */
const LLM_LABEL: Record<LlmProvider, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  endpoint: 'Your own endpoint',
  gemini: 'Gemini',
}

/** Each generation provider's name in Setup, and the key it needs. */
const GENERATION_SETUP: Record<GenerationProvider, { env: string; label: string }> = {
  fal: { env: 'FAL_KEY', label: 'fal' },
  google: { env: 'GEMINI_API_KEY', label: 'Gemini' },
}

/** The whole status, from the agents' probe, the keys and the stored choices. */
export function buildSetupStatus(input: {
  harnesses: AgentStatusResponse
  keys: SetupKeys
  stored: SetupStored
}): SetupStatus {
  const { harnesses, keys, stored } = input
  const llm = llmOptions({ harnesses, keys })
  const generation = generationOptions(keys)
  return {
    generation: {
      effective: effectiveGeneration(stored.generationProvider, generation),
      options: generation,
      provider: stored.generationProvider ?? null,
    },
    harnesses,
    keys,
    llm: {
      effective: effectiveLlm(stored.llmProvider, llm, harnesses.defaultHarness),
      options: llm,
      provider: stored.llmProvider ?? null,
    },
  }
}

/** The generation provider in use: the stored one when it is available (null when it isn't:
 *  reported, never swapped); with nothing stored, the first available one. */
export function effectiveGeneration(
  stored: GenerationProvider | undefined,
  options: SetupOption<GenerationProvider>[],
): GenerationProvider | null {
  const ready = (id: GenerationProvider): boolean => options.some((o) => o.id === id && o.available)
  if (stored) return ready(stored) ? stored : null
  return GENERATION_PROVIDERS.find(ready) ?? null
}

/**
 * The AI LLM calls run on: the stored one when it is ready (null when it isn't: reported, never
 * swapped). With nothing stored: Codex or Claude Code (`tieBreak`, from AGENT_HARNESS, picks
 * when both are ready), else Gemini, else the custom endpoint, else null.
 */
export function effectiveLlm(
  stored: LlmProvider | undefined,
  options: SetupOption<LlmProvider>[],
  tieBreak: AgentHarnessName,
): LlmProvider | null {
  const ready = (id: LlmProvider): boolean => options.some((o) => o.id === id && o.available)
  if (stored) return ready(stored) ? stored : null
  const otherAgent: AgentHarnessName = tieBreak === 'claude' ? 'codex' : 'claude'
  const order: LlmProvider[] = [tieBreak, otherAgent, 'gemini', 'endpoint']
  return order.find(ready) ?? null
}

/** One option per generation provider: fal with FAL_KEY, Gemini (google) with GEMINI_API_KEY. */
export function generationOptions(keys: SetupKeys): SetupOption<GenerationProvider>[] {
  const ready: Record<GenerationProvider, boolean> = { fal: keys.fal, google: keys.gemini }
  return GENERATION_PROVIDERS.map((id) => {
    const { env, label } = GENERATION_SETUP[id]
    return keyOption(id, label, ready[id], `Add ${env} to .env, then restart`)
  })
}

/**
 * The provider libs/llm runs generation on: the chosen one (saved or `.env`) even when it
 * can't run (calls then fail with why), else the first available, else null (none).
 */
export function generationTarget(generation: SetupStatus['generation']): GenerationProvider | null {
  return generation.provider ?? generation.effective
}

/** Why generation can't run, or null when it can: the chosen provider's missing key, or no key. */
export function generationUnavailableReason(generation: SetupStatus['generation']): null | string {
  if (generation.effective) return null
  if (!generation.provider) return 'Add FAL_KEY or GEMINI_API_KEY to .env, then restart'
  const { env, label } = GENERATION_SETUP[generation.provider]
  const other = generation.options.find((o) => o.id !== generation.provider && o.available)
  const instead = other ? `, or pick ${other.label}` : ''
  return `${label} is chosen in Setup but ${env} is missing: add it to .env and restart${instead}`
}

/** True for a known generation provider id. */
export function isGenerationProvider(value: unknown): value is GenerationProvider {
  return typeof value === 'string' && (GENERATION_PROVIDERS as readonly string[]).includes(value)
}

/** True for a known LLM provider id. */
export function isLlmProvider(value: unknown): value is LlmProvider {
  return typeof value === 'string' && (LLM_PROVIDERS as readonly string[]).includes(value)
}

/** What an LLM call fails with when no AI is in use: the chosen AI's reason when it isn't
 *  ready, else that nothing is set up. */
export function llmNotSetUpMessage(llm: SetupStatus['llm']): string {
  const chosen = llm.options.find((o) => o.id === llm.provider)
  if (chosen && !chosen.available) {
    return `${chosen.label} can't write and plan right now (${chosen.reason ?? 'not ready'}): open Setup`
  }
  return LLM_NOT_SET_UP_MESSAGE
}

/** One option per AI, available or not (with why), in Setup's order. */
export function llmOptions(input: {
  harnesses: AgentStatusResponse
  keys: SetupKeys
}): SetupOption<LlmProvider>[] {
  const { harnesses, keys } = input
  return [
    harnessOption('claude', harnesses.claude),
    harnessOption('codex', harnesses.codex),
    keyOption('gemini', LLM_LABEL.gemini, keys.gemini, 'Add GEMINI_API_KEY to .env, then restart'),
    keyOption(
      'endpoint',
      LLM_LABEL.endpoint,
      keys.endpoint,
      'Set LLM_BASE_URL in .env, then restart',
    ),
  ]
}

/** `GENERATION_PROVIDER` from .env: fal, google, or gemini (Setup's name for google). */
export function parseGenerationProvider(value: string | undefined): GenerationProvider | undefined {
  const name = value?.trim().toLowerCase()
  const id = name === 'gemini' ? 'google' : name
  return isGenerationProvider(id) ? id : undefined
}

/** Which keys `.env` sets: presence only, never the values. */
export function readKeys(env: NodeJS.ProcessEnv): SetupKeys {
  const has = (name: string): boolean => Boolean(env[name]?.trim())
  return {
    elevenlabs: hasElevenLabsKey(env),
    endpoint: has('LLM_BASE_URL'),
    fal: has('FAL_KEY'),
    gemini: has('GEMINI_API_KEY'),
  }
}

/** An agent's option: available when installed and signed in, else why not (the Agent
 *  dialog's wording, shared with the web app). The shell sandbox only matters to agent
 *  chats: a planning call runs no tools, so a signed-in agent without it can still write. */
function harnessOption(id: AgentHarnessName, status: HarnessStatus): SetupOption<LlmProvider> {
  if (status.available || (status.loggedIn && status.reason === 'no-sandbox'))
    return { available: true, id, label: LLM_LABEL[id] }
  const reason = HARNESS_UNAVAILABLE_REASON[id][status.reason ?? 'probe-failed']
  return { available: false, id, label: LLM_LABEL[id], reason }
}

/** An option that needs a setting in `.env`. */
function keyOption<T extends string>(
  id: T,
  label: string,
  ready: boolean,
  reason: string,
): SetupOption<T> {
  return ready ? { available: true, id, label } : { available: false, id, label, reason }
}
