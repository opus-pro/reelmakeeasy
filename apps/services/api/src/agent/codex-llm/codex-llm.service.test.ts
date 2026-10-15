import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ChatTransportRequest } from '@reelmakeeasy/llm'

import { agentCodexHome } from '../codex/codex-home'
import { CodexRpcClient } from '../codex/codex-rpc'

import { CodexUnsupportedInputError } from './codex-chat-input'
import { CodexLlmService, llmAppServerSpawnSpec } from './codex-llm.service'
import { strictifySchema } from './strict-schema'

const FAKE = path.join(__dirname, '..', 'codex', '__fixtures__', 'fake-app-server.mjs')

let services: CodexLlmService[] = []
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-llm-'))

afterEach(() => {
  delete process.env.FAKE_LOG
  delete process.env.FAKE_TURN_MS
  for (const svc of services) svc.onModuleDestroy()
  services = []
})

/** A service whose app-server is the fake; `flags` is read on every spawn, so a test can
 *  change it between calls. */
function makeService(
  flags: string[] | { current: string[] },
  opts: {
    env?: Record<string, string>
    idleMs?: number
    maxConcurrent?: number
    onSpawn?: (c: CodexRpcClient) => void
    recycleAfterCalls?: number
  } = {},
) {
  const box = Array.isArray(flags) ? { current: flags } : flags
  const spawns: string[] = []
  const svc = new CodexLlmService({
    idleMs: opts.idleMs,
    maxConcurrent: opts.maxConcurrent,
    recycleAfterCalls: opts.recycleAfterCalls,
    spawnCodex: async (cwd) => {
      spawns.push(cwd)
      Object.assign(process.env, opts.env ?? {})
      const client = CodexRpcClient.spawn(process.execPath, [FAKE, ...box.current], { cwd })
      opts.onSpawn?.(client)
      return client
    },
    workDir: path.join(root, 'llm-work'),
  })
  services.push(svc)
  return { spawns, svc }
}

const readLog = (log: string) =>
  fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { method?: string; params?: Record<string, unknown> })

const looseSchema = {
  properties: { echoedSchema: { type: 'object' }, note: { type: 'string' } },
  type: 'object',
}

const chat = (prompt: string, extra: Partial<ChatTransportRequest> = {}): ChatTransportRequest => ({
  messages: [
    { content: 'You are a test.', role: 'system' },
    { content: [{ text: prompt, type: 'text' }], role: 'user' },
  ],
  model: 'flash',
  ...extra,
})

const structured = (prompt: string): ChatTransportRequest =>
  chat(prompt, {
    response_format: {
      json_schema: { name: 'response', schema: looseSchema, strict: false },
      type: 'json_schema',
    },
  })

describe('llmAppServerSpawnSpec', () => {
  it('runs a plain app-server: no shell, no user questions, no reasoning summaries, no web search', () => {
    expect(llmAppServerSpawnSpec({}).args).toEqual([
      'app-server',
      '--disable',
      'plugins',
      '--disable',
      'apps',
      '--disable',
      'shell_tool',
      '--disable',
      'unified_exec',
      '-c',
      'web_search="disabled"',
      '-c',
      'model_reasoning_summary="none"',
    ])
  })

  it("never hands ReelMakeEasy's secrets to Codex, and uses the agent Codex home", () => {
    const { env } = llmAppServerSpawnSpec({
      CODEX_HOME: '/users/own/codex',
      DATABASE_URL: 'mongodb://x',
      ELEVENLABS_API_KEY: 'e',
      FAL_KEY: 'f',
      GEMINI_API_KEY: 'g',
      LLM_API_KEY: 'l',
      OPENAI_API_KEY: 'o',
      PATH: '/bin',
    })
    for (const secret of [
      'GEMINI_API_KEY',
      'FAL_KEY',
      'ELEVENLABS_API_KEY',
      'LLM_API_KEY',
      'DATABASE_URL',
    ])
      expect(env).not.toHaveProperty(secret)
    expect(env['CODEX_HOME']).toBe(agentCodexHome())
    expect(env).toMatchObject({ OPENAI_API_KEY: 'o', PATH: '/bin' })
  })
})

