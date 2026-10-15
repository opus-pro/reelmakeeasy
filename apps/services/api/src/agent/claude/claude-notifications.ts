import { SAVED_IMAGE_PREFIX } from '../tools/generate-image'

/** A Codex app-server notification, as `mapCodexNotification` reads it. */
export type Notification = { method: string; params?: Record<string, unknown> }

export type TurnOutcome = {
  error?: string
  status: 'completed' | 'failed' | 'interrupted'
  /** A quiet turn's structured answer, posted as its last agent message. */
  structuredText?: string
}

type Block = Record<string, unknown> & { type?: unknown }
type ItemKind = 'command' | 'dynamic' | 'image' | 'web'
type OpenItem = { item: Record<string, unknown>; kind: ItemKind }

const REELMAKEEASY_TOOL = /^mcp__reelmakeeasy__(.+)$/
const FILE_TOOLS = new Set(['Glob', 'Grep', 'Read'])
const TODO_STATUS: Record<string, string> = {
  completed: 'completed',
  in_progress: 'inProgress',
  pending: 'pending',
}

const started = (item: Record<string, unknown>): Notification => ({
  method: 'item/started',
  params: { item },
})
const completed = (item: Record<string, unknown>): Notification => ({
  method: 'item/completed',
  params: { item },
})

const blocksOf = (message: unknown): Block[] => {
  const content = (message as Block | undefined)?.['content']
  return Array.isArray(content) ? (content as Block[]) : []
}

function resultText(block: Block): string {
  const c = block['content']
  if (typeof c === 'string') return c
  return blocksOf(block)
    .map((p) => (typeof p['text'] === 'string' ? p['text'] : ''))
    .join('\n')
}

function todoPlan(input: Record<string, unknown>): Notification {
  const todos = Array.isArray(input['todos']) ? (input['todos'] as Block[]) : []
  const plan = todos.map((t) => ({
    status: TODO_STATUS[String(t['status'])] ?? 'pending',
    step: String(t['content'] ?? ''),
  }))
  return { method: 'turn/plan/updated', params: { plan } }
}

/**
 * One Claude turn's SDK messages as Codex app-server notifications, so the session service and
 * `mapCodexNotification` handle a Claude chat exactly like a Codex one. Item ids: a text or
 * thinking block is `<message id>:<block index>` (the same id while it streams and once it is
 * complete); a tool call is its `tool_use` id, open until its `tool_result` arrives.
 */
export class ClaudeTurnTranslator {
  /** Blocks already completed per reply (message id). */
  private readonly blocksSeen = new Map<string, number>()
  private messageId = 'm'
  private readonly open = new Map<string, OpenItem>()

  constructor(private readonly turnId: string) {}

  /** The turn's last notifications: tool calls still open (an interrupt) end as failed, a quiet
   *  turn's structured answer is posted, then `turn/completed`. */
  finish(outcome: TurnOutcome): Notification[] {
    const out: Notification[] = []
    for (const open of this.open.values()) out.push(this.close(open, true, ''))
    this.open.clear()
    if (outcome.structuredText !== undefined)
      out.push(
        completed({
          id: `${this.turnId}:structured`,
          text: outcome.structuredText,
          type: 'agentMessage',
        }),
      )
    const turn: Record<string, unknown> = { id: this.turnId, status: outcome.status }
    if (outcome.error) turn['error'] = { message: outcome.error }
    out.push({ method: 'turn/completed', params: { turn } })
    return out
  }

  /** Notifications for one SDK message, in order. Subagent messages are not shown. */
  translate(msg: Record<string, unknown>): Notification[] {
    if (msg['parent_tool_use_id']) return []
    if (msg['type'] === 'stream_event') return this.streamEvent((msg['event'] ?? {}) as Block)
    if (msg['type'] === 'assistant') return this.assistant((msg['message'] ?? {}) as Block)
    if (msg['type'] === 'user') return this.toolResults(msg['message'])
    return []
  }

  /** Claude Code sends a reply as one `assistant` message per finished block (all with the
   *  reply's id), so a block's place in the reply is the count of blocks seen before it. */
  private assistant(message: Block): Notification[] {
    if (typeof message['id'] === 'string') this.messageId = message['id']
    const id = this.messageId
    const seen = this.blocksSeen.get(id) ?? 0
    const blocks = blocksOf(message)
    this.blocksSeen.set(id, seen + blocks.length)
    return blocks.flatMap((block, i) => this.assistantBlock(block, `${id}:${seen + i}`))
  }

