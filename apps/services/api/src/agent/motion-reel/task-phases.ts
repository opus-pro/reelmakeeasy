import type { AgentMotionTask } from '@shared/types/api/agent'

import type { MotionToolCall } from './motion-tasks'

/** Pieces the Tasks panel's phases share (a Motion Reel's and a Claude Animation's). */

/** At most this many detail lines per row. */
export const MAX_DETAILS = 20

/** A row of the Tasks panel without its id and label. */
export type Phase = Omit<AgentMotionTask, 'id' | 'label'>

/** A tool's calls that ran (one refused because the scenes don't type-check is Build's). */
export function callsOf(calls: MotionToolCall[], tool: string): MotionToolCall[] {
  return toolCalls(calls).filter((c) => c.tool === tool)
}

/** A failed answer's lines after its first, for the row's details. */
export function detailLines(text: string | undefined): string[] {
  return (text ?? '')
    .split('\n')
    .slice(1)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, MAX_DETAILS)
    .map((l) => (l.length > 200 ? `${l.slice(0, 199)}…` : l))
}

/** A failed call as a row: its reason on one line (a first line that ends in ":" takes the next
 *  one too, so "The render failed:" says why), the rest as details. */
export function failedPhase(text: string | undefined): Phase {
  const details = detailLines(text)
  const head = firstLine(text)
  const result = head.endsWith(':') && details[0] ? firstLine(`${head} ${details[0]}`) : head
  return { ...(details.length ? { details } : {}), result, state: 'failed' }
}

/** The first line of a tool's answer, short. */
export function firstLine(text: string | undefined): string {
  const line = (text ?? '').split('\n')[0]?.trim() ?? ''
  return line.length > 140 ? `${line.slice(0, 139)}…` : line
}

/** The calls that ran: one refused because the scenes don't type-check is not the tool's. */
export function toolCalls(calls: MotionToolCall[]): MotionToolCall[] {
  return calls.filter((c) => c.refused === undefined)
}
