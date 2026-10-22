import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { AgentSessionStore, isAgentSessionId } from './agent-session.store'

describe('AgentSessionStore', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-store-'))
  const [s1, s2, s3, s4] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()]

  it('persists sessions across instances', () => {
    new AgentSessionStore(root).create({ id: s1, title: 'Bees' })
    new AgentSessionStore(root).update(s1, { threadId: 't1' })
    expect(new AgentSessionStore(root).get(s1)).toMatchObject({
      id: s1,
      status: 'idle',
      threadId: 't1',
      title: 'Bees',
    })
  })

  it('numbers events and replays only newer ones, in order', () => {
    const store = new AgentSessionStore(root)
    store.create({ id: s2, title: 'x' })
    const a = store.append(s2, { text: 'hi', type: 'user_message' })
    const b = store.append(s2, { status: 'started', type: 'turn' })
    const c = store.append(s2, { status: 'completed', type: 'turn' })
    expect([a.id, b.id, c.id]).toEqual([1, 2, 3])
    expect(new AgentSessionStore(root).eventsAfter(s2, 1).map((e) => e.id)).toEqual([2, 3])
    expect(store.eventsAfter(s2, 3)).toEqual([])
    expect(new AgentSessionStore(root).append(s2, { text: 'again', type: 'user_message' }).id).toBe(
      4,
    )
  })

  it('does not persist streaming text deltas', () => {
    const store = new AgentSessionStore(root)
    store.create({ id: s3, title: 'x' })
    store.append(s3, { itemId: 'm', text: 'H', type: 'text_delta' })
    store.append(s3, { itemId: 'm', text: 'Hello', type: 'message' })
    expect(new AgentSessionStore(root).eventsAfter(s3, 0).map((e) => e.type)).toEqual(['message'])
  })

  it('does not persist streaming thinking deltas', () => {
    const store = new AgentSessionStore(root)
    const id = randomUUID()
    store.create({ id, title: 'x' })
    const a = store.append(id, { itemId: 'r', status: 'started', text: '', type: 'thinking' })
    const b = store.append(id, { itemId: 'r', text: 'Plan', type: 'thinking_delta' })
    expect(b.id).toBe(a.id + 1)
    expect(new AgentSessionStore(root).eventsAfter(id, 0).map((e) => e.type)).toEqual(['thinking'])
  })

  it('watermarks ids across restarts so unpersisted deltas are never reused', () => {
    const store = new AgentSessionStore(root)
    store.create({ id: s4, title: 'x' })
    store.append(s4, { itemId: 'm', text: 'Hello', type: 'message' })
    store.append(s4, { itemId: 'm', text: 'H', type: 'text_delta' })
    store.append(s4, { itemId: 'm', text: 'He', type: 'text_delta' })
    expect(new AgentSessionStore(root).eventsAfter(s4, 0).map((e) => e.type)).toEqual(['message'])
    expect(
      new AgentSessionStore(root).append(s4, { itemId: 'm', text: 'again', type: 'message' }).id,
    ).toBe(4)
  })

  it('only accepts UUID session ids', () => {
    const store = new AgentSessionStore(root)
    expect(isAgentSessionId(randomUUID())).toBe(true)
    for (const bad of ['..', '../x', '..%2F..%2Fetc', 'constructor', '__proto__', 'toString', '']) {
      expect(isAgentSessionId(bad)).toBe(false)
      expect(store.get(bad)).toBeNull()
      expect(() => store.sessionDir(bad)).toThrow(/Invalid agent session id/)
    }
    expect(() => store.create({ id: '../escape', title: 'x' })).toThrow(/Invalid agent session id/)
  })

  it('does not resolve Object.prototype keys as sessions', () => {
    const store = new AgentSessionStore(root)
    store.create({ id: randomUUID(), title: 'x' })
    expect(store.get('constructor')).toBeNull()
    expect(store.get('hasOwnProperty')).toBeNull()
  })

  it('stamps updatedAt on create and bumps it on update', async () => {
    const store = new AgentSessionStore(root)
    const id = randomUUID()
    const created = store.create({ id, title: 'x' })
    expect(created.updatedAt).toBe(created.createdAt)
    await new Promise((r) => setTimeout(r, 5))
    const updated = store.update(id, { status: 'idle' })
    expect(Date.parse(updated.updatedAt!)).toBeGreaterThan(Date.parse(created.updatedAt!))
  })

  it('bumps updatedAt on persisted events, not on deltas', () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T00:00:00.000Z') })
    try {
      const store = new AgentSessionStore(root)
      const id = randomUUID()
      store.create({ id, title: 'x' })
      jest.setSystemTime(new Date('2026-10-02T00:01:00.000Z'))
      store.append(id, { itemId: 'm', text: 'H', type: 'text_delta' })
      expect(store.get(id)?.updatedAt).toBe('2026-10-02T00:00:00.000Z')
      store.append(id, { text: 'hi', type: 'user_message' })
      expect(store.get(id)?.updatedAt).toBe('2026-10-02T00:01:00.000Z')
    } finally {
      jest.useRealTimers()
    }
  })

  it('keeps updatedAt when update is called with touch: false', async () => {
    const store = new AgentSessionStore(root)
    const id = randomUUID()
    const created = store.create({ id, title: 'x' })
    await new Promise((r) => setTimeout(r, 5))
    const updated = store.update(id, { status: 'stopped' }, { touch: false })
    expect(updated.updatedAt).toBe(created.updatedAt)
  })

  it('does not bump updatedAt for an event appended with touch: false', () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T00:00:00.000Z') })
    try {
      const store = new AgentSessionStore(root)
      const id = randomUUID()
      store.create({ id, title: 'x' })
      jest.setSystemTime(new Date('2026-10-02T00:01:00.000Z'))
      store.append(id, { questionId: 'q', type: 'question_expired' }, { touch: false })
      expect(store.get(id)?.updatedAt).toBe('2026-10-02T00:00:00.000Z')
      expect(store.eventsAfter(id, 0)).toHaveLength(1)
    } finally {
      jest.useRealTimers()
    }
  })

  it('does not bump updatedAt for a session event', () => {
    jest.useFakeTimers({ now: new Date('2026-10-02T00:00:00.000Z') })
    try {
      const store = new AgentSessionStore(root)
      const id = randomUUID()
      store.create({ id, title: 'x' })
      jest.setSystemTime(new Date('2026-10-02T00:01:00.000Z'))
      store.append(id, { status: 'stopped', type: 'session' })
      expect(store.get(id)?.updatedAt).toBe('2026-10-02T00:00:00.000Z')
    } finally {
      jest.useRealTimers()
    }
  })

  it('opens a chat saved in the removed Guided mode as Free chat, with its history', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-store-guided-'))
    const id = randomUUID()
    const saved = {
      createdAt: '2026-09-01T00:00:00.000Z',
      id,
      mode: 'guided',
      projectId: null,
      status: 'idle',
      threadId: 't-old',
      title: 'Bees',
      updatedAt: '2026-09-01T00:00:00.000Z',
    }
    fs.writeFileSync(path.join(dir, 'sessions.json'), JSON.stringify({ [id]: saved }))
    fs.mkdirSync(path.join(dir, id))
    const events = [
      { id: 1, mode: 'guided', type: 'mode' },
      { id: 2, text: 'A video about bees', type: 'user_message' },
      { id: 3, itemId: 'm1', text: 'Here is a script.', type: 'message' },
    ]
    fs.writeFileSync(
      path.join(dir, id, 'events.jsonl'),
      events.map((e) => JSON.stringify(e)).join('\n') + '\n',
    )

    const store = new AgentSessionStore(dir)
    expect(store.get(id)).toMatchObject({ mode: 'free', threadId: 't-old', title: 'Bees' })
    expect(store.list().find((s) => s.id === id)?.mode).toBe('free')
    expect(store.eventsAfter(id, 0)).toEqual([
      { id: 1, mode: 'free', type: 'mode' },
      events[1],
      events[2],
    ])
    // A later write keeps it Free chat on disk too.
    store.update(id, { title: 'Bees 2' })
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8'))
    expect(onDisk[id].mode).toBe('free')
  })

  it('deletes a session and its folder; ids are not reused', () => {
    const store = new AgentSessionStore(root)
    const id = randomUUID()
    store.create({ id, title: 'x' })
    store.append(id, { text: 'hi', type: 'user_message' })
    store.delete(id)
    expect(store.get(id)).toBeNull()
    expect(fs.existsSync(path.join(root, id))).toBe(false)
    expect(new AgentSessionStore(root).list().some((s) => s.id === id)).toBe(false)
    expect(() => store.delete(id)).toThrow(/Unknown agent session/)
    expect(() => store.delete('../x')).toThrow(/Invalid agent session id/)
  })
})
