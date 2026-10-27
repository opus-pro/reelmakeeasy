import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { DynamicToolSpec } from '../tools/agent-tools'

import {
  ClaudeAppServer,
  type ClaudeAppServerOptions,
  claudeToolPolicy,
  turnContent,
} from './claude-app-server'

type Msg = Record<string, unknown>
type ToolDef = { handler: (args: unknown, extra: unknown) => Promise<unknown>; name: string }
// The fake sees the real Options; tests read and call into them freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test double for the SDK's Options
type Call = { options: any; prompt: AsyncIterable<unknown> }

/** A fake SDK query: runs `script` for each turn; `interrupt()` flips `ctl.interrupted`. */
function fakeQuery(script: (ctl: { interrupted: boolean }) => AsyncGenerator<Msg>) {
  const calls: Call[] = []
  const run = ({ options, prompt }: Call) => {
    calls.push({ options, prompt })
    const ctl = { interrupted: false }
    return Object.assign(script(ctl), {
      interrupt: async () => {
        ctl.interrupted = true
      },
    })
  }
  return { calls, run: run as unknown as ClaudeAppServerOptions['runQuery'] }
}

const result = (extra: Msg = {}) => ({
  duration_ms: 1,
  is_error: false,
  result: 'ok',
  session_id: 's',
  subtype: 'success',
  type: 'result',
  ...extra,
})
const tick = () => new Promise((r) => setImmediate(r))
const TOOLS: DynamicToolSpec[] = [
  {
    description: 'Render',
    inputSchema: { additionalProperties: false, properties: {}, type: 'object' },
    name: 'render_video',
  },
]

function server(
  run: ClaudeAppServerOptions['runQuery'],
  extra: Partial<ClaudeAppServerOptions> = {},
) {
  let tools: ToolDef[] = []
  const s = new ClaudeAppServer({
    binary: '/bin/claude',
    buildMcpServer: (defs) => {
      tools = defs as unknown as ToolDef[]
      return { name: 'reelmakeeasy', type: 'sdk' } as never
    },
    cwd: '/w',
    editing: false,
    env: {},
    mode: 'free',
    newId: () => 'uuid-1',
    pluginDir: '/p',
    runQuery: run,
    sessionExists: async () => true,
    tools: TOOLS,
    ...extra,
  })
  const notes: Msg[] = []
  s.onNotification((n) => notes.push(n))
  return { notes, s, tool: (name: string) => tools.find((t) => t.name === name) }
}

async function startThread(s: ClaudeAppServer) {
  await s.request('initialize', {})
  return s.request<{ thread: { id: string } }>('thread/start', {
    developerInstructions: 'BRIEF',
    cwd: '/w',
  })
}

const turn = (s: ClaudeAppServer, text = 'hi', extra: Msg = {}) =>
  s.request('turn/start', { input: [{ text, type: 'text' }], threadId: 'uuid-1', ...extra })

