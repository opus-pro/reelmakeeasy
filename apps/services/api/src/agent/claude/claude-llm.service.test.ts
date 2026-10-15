import type { ChatTransportRequest } from '@reelmakeeasy/llm'

import type { RunQuery } from './claude-app-server'
import { ClaudeLlmService } from './claude-llm.service'

const mockResolveClaudeBinary = jest.fn(async (_options?: { sandbox?: boolean }) => '/bin/claude')
jest.mock('./claude-locator', () => ({
  resolveClaudeBinaryOrThrow: (options?: { sandbox?: boolean }) => mockResolveClaudeBinary(options),
}))

type Msg = Record<string, unknown>
type Seen = { msgs: Msg[]; options: Record<string, unknown> }

const ok = (extra: Msg = {}) => ({
  is_error: false,
  result: 'plain answer',
  subtype: 'success',
  type: 'result',
  ...extra,
})
const request = (over: Partial<ChatTransportRequest> = {}) =>
  ({ messages: [{ content: 'x', role: 'user' }], model: 'x', ...over }) as ChatTransportRequest

/** A fake query that reads the prompt, waits `delayMs`, then answers `reply`. */
function fake(reply: (seen: Seen) => Msg, delayMs = 0) {
  const seen: Seen[] = []
  let live = 0
  let peak = 0
  const runQuery = (({ options, prompt }: Parameters<RunQuery>[0]) => {
    const gen = (async function* () {
      live++
      peak = Math.max(peak, live)
      const msgs: Msg[] = []
      for await (const m of prompt) msgs.push(m as unknown as Msg)
      const s = { msgs, options: options as unknown as Record<string, unknown> }
      seen.push(s)
      await new Promise((r) => setTimeout(r, delayMs))
      live--
      yield reply(s)
    })()
    return Object.assign(gen, { interrupt: async () => undefined })
  }) as unknown as RunQuery
  return { peak: () => peak, runQuery, seen }
}

const service = (runQuery: RunQuery, maxConcurrent = 3) =>
  new ClaudeLlmService({
    binary: async () => '/bin/claude',
    maxConcurrent,
    runQuery,
    workDir: '/tmp/ly-llm',
  })