  private assistantBlock(block: Block, id: string): Notification[] {
    if (block.type === 'text')
      return [completed({ id, text: String(block['text'] ?? ''), type: 'agentMessage' })]
    if (block.type === 'thinking')
      return [completed({ id, summary: [String(block['thinking'] ?? '')], type: 'reasoning' })]
    if (block.type !== 'tool_use') return []
    const input = (block['input'] ?? {}) as Record<string, unknown>
    return this.toolUse(String(block['id']), String(block['name']), input)
  }

  private close({ item, kind }: OpenItem, failed: boolean, text: string): Notification {
    if (kind === 'command')
      return completed({ ...item, exitCode: failed ? 1 : 0, status: 'completed' })
    if (kind === 'dynamic') return completed({ ...item, success: !failed })
    if (kind === 'web') return completed(item)
    const saved =
      !failed && text.startsWith(SAVED_IMAGE_PREFIX)
        ? text.slice(SAVED_IMAGE_PREFIX.length).trim()
        : ''
    return completed(saved ? { ...item, savedPath: saved } : item)
  }

  private start(id: string, kind: ItemKind, item: Record<string, unknown>): Notification[] {
    this.open.set(id, { item, kind })
    // A search shows "Searching the web" until it is done; its query comes with the result.
    return [started(kind === 'web' ? { id, type: 'webSearch' } : item)]
  }

  private streamEvent(event: Block): Notification[] {
    if (event.type === 'message_start') {
      const id = (event['message'] as Block | undefined)?.['id']
      if (typeof id === 'string') this.messageId = id
      return []
    }
    const itemId = `${this.messageId}:${String(event['index'] ?? 0)}`
    if (event.type === 'content_block_start') {
      const block = (event['content_block'] ?? {}) as Block
      return block.type === 'thinking' ? [started({ id: itemId, type: 'reasoning' })] : []
    }
    if (event.type !== 'content_block_delta') return []
    const delta = (event['delta'] ?? {}) as Block
    if (delta.type === 'text_delta')
      return [{ method: 'item/agentMessage/delta', params: { delta: delta['text'], itemId } }]
    if (delta.type === 'thinking_delta')
      return [
        {
          method: 'item/reasoning/summaryTextDelta',
          params: { delta: delta['thinking'], itemId },
        },
      ]
    return []
  }

  private toolResults(message: unknown): Notification[] {
    return blocksOf(message).flatMap((block) => {
      if (block.type !== 'tool_result') return []
      const id = String(block['tool_use_id'])
      const open = this.open.get(id)
      if (!open) return []
      this.open.delete(id)
      return [this.close(open, block['is_error'] === true, resultText(block))]
    })
  }

  private toolUse(id: string, name: string, input: Record<string, unknown>): Notification[] {
    const reelmakeeasy = REELMAKEEASY_TOOL.exec(name)?.[1]
    if (reelmakeeasy === 'generate_image')
      return this.start(id, 'image', { id, type: 'imageGeneration' })
    if (reelmakeeasy)
      return this.start(id, 'dynamic', {
        arguments: input,
        id,
        tool: reelmakeeasy,
        type: 'dynamicToolCall',
      })
    if (name === 'Bash')
      return this.start(id, 'command', {
        command: String(input['command'] ?? ''),
        id,
        type: 'commandExecution',
      })
    if (FILE_TOOLS.has(name)) {
      const what = String(input['file_path'] ?? input['pattern'] ?? '')
      return this.start(id, 'command', { command: `${name} ${what}`, id, type: 'commandExecution' })
    }
    if (name === 'WebSearch')
      return this.start(id, 'web', { id, query: String(input['query'] ?? ''), type: 'webSearch' })
    if (name === 'WebFetch')
      return this.start(id, 'web', {
        action: { type: 'openPage', url: String(input['url'] ?? '') },
        id,
        type: 'webSearch',
      })
    if (name === 'TodoWrite') return [todoPlan(input)]
    return []
  }
}