describe('ClaudeAppServer', () => {
  it('starts a conversation with its own id, then resumes it on the next turn', async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    const { notes, s } = server(q.run)
    expect(await startThread(s)).toEqual({ thread: { id: 'uuid-1' } })
    expect(await turn(s)).toEqual({ turn: { id: 'turn-1' } })
    await tick()
    expect(q.calls[0]?.options).toMatchObject({ sessionId: 'uuid-1' })
    expect(q.calls[0]?.options.resume).toBeUndefined()
    await turn(s, 'again')
    await tick()
    expect(q.calls[1]?.options).toMatchObject({ resume: 'uuid-1' })
    expect(q.calls[1]?.options.sessionId).toBeUndefined()
    expect(notes.map((n) => n['method'])).toEqual([
      'turn/started',
      'turn/completed',
      'turn/started',
      'turn/completed',
    ])
  })

  it('resumes a stored conversation that still exists', async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    const { s } = server(q.run)
    await s.request('thread/resume', { developerInstructions: 'BRIEF', threadId: 'old' })
    await s.request('turn/start', { input: [{ text: 'x', type: 'text' }], threadId: 'old' })
    await tick()
    expect(q.calls[0]?.options).toMatchObject({ resume: 'old' })
  })

  it('fails a resume of a conversation that is gone', async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    const { s } = server(q.run, { sessionExists: async () => false })
    await expect(s.request('thread/resume', { threadId: 'old' })).rejects.toThrow(/old/)
  })

  it('passes the user message, brief, model, plugin, isolation and env', async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    const { s } = server(q.run, { env: { PATH: '/bin' }, model: 'claude-opus-5-5' })
    await startThread(s)
    await turn(s)
    await tick()
    const call = q.calls[0] as Call
    const it = call.prompt[Symbol.asyncIterator]()
    const first = await it.next()
    expect(first.value).toMatchObject({
      message: { content: 'hi', role: 'user' },
      parent_tool_use_id: null,
      type: 'user',
    })
    expect(call.options).toMatchObject({
      cwd: '/w',
      env: { PATH: '/bin' },
      includePartialMessages: true,
      model: 'claude-opus-5-5',
      pathToClaudeCodeExecutable: '/bin/claude',
      plugins: [{ path: '/p', type: 'local' }],
      settingSources: [],
      systemPrompt: { append: 'BRIEF', preset: 'claude_code', type: 'preset' },
    })
    expect(Object.keys(call.options.mcpServers)).toEqual(['reelmakeeasy'])
    expect(call.options.allowedTools).not.toContain('AskUserQuestion')
  })

  it('reports a failed turn with the reason', async () => {
    const q = fakeQuery(async function* () {
      yield result({ errors: ['rate limited'], is_error: true, subtype: 'error_during_execution' })
    })
    const { notes, s } = server(q.run)
    await startThread(s)
    await turn(s)
    await tick()
    expect(notes.at(-1)).toEqual({
      method: 'turn/completed',
      params: { turn: { error: { message: 'rate limited' }, id: 'turn-1', status: 'failed' } },
    })
  })

  it('a thrown query (e.g. signed out) is a failed turn', async () => {
    const q = fakeQuery(async function* () {
      yield* []
      throw new Error('Not logged in')
    })
    const { notes, s } = server(q.run)
    await startThread(s)
    await turn(s)
    await tick()
    expect(notes.at(-1)).toMatchObject({
      params: { turn: { error: { message: 'Not logged in' }, status: 'failed' } },
    })
  })

  it('runs a quiet turn with a schema and effort, answering with the structured output', async () => {
    const q = fakeQuery(async function* () {
      yield result({ structured_output: { ideas: ['a'] } })
    })
    const { notes, s } = server(q.run)
    await startThread(s)
    await turn(s, 'ideas', { effort: 'medium', outputSchema: { type: 'object' } })
    await tick()
    expect(q.calls[0]?.options).toMatchObject({
      effort: 'medium',
      outputFormat: { schema: { type: 'object' }, type: 'json_schema' },
    })
    expect(notes).toContainEqual({
      method: 'item/completed',
      params: { item: { id: 'turn-1:structured', text: '{"ideas":["a"]}', type: 'agentMessage' } },
    })
  })

  it('interrupts the running turn and reports it interrupted', async () => {
    let release!: () => void
    const q = fakeQuery(async function* () {
      await new Promise<void>((r) => (release = r))
      yield result({ errors: [], is_error: true, subtype: 'error_during_execution' })
    })
    const { notes, s } = server(q.run)
    await startThread(s)
    await turn(s)
    await tick()
    await s.request('turn/interrupt', { threadId: 'uuid-1', turnId: 'turn-1' })
    release()
    await tick()
    expect(notes.at(-1)).toMatchObject({ params: { turn: { status: 'interrupted' } } })
  })

  it('refuses a second turn while one runs', async () => {
    const q = fakeQuery(async function* () {
      await new Promise(() => undefined)
      yield result()
    })
    const { s } = server(q.run)
    await startThread(s)
    await turn(s)
    await expect(turn(s, 'y')).rejects.toThrow(/already running/)
  })

  it("sends ReelMakeEasy tool calls to the session's handler and returns its text", async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    const { s, tool } = server(q.run)
    const handler = jest.fn(async () => ({
      contentItems: [{ text: 'Rendering', type: 'inputText' }],
      success: true,
    }))
    s.onServerRequest(handler)
    await startThread(s)
    await turn(s)
    await tick()
    const out = await tool('render_video')?.handler({}, {})
    expect(handler).toHaveBeenCalledWith(
      'item/tool/call',
      expect.objectContaining({ arguments: {}, tool: 'render_video', turnId: 'turn-1' }),
      expect.any(String),
    )
    expect(out).toEqual({ content: [{ text: 'Rendering', type: 'text' }], isError: false })
  })

  it('answers a tool call as an error when the handler throws', async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    const { s, tool } = server(q.run)
    s.onServerRequest(async () => {
      throw new Error('Session is not running')
    })
    await startThread(s)
    await turn(s)
    await tick()
    await expect(tool('render_video')?.handler({}, {})).resolves.toEqual({
      content: [{ text: 'Session is not running', type: 'text' }],
      isError: true,
    })
  })

  it('turns AskUserQuestion into a question card and returns the answers by question text', async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    const { s } = server(q.run)
    s.onServerRequest(async (method, params: unknown) => {
      expect(method).toBe('item/tool/requestUserInput')
      expect((params as { questions: unknown[] }).questions[0]).toMatchObject({
        header: 'Camera',
        id: 'q0',
        isOther: true,
        question: 'Calm or Dynamic?',
      })
      return { answers: { q0: { answers: ['Dynamic'] } } }
    })
    await startThread(s)
    await turn(s)
    await tick()
    const questions = [
      {
        header: 'Camera',
        multiSelect: false,
        options: [
          { description: 'd', label: 'Calm' },
          { description: 'd', label: 'Dynamic' },
        ],
        question: 'Calm or Dynamic?',
      },
    ]
    const out = await q.calls[0]?.options.canUseTool(
      'AskUserQuestion',
      { questions },
      { signal: new AbortController().signal },
    )
    expect(out).toEqual({
      behavior: 'allow',
      updatedInput: { answers: { 'Calm or Dynamic?': 'Dynamic' }, questions },
    })
  })

  it('withdraws an open question when the turn is stopped', async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    const { notes, s } = server(q.run)
    s.onServerRequest(() => new Promise(() => undefined))
    await startThread(s)
    await turn(s)
    await tick()
    const ctl = new AbortController()
    const pending = q.calls[0]?.options.canUseTool(
      'AskUserQuestion',
      { questions: [{ header: 'h', options: [], question: 'q?' }] },
      { signal: ctl.signal },
    )
    ctl.abort()
    await expect(pending).resolves.toMatchObject({ behavior: 'deny', interrupt: true })
    expect(notes).toContainEqual({
      method: 'serverRequest/resolved',
      params: { requestId: expect.stringMatching(/^ask-/) },
    })
  })

  it('denies tools the mode does not allow, and allows its own', async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    const { s } = server(q.run, { mode: 'autonomous' })
    await startThread(s)
    await turn(s)
    await tick()
    const can = q.calls[0]?.options.canUseTool
    const signal = new AbortController().signal
    await expect(can('Bash', { command: 'cat ~/.ssh/id_rsa' }, { signal })).resolves.toMatchObject({
      behavior: 'deny',
    })
    await expect(can('WebSearch', { query: 'x' }, { signal })).resolves.toMatchObject({
      behavior: 'allow',
    })
  })

  it('sandboxes the shell wherever it is available', async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    for (const extra of [
      { mode: 'free' as const },
      { editing: true, mode: 'autonomous' as const },
    ]) {
      const { s } = server(q.run, extra)
      await startThread(s)
      await turn(s)
      await tick()
      expect(q.calls.at(-1)?.options.sandbox).toMatchObject({ enabled: true })
    }
    const { s } = server(q.run, { mode: 'autonomous' })
    await startThread(s)
    await turn(s)
    await tick()
    expect(q.calls.at(-1)?.options.sandbox).toBeUndefined()
  })
})

