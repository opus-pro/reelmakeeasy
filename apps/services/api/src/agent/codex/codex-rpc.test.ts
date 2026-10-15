import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CodexRpcClient } from './codex-rpc'

const FAKE = path.join(__dirname, '__fixtures__', 'fake-app-server.mjs')
const spawnFake = (...flags: string[]) => CodexRpcClient.spawn(process.execPath, [FAKE, ...flags])

/** A child that sends one server request (`x/ask`, id "r1"), appends every line it receives
 *  to `received`, and answers any request of ours with `{ pong: true }`. */
const ASKING_CHILD = `
const fs = require('node:fs')
const received = process.argv[1]
const out = (m) => process.stdout.write(JSON.stringify(m) + '\\n')
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  fs.appendFileSync(received, line + '\\n')
  const msg = JSON.parse(line)
  if (msg.id !== undefined && msg.method) out({ id: msg.id, result: { pong: true } })
})
out({ id: 'r1', method: 'x/ask', params: { n: 1 } })
`

function spawnAsking() {
  const received = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'codex-rpc-ask-')),
    'received.jsonl',
  )
  fs.writeFileSync(received, '')
  const client = CodexRpcClient.spawn(process.execPath, ['-e', ASKING_CHILD, received])
  /** Waits until the child has received a line with id "r1", and returns it parsed. */
  const reply = async (): Promise<unknown> => {
    const end = Date.now() + 3000
    for (;;) {
      const line = fs
        .readFileSync(received, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { id?: unknown; method?: string })
        .find((m) => m.id === 'r1' && !m.method)
      if (line) return line
      if (Date.now() > end) throw new Error('timed out waiting for the reply to r1')
      await new Promise((r) => setTimeout(r, 20))
    }
  }
  return { client, reply }
}

