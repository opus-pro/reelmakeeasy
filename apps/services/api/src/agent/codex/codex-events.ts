import type { AgentPlanStep, AgentUiEvent } from '@shared/types/api/agent'

import { toolSummary } from '../tools/agent-tools'

interface Notification {
  method: string
  params?: Record<string, unknown>
}

const TURN_STATUS: Record<string, 'completed' | 'failed' | 'interrupted'> = {
  completed: 'completed',
  failed: 'failed',
  interrupted: 'interrupted',
}

const PLAN_STEP_STATUSES = new Set(['completed', 'inProgress', 'pending'])

const MAX_COMMAND_CHARS = 300

/** Codex commands can be arbitrarily long; keep the chat readable. */
function shorten(s: string): string {
  return s.length > MAX_COMMAND_CHARS ? s.slice(0, MAX_COMMAND_CHARS - 1) + '…' : s
}

/** App-server notification -> browser event, or null to drop it. */
export function mapCodexNotification(msg: Notification): AgentUiEvent | null {
  const p = (msg.params ?? {}) as Record<string, unknown>
  switch (msg.method) {
    case 'item/agentMessage/delta': {
      return { itemId: String(p.itemId), text: String(p.delta ?? ''), type: 'text_delta' }
    }
    case 'item/completed':
    case 'item/started': {
      return mapItem(msg.method === 'item/started', (p.item ?? {}) as Record<string, unknown>)
    }
    case 'item/reasoning/summaryPartAdded': {
      const summaryIndex = Number(p.summaryIndex ?? 0)
      return summaryIndex > 0
        ? { itemId: String(p.itemId), text: '\n\n', type: 'thinking_delta' }
        : null
    }
    case 'item/reasoning/summaryTextDelta': {
      return { itemId: String(p.itemId), text: String(p.delta ?? ''), type: 'thinking_delta' }
    }
    case 'turn/completed': {
      const turn = p.turn as Record<string, unknown> | undefined
      const status = TURN_STATUS[(turn?.status as string) ?? ''] ?? 'completed'
      const error = (turn?.error as Record<string, unknown> | undefined)?.message
      return error ? { error: String(error), status, type: 'turn' } : { status, type: 'turn' }
    }
    case 'turn/plan/updated': {
      const plan = Array.isArray(p.plan) ? (p.plan as unknown[]) : []
      const steps: AgentPlanStep[] = plan
        .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
        .filter(
          (s): s is { status: AgentPlanStep['status']; step: string } =>
            typeof s.step === 'string' && PLAN_STEP_STATUSES.has(s.status as string),
        )
        .map((s) => ({ status: s.status, step: s.step }))
      return { steps, type: 'plan' }
    }
    case 'turn/started': {
      return { status: 'started', type: 'turn' }
    }
    default: {
      return null
    }
  }
}

function mapAgentMessage(started: boolean, item: Record<string, unknown>): AgentUiEvent | null {
  return started
    ? null
    : { itemId: String(item.id), text: String(item.text ?? ''), type: 'message' }
}

function mapCommandExecution(started: boolean, item: Record<string, unknown>): AgentUiEvent {
  const command = shorten(String(item.command ?? ''))
  if (started) return { command, itemId: String(item.id), status: 'started', type: 'command' }
  const exitCode = (item.exitCode as null | number | undefined) ?? null
  const status = item.status === 'completed' && (exitCode ?? 0) === 0 ? 'completed' : 'failed'
  return { command, exitCode, itemId: String(item.id), status, type: 'command' }
}

function mapImageGeneration(started: boolean, item: Record<string, unknown>): AgentUiEvent {
  // `result` is the whole image as base64: never forward it.
  if (started) return { itemId: String(item.id), status: 'started', type: 'image_progress' }
  return item.savedPath
    ? { itemId: String(item.id), path: String(item.savedPath), type: 'image' }
    : { itemId: String(item.id), status: 'failed', type: 'image_progress' }
}

function mapItem(started: boolean, item: Record<string, unknown>): AgentUiEvent | null {
  switch (item.type) {
    case 'agentMessage': {
      return mapAgentMessage(started, item)
    }
    case 'commandExecution': {
      return mapCommandExecution(started, item)
    }
    case 'dynamicToolCall': {
      return mapDynamicToolCall(started, item)
    }
    case 'imageGeneration': {
      return mapImageGeneration(started, item)
    }
    case 'mcpToolCall': {
      return mapMcpToolCall(started, item)
    }
    case 'reasoning': {
      return mapReasoning(started, item)
    }
    case 'webSearch': {
      return mapWebSearch(started, item)
    }
    default: {
      return null
    }
  }
}

/** A ReelMakeEasy tool call (make_video, regenerate_clip, render_video): shown with what it does. */
function mapDynamicToolCall(started: boolean, item: Record<string, unknown>): AgentUiEvent {
  const status = started
    ? 'started'
    : item.success === false || item.status === 'failed'
      ? 'failed'
      : 'completed'
  return {
    itemId: String(item.id),
    status,
    summary: toolSummary(String(item.tool), item.arguments),
    tool: String(item.tool),
    type: 'tool',
  }
}

function mapMcpToolCall(started: boolean, item: Record<string, unknown>): AgentUiEvent {
  const status = started ? 'started' : item.status === 'failed' ? 'failed' : 'completed'
  return {
    itemId: String(item.id),
    status,
    summary: String(item.tool),
    tool: String(item.tool),
    type: 'tool',
  }
}

function mapReasoning(started: boolean, item: Record<string, unknown>): AgentUiEvent {
  return started
    ? { itemId: String(item.id), status: 'started', text: '', type: 'thinking' }
    : {
        itemId: String(item.id),
        status: 'completed',
        text: (Array.isArray(item.summary) ? item.summary : []).map(String).join('\n\n'),
        type: 'thinking',
      }
}

/** A web search (e.g. autonomous mode's ideas step) as tool activity: the query or opened page only,
 *  never the raw `results`. */
function mapWebSearch(started: boolean, item: Record<string, unknown>): AgentUiEvent {
  const base = { itemId: String(item.id), tool: 'web_search', type: 'tool' } as const
  if (started) return { ...base, status: 'started', summary: 'Searching the web' }
  const action = (item.action ?? {}) as Record<string, unknown>
  const query = typeof item.query === 'string' ? item.query.trim() : ''
  const url = action.type === 'openPage' && typeof action.url === 'string' ? action.url : ''
  const summary = query
    ? `Searched the web: ${shorten(query)}`
    : url
      ? `Opened ${shorten(url)}`
      : 'Searched the web'
  return { ...base, status: 'completed', summary }
}
