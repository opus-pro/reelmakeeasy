import fs from 'node:fs'
import path from 'node:path'

import { agentModeFromStored } from '@reelmakeeasy/common/codex-agent/agent-sessions'
import type { AgentSession, AgentUiEvent } from '@shared/types/api/agent'

type Stored = AgentUiEvent & { id: number }

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Streamed deltas only matter live; the finished event carries the full text. */
const LIVE_ONLY = new Set<AgentUiEvent['type']>(['text_delta', 'thinking_delta'])

/** Persisted events bump the session's `updatedAt` at most this often (it rewrites sessions.json). */
const TOUCH_EVERY_MS = 5000

/** Session ids are `randomUUID()`s. Anything else (`..%2F`, `constructor`) is never a session. */
export function isAgentSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_RE.test(id)
}

function assertSessionId(id: string): void {
  if (!isAgentSessionId(id)) throw new Error(`Invalid agent session id ${JSON.stringify(id)}`)
}

/**
 * Sessions in <root>/sessions.json; each session's events in <root>/<id>/events.jsonl.
 * A separate id watermark at <root>/<id>/last-id is rewritten on every append
 * (including `text_delta` and `thinking_delta`, which are otherwise never
 * persisted) so that after a restart the next id always continues past every
 * id ever handed out, not just the last one that happened to be written to
 * events.jsonl.
 */
export class AgentSessionStore {
  private lastIds = new Map<string, number>()

  constructor(private readonly root: string) {
    fs.mkdirSync(root, { recursive: true })
  }

  append(id: string, event: AgentUiEvent): Stored {
    assertSessionId(id)
    const next = this.lastId(id) + 1
    this.lastIds.set(id, next)
    fs.writeFileSync(this.lastIdFile(id), String(next))
    const stored = { ...event, id: next } as Stored
    if (!LIVE_ONLY.has(event.type)) {
      fs.appendFileSync(this.eventsFile(id), JSON.stringify(stored) + '\n')
      // A `session` event is a status change (often a restart's reconciliation marking a
      // stale session `stopped`), not activity on its own: real activity always comes with
      // some other persisted event too.
      if (event.type !== 'session') this.touch(id)
    }
    return stored
  }

  create(input: { id: string; title: string }): AgentSession {
    assertSessionId(input.id)
    const now = new Date().toISOString()
    const session: AgentSession = {
      createdAt: now,
      id: input.id,
      projectId: null,
      status: 'idle',
      threadId: null,
      title: input.title,
      updatedAt: now,
    }
    fs.mkdirSync(this.sessionDir(input.id), { recursive: true })
    this.write({ ...this.readAll(), [input.id]: session })
    return session
  }

  /** Removes the session and its folder (events, images). Throws for an unknown id. */
  delete(id: string): void {
    assertSessionId(id)
    const all = this.readAll()
    if (!Object.hasOwn(all, id)) throw new Error(`Unknown agent session ${id}`)
    delete all[id]
    this.write(all)
    this.lastIds.delete(id)
    fs.rmSync(this.sessionDir(id), { force: true, recursive: true })
  }

  eventsAfter(id: string, afterId: number): Stored[] {
    return this.readEvents(id).filter((e) => e.id > afterId)
  }

  get(id: string): AgentSession | null {
    if (!isAgentSessionId(id)) return null
    const all = this.readAll()
    // `Object.hasOwn`, not `all[id]`: a plain object also "has" `constructor`, `__proto__`...
    return Object.hasOwn(all, id) ? all[id] : null
  }

  list(): AgentSession[] {
    return Object.values(this.readAll())
  }

  /** The id the next `append` for this session will get. */
  nextEventId(id: string): number {
    assertSessionId(id)
    return this.lastId(id) + 1
  }

  /** Throws for anything that is not a session id, so the result is always a child of the root. */
  sessionDir(id: string): string {
    assertSessionId(id)
    return path.join(this.root, id)
  }

  /** `touch` (default true) bumps `updatedAt`; pass `{ touch: false }` for a change that is
   *  not activity (e.g. a restart's reconciliation marking a stale session `stopped`). */
  update(id: string, patch: Partial<AgentSession>, opts: { touch?: boolean } = {}): AgentSession {
    const all = this.readAll()
    if (!isAgentSessionId(id) || !Object.hasOwn(all, id))
      throw new Error(`Unknown agent session ${id}`)
    const updatedAt = opts.touch === false ? all[id].updatedAt : new Date().toISOString()
    all[id] = { ...all[id], ...patch, id, updatedAt }
    this.write(all)
    return all[id]
  }

  private eventsFile(id: string): string {
    return path.join(this.sessionDir(id), 'events.jsonl')
  }

  private lastId(id: string): number {
    if (!this.lastIds.has(id)) {
      const watermark = this.readWatermark(id)
      const lastPersisted = this.readEvents(id).at(-1)?.id ?? 0
      this.lastIds.set(id, Math.max(watermark, lastPersisted, 0))
    }
    return this.lastIds.get(id)!
  }

  private lastIdFile(id: string): string {
    return path.join(this.sessionDir(id), 'last-id')
  }

  private readAll(): Record<string, AgentSession> {
    const file = path.join(this.root, 'sessions.json')
    if (!fs.existsSync(file)) return {}
    const all = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, AgentSession>
    // A chat saved in the removed Guided mode reads as Free chat (and is saved so on its next write).
    for (const session of Object.values(all))
      if (session.mode !== undefined) session.mode = agentModeFromStored(session.mode)
    return all
  }

  private readEvents(id: string): Stored[] {
    const file = this.eventsFile(id)
    if (!fs.existsSync(file)) return []
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const stored = JSON.parse(l) as Stored
        // The `mode` event of a chat saved in the removed Guided mode replays as Free chat.
        if (stored.type !== 'mode') return stored
        return { ...stored, mode: agentModeFromStored(stored.mode) ?? stored.mode }
      })
  }

  private readWatermark(id: string): number {
    const file = this.lastIdFile(id)
    if (!fs.existsSync(file)) return 0
    const value = Number(fs.readFileSync(file, 'utf8'))
    return Number.isFinite(value) ? value : 0
  }

  /** Marks activity: `updatedAt` = now, unless it was set less than TOUCH_EVERY_MS ago. */
  private touch(id: string): void {
    const all = this.readAll()
    const session = all[id]
    if (!session) return
    const now = Date.now()
    if (now - (Date.parse(session.updatedAt ?? '') || 0) < TOUCH_EVERY_MS) return
    all[id] = { ...session, updatedAt: new Date(now).toISOString() }
    this.write(all)
  }

  private write(all: Record<string, AgentSession>): void {
    const file = path.join(this.root, 'sessions.json')
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(all, null, 2))
    fs.renameSync(`${file}.tmp`, file)
  }
}