describe('CodexRpcClient', () => {
  it('initializes, starts a thread and streams a turn', async () => {
    const client = spawnFake()
    const seen: string[] = []
    client.onNotification((m) => seen.push(m.method))
    await client.request('initialize', {
      capabilities: null,
      clientInfo: { name: 't', title: null, version: '0' },
    })
    client.notify('initialized')
    const { thread } = await client.request<{ thread: { id: string } }>('thread/start', {})
    const done = new Promise<void>((r) =>
      client.onNotification((m) => m.method === 'turn/completed' && r()),
    )
    await client.request('turn/start', {
      input: [{ text: 'hi', type: 'text' }],
      threadId: thread.id,
    })
    await done
    expect(seen).toEqual(
      expect.arrayContaining([
        'turn/started',
        'item/agentMessage/delta',
        'item/completed',
        'turn/completed',
      ]),
    )
    client.close()
  })

  it('rejects JSON-RPC errors and pending requests when the process exits', async () => {
    const client = spawnFake('--crash-on-turn')
    await client.request('initialize', {})
    await expect(client.request('thread/resume', { threadId: 'missing' })).rejects.toThrow(
      'no thread',
    )
    const exited = new Promise<null | number>((r) => client.onExit(r))
    await expect(client.request('turn/start', { threadId: 'x' })).rejects.toThrow(/exited/)
    await expect(exited).resolves.toBe(3)
  })

  it('rejects new requests and never throws from notify once the process has exited', async () => {
    const client = spawnFake('--crash-on-turn')
    await client.request('initialize', {})
    await expect(client.request('turn/start', { threadId: 'x' })).rejects.toThrow(/exited/)
    // The process is now gone; further calls must fail cleanly, not hang or throw.
    await expect(client.request('thread/start', {})).rejects.toThrow(/codex app-server/)
    expect(() => client.notify('initialized')).not.toThrow()
  })

  it('rejects with the stderr tail when the process fails before completing a request', async () => {
    const client = spawnFake('--fail-start')
    await expect(client.request('initialize', {})).rejects.toThrow(/invalid transport/)
  })

  it('reports exit even when a backgrounded subprocess holds the stdio pipes open', async () => {
    // The fake app-server spawns a detached, stdio-inheriting subprocess and
    // exits, simulating Codex leaving a backgrounded shell command holding
    // its stdout/stderr - which means 'close' never fires promptly (only the
    // holder's own exit, ~3s later, would end the pipe). The 500ms grace
    // timer started on 'exit' must fail the pending request well before that.
    const client = spawnFake('--hold-stdio')
    let exitCount = 0
    client.onExit(() => {
      exitCount += 1
    })
    await client.request('initialize', {})
    const { thread } = await client.request<{ thread: { id: string } }>('thread/start', {})
    await expect(client.request('turn/start', { threadId: thread.id })).rejects.toThrow(
      /exited \(2\)/,
    )
    expect(exitCount).toBe(1)
  })

  it('rejects pending requests and reports exit exactly once when the binary cannot be spawned', async () => {
    const client = CodexRpcClient.spawn('/nonexistent/codex-bin-reelmakeeasy-test', [])
    let exitCount = 0
    client.onExit(() => {
      exitCount += 1
    })
    await expect(client.request('initialize', {})).rejects.toThrow(/codex app-server/)
    expect(() => client.notify('initialized')).not.toThrow()
    // A spawn failure may be followed by a late 'exit' event; give it a chance to
    // arrive before asserting the exit handler fired exactly once, not twice.
    await new Promise((r) => setTimeout(r, 50))
    expect(exitCount).toBe(1)
  })

  it('times out a request the app-server never answers, stops the child and fails the rest', async () => {
    const client = CodexRpcClient.spawn(process.execPath, [FAKE, '--hang=turn/start'], {
      requestTimeoutsMs: { 'turn/start': 150 },
    })
    const exits: [null | number, string][] = []
    client.onExit((code, reason) => exits.push([code, reason]))
    await client.request('initialize', {})
    const { thread } = await client.request<{ thread: { id: string } }>('thread/start', {})
    const started = Date.now()
    await expect(client.request('turn/start', { threadId: thread.id })).rejects.toThrow(
      'codex app-server did not answer turn/start within 150ms',
    )
    expect(Date.now() - started).toBeLessThan(2000)
    expect(exits).toEqual([[null, expect.stringContaining('did not answer turn/start')]])
    await expect(client.request('thread/start', {})).rejects.toThrow(/exited/)
  })

  it('honours a per-call timeoutMs over the method default', async () => {
    const client = spawnFake('--hang=initialize')
    await expect(client.request('initialize', {}, { timeoutMs: 100 })).rejects.toThrow(
      'did not answer initialize within 100ms',
    )
  })

  it('keeps delivering to later handlers when a notification handler throws', async () => {
    const client = spawnFake()
    const seen: string[] = []
    client.onNotification(() => {
      throw new Error('bad handler')
    })
    client.onNotification((m) => seen.push(m.method))
    await client.request('initialize', {})
    const { thread } = await client.request<{ thread: { id: string } }>('thread/start', {})
    const done = new Promise<void>((r) =>
      client.onNotification((m) => m.method === 'turn/completed' && r()),
    )
    await client.request('turn/start', { threadId: thread.id })
    await done
    expect(seen).toEqual(expect.arrayContaining(['turn/started', 'turn/completed']))
    client.close()
  })

  it('keeps calling later exit handlers when one throws', async () => {
    const client = spawnFake('--crash-on-turn')
    client.onExit(() => {
      throw new Error('bad exit handler')
    })
    const exited = new Promise<null | number>((r) => client.onExit(r))
    await client.request('initialize', {})
    await expect(client.request('turn/start', { threadId: 'x' })).rejects.toThrow(/exited/)
    await expect(exited).resolves.toBe(3)
  })

  describe('server requests', () => {
    it('refuses them with -32601 when no handler is registered', async () => {
      const { client, reply } = spawnAsking()
      await expect(reply()).resolves.toEqual({
        error: { code: -32601, message: 'Not supported by ReelMakeEasy' },
        id: 'r1',
      })
      client.close()
    })

    it('passes (method, params, requestId) to the handler and answers with its result', async () => {
      const { client, reply } = spawnAsking()
      const handler = jest.fn(() => Promise.resolve({ ok: 1 }))
      client.onServerRequest(handler)
      await expect(reply()).resolves.toEqual({ id: 'r1', result: { ok: 1 } })
      expect(handler).toHaveBeenCalledWith('x/ask', { n: 1 }, 'r1')
      client.close()
    })

    it('answers with -32000 and the message when the handler rejects', async () => {
      const { client, reply } = spawnAsking()
      client.onServerRequest(() => Promise.reject(new Error('nope')))
      await expect(reply()).resolves.toEqual({
        error: { code: -32000, message: 'nope' },
        id: 'r1',
      })
      client.close()
    })

    it('uses only the latest handler', async () => {
      const { client, reply } = spawnAsking()
      const first = jest.fn(() => Promise.resolve('first'))
      client.onServerRequest(first)
      client.onServerRequest(() => Promise.resolve('second'))
      await expect(reply()).resolves.toEqual({ id: 'r1', result: 'second' })
      expect(first).not.toHaveBeenCalled()
      client.close()
    })

    it('treats a handler that throws as "not supported" and keeps working', async () => {
      const { client, reply } = spawnAsking()
      client.onServerRequest(() => {
        throw new Error('bad handler')
      })
      await expect(reply()).resolves.toEqual({
        error: { code: -32601, message: 'Not supported by ReelMakeEasy' },
        id: 'r1',
      })
      await expect(client.request('ping', {})).resolves.toEqual({ pong: true })
      client.close()
    })
  })

  it("does not pass ReelMakeEasy's secrets to the child environment", async () => {
    const saved = { ...process.env }
    Object.assign(process.env, { FAL_KEY: 'f', GEMINI_API_KEY: 'g', SOME_OTHER_API_KEY: 'x' })
    try {
      const client = spawnFake()
      const { envKeys } = await client.request<{ envKeys: string[] }>('initialize', {})
      client.close()
      expect(envKeys).toEqual(expect.arrayContaining(['PATH']))
      expect(envKeys).not.toEqual(expect.arrayContaining(['FAL_KEY']))
      expect(envKeys).not.toEqual(expect.arrayContaining(['GEMINI_API_KEY']))
      expect(envKeys).not.toEqual(expect.arrayContaining(['SOME_OTHER_API_KEY']))
    } finally {
      for (const key of ['FAL_KEY', 'GEMINI_API_KEY', 'SOME_OTHER_API_KEY']) {
        if (saved[key] === undefined) delete process.env[key]
        else process.env[key] = saved[key]
      }
    }
  })
})
