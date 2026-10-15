import type { AgentHarnessName } from '@shared/types/api/agent'
import type { GenerationProvider, SetupStatus } from '@shared/types/api/setup'

import { agentPickerRows } from '../agent/agent-harness'

/** Set once "Make your first video?" is answered in this browser (Start, Not now, or closed). */
export const FIRST_VIDEO_ANSWERED_KEY = 'reelmakeeasy.first-video.answered'

/** About what a 30-second video costs on each video service. The one place for these numbers. */
export const VIDEO_COST: Record<GenerationProvider, string> = { fal: '$0.70', google: '$3' }

const SERVICE_NAME: Record<GenerationProvider, string> = { fal: 'fal', google: 'Gemini' }

/** The idea "Try an example" puts in the home box when no agent can run Easy. */
export const EXAMPLE_IDEA =
  'Did you know honey never goes bad? Make a 30-second video on why, and what it means for the jar in your kitchen.'

/** What the prompt's rule looks at. */
export interface FirstVideoInputs {
  /** Answered in this browser already. */
  answered: boolean
  /** The Get set up card is on screen. */
  cardShowing: boolean
  /** The user has a project; undefined while that is being checked, or when the check failed. */
  hasProjects: boolean | undefined
  status: null | SetupStatus
}

/** The cost line under the dialog's text, for the video service in effect. */
export function costLine(generation: GenerationProvider): string {
  return `A 30-second video costs about ${VIDEO_COST[generation]} on ${SERVICE_NAME[generation]}.`
}

/** Where "Go" opens the Easy chat: the agent picked to write when it is Codex or Claude
 *  Code, else the first ready one (Codex first). Null when neither is ready: Easy needs one. */
export function easyHarness(status: SetupStatus): AgentHarnessName | null {
  const ready = agentPickerRows(status.harnesses)
    .filter((row) => row.state === 'ready')
    .map((row) => row.harness)
  const writer = status.llm.effective
  if ((writer === 'codex' || writer === 'claude') && ready.includes(writer)) return writer
  return ready[0] ?? null
}

/** Whether "Make your first video?" was answered in this browser (not, when storage is blocked). */
export function firstVideoAnswered(): boolean {
  try {
    return localStorage.getItem(FIRST_VIDEO_ANSWERED_KEY) === '1'
  } catch {
    return false
  }
}

export function rememberFirstVideoAnswered(): void {
  try {
    localStorage.setItem(FIRST_VIDEO_ANSWERED_KEY, '1')
  } catch {
    // Storage blocked: the prompt is asked again on the next visit.
  }
}

/** An AI that writes and a video service are both in effect. */
export function setupComplete(status: null | SetupStatus): status is SetupStatus {
  return status !== null && status.llm.effective !== null && status.generation.effective !== null
}

/** Whether the home page asks "Make your first video?": setup is complete, the user has no
 *  project yet, it wasn't answered in this browser, and the Get set up card isn't showing. */
export function shouldAskFirstVideo({
  answered,
  cardShowing,
  hasProjects,
  status,
}: FirstVideoInputs): boolean {
  return setupComplete(status) && !cardShowing && !answered && hasProjects === false
}