describe('ClaudeAppServer review fixes', () => {
  it('loads no MCP servers but its own, and gives chats with a shell the camera, loop and Motion Reel skills', async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    const { s } = server(q.run)
    await startThread(s)
    await turn(s)
    await tick()
    const options = q.calls[0]?.options
    expect(options).toMatchObject({ strictMcpConfig: true })
    // ReelMakeEasy's own skills first; Remotion's follow once its runtime has downloaded them.
    expect((options.skills as string[]).slice(0, 9)).toEqual([
      'reelmakeeasy:reelmakeeasy-camera',
      'reelmakeeasy:reelmakeeasy-beat-loop',
      'reelmakeeasy:reelmakeeasy-ranking',
      'reelmakeeasy:reelmakeeasy-motion-reel',
      'reelmakeeasy:reelmakeeasy-animation-2d',
      'reelmakeeasy:reelmakeeasy-animation-3d',
      'reelmakeeasy:reelmakeeasy-animation-8bit',
      'reelmakeeasy:reelmakeeasy-animation-avatar',
      'reelmakeeasy:reelmakeeasy-music-composer',
    ])
    for (const skill of (options.skills as string[]).slice(9))
      expect(skill).toMatch(/^reelmakeeasy:remotion-/)
    expect(options.tools).toContain('Skill')
    const signal = new AbortController().signal
    for (const skill of options.skills as string[])
      await expect(options.canUseTool('Skill', { skill }, { signal })).resolves.toMatchObject({
        behavior: 'allow',
      })
  })

  it('lets a quiet turn give its structured answer in Easy', async () => {
    const q = fakeQuery(async function* () {
      yield result()
    })
    const { s } = server(q.run, { mode: 'autonomous' })
    await startThread(s)
    await turn(s)
    await tick()
    const signal = new AbortController().signal
    await expect(
      q.calls[0]?.options.canUseTool('StructuredOutput', { a: 1 }, { signal }),
    ).resolves.toMatchObject({ behavior: 'allow' })
  })

  it('says nothing more once closed, even when the turn ends later', async () => {
    let release!: () => void
    const q = fakeQuery(async function* () {
      await new Promise<void>((r) => (release = r))
      yield result()
    })
    const { notes, s } = server(q.run)
    const handler = jest.fn(async () => ({ answers: {} }))
    s.onServerRequest(handler)
    await startThread(s)
    await turn(s)
    await tick()
    s.close()
    expect(q.calls[0]?.options.abortController.signal.aborted).toBe(true)
    release()
    await tick()
    expect(notes.map((n) => n['method'])).toEqual(['turn/started'])
    await q.calls[0]?.options.canUseTool(
      'AskUserQuestion',
      { questions: [] },
      { signal: new AbortController().signal },
    )
    expect(handler).not.toHaveBeenCalled()
  })

  it('ends a turn the CLI does not stop after an interrupt', async () => {
    const q = fakeQuery(async function* () {
      await new Promise(() => undefined)
      yield result()
    })
    const { notes, s } = server(q.run, { interruptGraceMs: 20 })
    await startThread(s)
    await turn(s)
    await tick()
    await s.request('turn/interrupt', { threadId: 'uuid-1', turnId: 'turn-1' })
    await new Promise((r) => setTimeout(r, 60))
    expect(q.calls[0]?.options.abortController.signal.aborted).toBe(true)
    expect(notes.at(-1)).toMatchObject({ params: { turn: { status: 'interrupted' } } })
  })
})