describe('ClaudeLlmService', () => {
  it('sends the system text and the user parts, and returns the text', async () => {
    const f = fake(() => ok())
    const res = await service(f.runQuery).transport.send(
      request({
        messages: [
          { content: 'You plan videos.', role: 'system' },
          {
            content: [
              { text: 'Plan it', type: 'text' },
              { image_url: { url: 'data:image/png;base64,AAAA' }, type: 'image_url' },
            ],
            role: 'user',
          },
        ],
      } as never),
      30_000,
    )
    expect(res).toEqual({ choices: [{ message: { content: 'plain answer' } }], model: 'claude' })
    expect(f.seen[0]?.options).toMatchObject({
      maxTurns: 1,
      model: 'claude-opus-5-5',
      pathToClaudeCodeExecutable: '/bin/claude',
      persistSession: false,
      settingSources: [],
      tools: [],
    })
    expect(String(f.seen[0]?.options['systemPrompt'])).toContain('You plan videos.')
    // No MCP servers, no tool can run, and a quick answer is enough.
    expect(f.seen[0]?.options).toMatchObject({
      effort: 'low',
      permissionMode: 'dontAsk',
      strictMcpConfig: true,
    })
    const canUseTool = f.seen[0]?.options['canUseTool'] as (
      n: string,
      i: unknown,
      o: unknown,
    ) => Promise<{ behavior: string }>
    await expect(canUseTool('mcp__slack__post', {}, {})).resolves.toMatchObject({
      behavior: 'deny',
    })
    await expect(canUseTool('StructuredOutput', { a: 1 }, {})).resolves.toMatchObject({
      behavior: 'allow',
    })
    expect((f.seen[0]?.msgs[0]?.['message'] as Msg)['content']).toEqual([
      { text: 'Plan it', type: 'text' },
      { source: { data: 'AAAA', media_type: 'image/png', type: 'base64' }, type: 'image' },
    ])
  })

  it('asks for structured output with the schema and returns it as JSON text', async () => {
    const f = fake(() => ok({ structured_output: { title: 'T' } }))
    const res = await service(f.runQuery).transport.send(
      request({
        response_format: {
          json_schema: {
            name: 'n',
            schema: { properties: { title: { type: 'string' } }, type: 'object' },
            strict: true,
          },
          type: 'json_schema',
        },
      } as never),
      30_000,
    )
    expect(f.seen[0]?.options).toMatchObject({
      maxTurns: 2,
      outputFormat: { type: 'json_schema' },
    })
    expect(res.choices[0]?.message.content).toBe('{"title":"T"}')
  })

  it('wraps a schema whose top level is not an object, and unwraps the answer', async () => {
    const schema = {
      anyOf: [
        { items: { type: 'object' }, type: 'array' },
        { properties: { shots: { type: 'array' } }, type: 'object' },
      ],
    }
    const f = fake(() => ok({ structured_output: { value: [{ n: 1 }, { n: 2 }] } }))
    const res = await service(f.runQuery).transport.send(
      request({
        response_format: { json_schema: { name: 'n', schema, strict: true }, type: 'json_schema' },
      } as never),
      30_000,
    )
    expect(f.seen[0]?.options['outputFormat']).toEqual({
      schema: { properties: { value: schema }, required: ['value'], type: 'object' },
      type: 'json_schema',
    })
    expect(res.choices[0]?.message.content).toBe('[{"n":1},{"n":2}]')
  })

  it('fails when a structured answer was asked for and none came back (an API error as text)', async () => {
    const f = fake(() =>
      ok({ result: 'API Error: 400 tools.1.custom.input_schema.type: Field required' }),
    )
    await expect(
      service(f.runQuery).transport.send(
        request({
          response_format: {
            json_schema: { name: 'n', schema: { type: 'object' }, strict: true },
            type: 'json_schema',
          },
        } as never),
        30_000,
      ),
    ).rejects.toThrow(/API Error: 400/)
  })

  it('fails a call Claude could not answer', async () => {
    const f = fake(() => ({
      errors: ['overloaded'],
      is_error: true,
      subtype: 'error_during_execution',
      type: 'result',
    }))
    await expect(service(f.runQuery).transport.send(request(), 30_000)).rejects.toThrow(
      /overloaded/,
    )
  })

  it('fails a turn that ended on an API error instead of passing its words on as the answer', async () => {
    const f = fake(() => ok({ is_error: true, result: 'Not logged in · Please run /login' }))
    await expect(service(f.runQuery).transport.send(request(), 30_000)).rejects.toThrow(
      "Claude Code couldn't answer: Not logged in · Please run /login",
    )
  })

  it('finds the binary without the shell sandbox, which a planning call never uses', async () => {
    const f = fake(() => ok())
    await new ClaudeLlmService({ runQuery: f.runQuery, workDir: '/tmp/ly-llm' }).transport.send(
      request(),
      30_000,
    )
    expect(mockResolveClaudeBinary).toHaveBeenCalledWith({ sandbox: false })
  })

  it('refuses audio and tool definitions', async () => {
    const f = fake(() => ok())
    const s = service(f.runQuery)
    await expect(
      s.transport.send(
        request({
          messages: [{ content: [{ input_audio: {}, type: 'input_audio' }], role: 'user' }],
        } as never),
        30_000,
      ),
    ).rejects.toThrow(/input_audio/)
    await expect(s.transport.send(request({ tools: [{}] } as never), 30_000)).rejects.toThrow(
      /tools/,
    )
  })

  it('runs at most maxConcurrent calls at once', async () => {
    const f = fake(() => ok(), 10)
    const s = service(f.runQuery, 2)
    await Promise.all([1, 2, 3, 4, 5].map(() => s.transport.send(request(), 30_000)))
    expect(f.peak()).toBe(2)
    expect(f.seen).toHaveLength(5)
  })

  it('times out a call that takes too long', async () => {
    const runQuery = (() =>
      Object.assign(
        (async function* () {
          await new Promise(() => undefined)
          yield ok()
        })(),
        { interrupt: async () => undefined },
      )) as unknown as RunQuery
    await expect(service(runQuery).transport.send(request(), 20)).rejects.toThrow(/timed out/)
  })
})