describe('CodexLlmService', () => {
  it("is a 'codex' transport", () => {
    expect(makeService([]).svc.transport.name).toBe('codex')
  })

  it('sends the strict schema and returns the reply with the optional nulls stripped', async () => {
    const log = path.join(root, `schema-${Date.now()}.jsonl`)
    const { spawns, svc } = makeService(['--schema-echo'], { env: { FAKE_LOG: log } })
    const response = await svc.transport.send(structured('make json'), 10_000)
    expect(response.model).toBe('codex')
    const content = JSON.parse(response.choices[0]!.message.content!)
    expect(content).toEqual({ echoedSchema: strictifySchema(looseSchema) })
    expect(spawns).toEqual([path.join(root, 'llm-work')])
    expect(fs.existsSync(path.join(root, 'llm-work'))).toBe(true)

    const entries = readLog(log)
    expect(entries.find((e) => e.method === 'thread/start')?.params).toEqual({
      approvalPolicy: 'never',
      cwd: path.join(root, 'llm-work'),
      developerInstructions: expect.stringContaining('You are a test.'),
      ephemeral: true,
      sandbox: 'read-only',
    })
    expect(entries.find((e) => e.method === 'turn/start')?.params).toMatchObject({
      effort: 'low',
      input: [{ text: 'make json', type: 'text' }],
      outputSchema: strictifySchema(looseSchema),
    })
  })

  it('returns the plain text when the request has no schema', async () => {
    const log = path.join(root, `plain-${Date.now()}.jsonl`)
    const { svc } = makeService(['--schema-echo'], { env: { FAKE_LOG: log } })
    const response = await svc.transport.send(chat('say hi'), 10_000)
    expect(response.choices[0]!.message.content).toBe('plain:say hi')
    const turnStart = readLog(log).find((e) => e.method === 'turn/start')
    expect(turnStart?.params).not.toHaveProperty('outputSchema')
  })

  it('retries without the schema, on a new thread, when Codex rejects it', async () => {
    const log = path.join(root, `reject-${Date.now()}.jsonl`)
    const { svc } = makeService(['--reject-schema'], { env: { FAKE_LOG: log } })
    const response = await svc.transport.send(structured('make json'), 10_000)
    const content = response.choices[0]!.message.content!
    expect(content).toMatch(/^plain:make json\n\nReply with only JSON matching this schema:\n/)
    expect(content).toContain(JSON.stringify(looseSchema))

    const entries = readLog(log)
    const threads = entries.filter((e) => e.method === 'thread/start')
    const turns = entries.filter((e) => e.method === 'turn/start')
    expect(threads).toHaveLength(2)
    expect(turns).toHaveLength(2)
    expect(turns[0]!.params).toHaveProperty('outputSchema')
    expect(turns[1]!.params).not.toHaveProperty('outputSchema')
    expect(turns[1]!.params!['threadId']).not.toBe(turns[0]!.params!['threadId'])
    expect(JSON.stringify(turns[1]!.params!['input'])).toContain(
      'Reply with only JSON matching this schema',
    )
  })

  it('fails a call Codex fails for another reason, without retrying', async () => {
    const log = path.join(root, `failed-${Date.now()}.jsonl`)
    // `--ask`: Codex asks the user a question; the LLM client refuses it, so the turn fails.
    const { svc } = makeService(['--ask'], { env: { FAKE_LOG: log } })
    await expect(svc.transport.send(structured('x'), 10_000)).rejects.toThrow(
      'codex llm turn failed: Not supported by ReelMakeEasy',
    )
    expect(readLog(log).filter((e) => e.method === 'turn/start')).toHaveLength(1)
  })

  it('runs at most maxConcurrent calls at a time on one app-server', async () => {
    let inFlight = 0
    let peak = 0
    const { spawns, svc } = makeService([], {
      env: { FAKE_TURN_MS: '150' },
      maxConcurrent: 2,
      onSpawn: (client) => {
        const request = client.request.bind(client)
        client.request = ((method: string, params: unknown, o?: { timeoutMs?: number }) => {
          if (method === 'turn/start') peak = Math.max(peak, ++inFlight)
          return request(method, params, o)
        }) as typeof client.request
        client.onNotification((msg) => {
          if (msg.method === 'turn/completed') inFlight--
        })
      },
    })
    const replies = await Promise.all(
      [1, 2, 3, 4].map((n) => svc.transport.send(chat(`call ${n}`), 10_000)),
    )
    expect(replies.map((r) => r.choices[0]!.message.content)).toEqual(
      new Array(4).fill('Hello from fake'),
    )
    expect(peak).toBe(2)
    expect(spawns).toHaveLength(1)
  })

  it('interrupts the turn and throws when the call times out', async () => {
    const log = path.join(root, `timeout-${Date.now()}.jsonl`)
    const { svc } = makeService(['--slow'], { env: { FAKE_LOG: log } })
    await expect(svc.transport.send(chat('slow'), 300)).rejects.toThrow(
      'codex llm timed out after 0.3s',
    )
    const end = Date.now() + 2000
    while (!readLog(log).some((e) => e.method === 'turn/interrupt')) {
      if (Date.now() > end) throw new Error('no turn/interrupt logged')
      await new Promise((r) => setTimeout(r, 20))
    }
  })

  it('rejects in-flight calls when Codex crashes, and respawns for the next call', async () => {
    const flags = { current: ['--crash-on-turn'] }
    const { spawns, svc } = makeService(flags)
    await expect(svc.transport.send(chat('boom'), 10_000)).rejects.toThrow(/exited/)
    flags.current = []
    const response = await svc.transport.send(chat('again'), 10_000)
    expect(response.choices[0]!.message.content).toBe('Hello from fake')
    expect(spawns).toHaveLength(2)
  })

  it('retires a child after recycleAfterCalls calls, closing it once its calls finish', async () => {
    const clients: { client: CodexRpcClient; closedAfterTurns: null | number; turns: number }[] = []
    const { spawns, svc } = makeService([], {
      env: { FAKE_TURN_MS: '100' },
      onSpawn: (client) => {
        const entry = { client, closedAfterTurns: null as null | number, turns: 0 }
        clients.push(entry)
        client.onNotification((msg) => {
          if (msg.method === 'turn/completed') entry.turns++
        })
        const close = client.close.bind(client)
        client.close = () => {
          entry.closedAfterTurns ??= entry.turns
          close()
        }
      },
      recycleAfterCalls: 2,
    })
    await svc.transport.send(chat('one'), 10_000)
    // Two more calls on the first child: the second call to finish retires it while the
    // other is (or was just) in flight; it is closed only after all three turns are done.
    await Promise.all([
      svc.transport.send(chat('two'), 10_000),
      svc.transport.send(chat('three'), 10_000),
    ])
    expect(spawns).toHaveLength(1)
    expect(clients[0]!.closedAfterTurns).toBe(3)

    const response = await svc.transport.send(chat('four'), 10_000)
    expect(response.choices[0]!.message.content).toBe('Hello from fake')
    expect(spawns).toHaveLength(2)
    expect(clients[1]!.closedAfterTurns).toBeNull()
  })

  it('keeps a retired child open while a call is still running on it', async () => {
    const clients: { client: CodexRpcClient; closed: boolean }[] = []
    const { spawns, svc } = makeService([], {
      env: { FAKE_TURN_MS: '300' },
      onSpawn: (client) => {
        const entry = { client, closed: false }
        clients.push(entry)
        const close = client.close.bind(client)
        client.close = () => {
          entry.closed = true
          close()
        }
      },
      recycleAfterCalls: 1,
    })
    const first = svc.transport.send(chat('first'), 10_000)
    await new Promise((r) => setTimeout(r, 100))
    const second = svc.transport.send(chat('second'), 10_000) // also on child 1
    await first // finishing it retires child 1, with the second call still running there
    expect(clients[0]!.closed).toBe(false)
    const third = svc.transport.send(chat('third'), 10_000) // goes to a new child
    await second
    expect(clients[0]!.closed).toBe(true)
    await third
    expect(spawns).toHaveLength(2)
  })

  it('closes the child after idleMs without calls, and respawns for the next call', async () => {
    const closed: boolean[] = []
    const { spawns, svc } = makeService([], {
      env: { FAKE_TURN_MS: '150' },
      idleMs: 300,
      onSpawn: (client) => {
        const i = closed.push(false) - 1
        const close = client.close.bind(client)
        client.close = () => {
          closed[i] = true
          close()
        }
      },
    })
    await svc.transport.send(chat('one'), 10_000)
    // A call in flight (and one finishing just now) keeps the child: the idle clock only
    // runs while nothing is in flight.
    const first = svc.transport.send(chat('two'), 10_000)
    await new Promise((r) => setTimeout(r, 120))
    expect(closed).toEqual([false])
    await first
    await new Promise((r) => setTimeout(r, 50))
    expect(closed).toEqual([false])

    await new Promise((r) => setTimeout(r, 400))
    expect(closed).toEqual([true])

    const response = await svc.transport.send(chat('three'), 10_000)
    expect(response.choices[0]!.message.content).toBe('Hello from fake')
    expect(spawns).toHaveLength(2)
    expect(closed).toEqual([true, false])
  })

  it('rejects unsupported input before spawning anything', async () => {
    const { spawns, svc } = makeService([])
    const audio = chat('x', {
      messages: [
        {
          content: [{ input_audio: { data: 'A', format: 'mp3' }, type: 'input_audio' }],
          role: 'user',
        },
      ],
    })
    await expect(svc.transport.send(audio, 10_000)).rejects.toThrow(CodexUnsupportedInputError)
    expect(spawns).toHaveLength(0)
  })

  it('refuses calls after shutdown', async () => {
    const { svc } = makeService([])
    svc.onModuleDestroy()
    await expect(svc.transport.send(chat('x'), 10_000)).rejects.toThrow(/shut down/)
  })
})