describe('quiet turns with a schema', () => {
  it('wrap a non-object schema and post the unwrapped answer', async () => {
    const q = fakeQuery(async function* () {
      yield result({ structured_output: { value: ['a', 'b'] } })
    })
    const { notes, s } = server(q.run)
    await startThread(s)
    await turn(s, 'list', { outputSchema: { items: { type: 'string' }, type: 'array' } })
    await tick()
    expect(q.calls[0]?.options.outputFormat.schema).toMatchObject({
      properties: { value: { type: 'array' } },
      type: 'object',
    })
    expect(notes).toContainEqual(
      expect.objectContaining({
        params: { item: expect.objectContaining({ text: '["a","b"]', type: 'agentMessage' }) },
      }),
    )
  })

  it('fail when no structured answer came back', async () => {
    const q = fakeQuery(async function* () {
      yield result({ result: 'API Error: 400 bad schema' })
    })
    const { notes, s } = server(q.run)
    await startThread(s)
    await turn(s, 'x', { outputSchema: { type: 'object' } })
    await tick()
    expect(notes.at(-1)).toMatchObject({
      params: {
        turn: { error: { message: expect.stringMatching(/API Error: 400/) }, status: 'failed' },
      },
    })
  })
})

describe('question ids', () => {
  it('never repeat across the Claude processes of one chat (a restart starts a new one)', async () => {
    const ids: string[] = []
    for (const _ of [1, 2]) {
      const q = fakeQuery(async function* () {
        yield result()
      })
      const { s } = server(q.run)
      s.onServerRequest(async (_m, params) => {
        ids.push((params as { itemId: string }).itemId)
        return { answers: { q0: { answers: ['x'] } } }
      })
      await startThread(s)
      await turn(s)
      await tick()
      await q.calls[0]?.options.canUseTool(
        'AskUserQuestion',
        { questions: [{ header: 'h', options: [], question: 'q?' }] },
        { signal: new AbortController().signal },
      )
    }
    expect(ids).toHaveLength(2)
    expect(ids[0]).not.toBe(ids[1])
  })
})

