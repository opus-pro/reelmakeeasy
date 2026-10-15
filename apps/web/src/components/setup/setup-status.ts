import type {
  GenerationProvider,
  LlmProvider,
  SetupKeys,
  SetupOption,
  SetupStatus,
} from '@shared/types/api/setup'

import { type AgentPickerRow, agentPickerRows } from '../agent/agent-harness'

/** The card's two answers while the user picks. */
export interface SetupChoices {
  generation: GenerationProvider | null
  llm: LlmProvider | null
}

/** One line of "Keys found": a mark for fal and Gemini, how ElevenLabs runs. */
export interface KeyRow {
  id: 'elevenlabs' | 'fal' | 'gemini'
  label: string
  tone: 'muted' | 'ok'
  value: string
}

/** What Save stores: only the answers the card asked for. */
export interface SavePlan {
  generation?: GenerationProvider
  llm?: LlmProvider
}

export const CHECK_FAILED =
  "Couldn't check the setup. Make sure ReelMakeEasy is running, then try again."
export const SAVE_FAILED = "Couldn't save. Make sure ReelMakeEasy is running, then try again."
export const NO_VIDEO_KEY =
  'Add FAL_KEY or GEMINI_API_KEY to .env, restart ReelMakeEasy, then Check again.'
export const NO_WRITER =
  'Nothing can write and plan yet: sign in to Codex or Claude Code, or add GEMINI_API_KEY to .env.'
/** The API answers Setup only for this computer (403 otherwise, e.g. through a proxy). */
export const NOT_THIS_COMPUTER =
  'Setup only works on the computer running ReelMakeEasy. On a server, set LLM_PROVIDER and GENERATION_PROVIDER in .env.'
export const RESTART_HINT =
  'Keys are read when ReelMakeEasy starts: after editing .env, restart it, then Check again.'

/** One line under each video maker on what it uses. */
export const GENERATION_BLURB: Record<GenerationProvider, string> = {
  fal: 'Uses your fal account: the picture, clip and music models set for fal, and ElevenLabs voices',
  google:
    'Uses your Gemini key: Nano Banana pictures, Omni Flash clips, Gemini voices and Lyria music',
}

/** The options that can be picked now. */
function usable<T extends string>(options: SetupOption<T>[]): SetupOption<T>[] {
  return options.filter((o) => o.available)
}

/** Whether `id` is an option that can be picked now. */
function isUsable<T extends string>(options: SetupOption<T>[], id: null | T): id is T {
  return options.some((o) => o.available && o.id === id)
}

/** fal and Gemini both usable, or a saved video maker that stopped working: the card asks who
 *  makes the videos. */
export function asksGeneration(status: SetupStatus): boolean {
  const count = usable(status.generation.options).length
  const broken = status.generation.provider !== null && status.generation.effective === null
  return count > 1 || (broken && count > 0)
}

/** How ElevenLabs runs: the user's key, through fal while fal makes the videos, else unused. */
function elevenLabsRow(keys: SetupKeys, generation: GenerationProvider | null): KeyRow {
  if (keys.elevenlabs) {
    return { id: 'elevenlabs', label: 'ElevenLabs', tone: 'ok', value: 'Your key' }
  }
  if (keys.fal && generation !== 'google') {
    return { id: 'elevenlabs', label: 'ElevenLabs', tone: 'ok', value: 'Through fal' }
  }
  return { id: 'elevenlabs', label: 'ElevenLabs', tone: 'muted', value: 'Not needed' }
}

/** A found-or-not line for a video key. */
function keyMark(id: 'fal' | 'gemini', label: string, found: boolean): KeyRow {
  return found ? { id, label, tone: 'ok', value: '✓' } : { id, label, tone: 'muted', value: '–' }
}

/** "Keys found", for the video maker currently picked on the card. */
export function keyRows(status: SetupStatus, generation: GenerationProvider | null): KeyRow[] {
  return [
    keyMark('fal', 'fal', status.keys.fal),
    keyMark('gemini', 'Gemini', status.keys.gemini),
    elevenLabsRow(status.keys, generation),
  ]
}

/** Codex and Claude Code as the Agent dialog shows them: ready, or why not. */
export function harnessRows(status: null | SetupStatus): AgentPickerRow[] {
  return agentPickerRows(status?.harnesses ?? null)
}

/** The answers the card starts from: the choices in effect, else the first usable option. */
export function initialChoices(status: SetupStatus): SetupChoices {
  return {
    generation: status.generation.effective ?? usable(status.generation.options)[0]?.id ?? null,
    llm: status.llm.effective ?? usable(status.llm.options)[0]?.id ?? null,
  }
}

/** Whether the home page shows the card: nothing to write or make videos, a saved choice that
 *  stopped working, or fal and Gemini both usable with no pick (saved or .env) yet. */
export function needsSetup(status: null | SetupStatus): boolean {
  if (status === null) return false
  if (status.llm.effective === null || status.generation.effective === null) return true
  return asksGeneration(status) && status.generation.provider === null
}

/** What Save sends: the writer when usable, and the video maker when the card asked. */
export function savePlan(status: SetupStatus, choices: SetupChoices): SavePlan {
  const plan: SavePlan = {}
  if (isUsable(status.llm.options, choices.llm)) plan.llm = choices.llm
  if (asksGeneration(status) && isUsable(status.generation.options, choices.generation)) {
    plan.generation = choices.generation
  }
  return plan
}

/** A saved choice that stopped working: the option the API lists for it. */
function brokenChoice<T extends string>(part: {
  effective: null | T
  options: SetupOption<T>[]
  provider: null | T
}): null | SetupOption<T> {
  if (part.provider === null || part.effective !== null) return null
  const provider = part.provider
  return (
    part.options.find((o) => o.id === provider) ?? {
      available: false,
      id: provider,
      label: provider,
    }
  )
}

/** " (reason)" when the API gave one. */
function because(option: SetupOption<string>): string {
  return option.reason ? ` (${option.reason})` : ''
}

/** Saved choices that stopped working, in words. They are reported, never swapped. */
export function staleChoiceMessages(status: SetupStatus): string[] {
  const messages: string[] = []
  const llm = brokenChoice(status.llm)
  if (llm) {
    messages.push(
      `${llm.label} was picked to write and plan, but it isn't available now${because(llm)}. Pick another below, or fix it and Check again.`,
    )
  }
  const generation = brokenChoice(status.generation)
  if (generation) {
    messages.push(
      `${generation.label} was picked to make the videos, but it isn't available now${because(generation)}. Pick another below, or fix it and Check again.`,
    )
  }
  return messages
}

/** Neither video key is set. */
export function videoKeyMissing(status: SetupStatus): boolean {
  return !status.keys.fal && !status.keys.gemini
}

/** No AI can write and plan. */
export function writerMissing(status: SetupStatus): boolean {
  return usable(status.llm.options).length === 0
}