describe('claudeToolPolicy', () => {
  it('gives Easy web search and no shell, the other modes the shell and no web', () => {
    expect(claudeToolPolicy('autonomous', false).builtIn).toEqual(['WebFetch', 'WebSearch'])
    for (const p of [
      claudeToolPolicy('free', false),
      claudeToolPolicy(undefined, false),
      claudeToolPolicy('autonomous', true),
    ]) {
      expect(p.builtIn).toContain('Bash')
      expect(p.builtIn).toContain('AskUserQuestion')
      expect(p.builtIn).not.toContain('WebSearch')
      expect(p.allowed).not.toContain('AskUserQuestion')
    }
  })
})

describe('turnContent', () => {
  it('keeps a text-only turn as plain text', () => {
    expect(turnContent([{ text: 'hi', type: 'text' }])).toBe('hi')
  })

  it('adds each attached picture as an image block, skipping ones Claude cannot take', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-turn-'))
    try {
      const png = path.join(dir, 'a.png')
      fs.writeFileSync(png, 'png')
      const big = path.join(dir, 'big.jpg')
      fs.writeFileSync(big, Buffer.alloc(5 * 1024 * 1024 + 1))
      fs.writeFileSync(path.join(dir, 'c.heic'), 'heic')
      expect(
        turnContent([
          { text: 'look', type: 'text' },
          { path: png, type: 'localImage' },
          { path: big, type: 'localImage' },
          { path: path.join(dir, 'c.heic'), type: 'localImage' },
          { path: path.join(dir, 'missing.png'), type: 'localImage' },
        ]),
      ).toEqual([
        { text: 'look', type: 'text' },
        {
          source: {
            data: Buffer.from('png').toString('base64'),
            media_type: 'image/png',
            type: 'base64',
          },
          type: 'image',
        },
      ])
    } finally {
      fs.rmSync(dir, { force: true, recursive: true })
    }
  })
})
