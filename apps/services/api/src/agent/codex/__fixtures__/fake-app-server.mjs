import { spawn } from 'node:child_process'
import fs from 'node:fs'
import readline from 'node:readline'

const flags = new Set(process.argv.slice(2))
// `--hang=<method>`: never answer that method (a hung app-server).
const hang = new Set(
  process.argv
    .slice(2)
    .filter((a) => a.startsWith('--hang='))
    .map((a) => a.slice('--hang='.length)),
)

if (flags.has('--fail-start')) {
  process.stderr.write('Error: invalid transport in `mcp_servers.x`\n')
  process.exit(1)
}

const log = (m) =>
  process.env.FAKE_LOG && fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify(m) + '\n')
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n')
const threads = new Set(process.env.FAKE_THREADS ? process.env.FAKE_THREADS.split(',') : [])
// `FAKE_REPLIES` (a JSON array): the agent message of the n-th normal turn; "Hello from fake"
// once it runs out.
const replies = process.env.FAKE_REPLIES ? JSON.parse(process.env.FAKE_REPLIES) : []
let turnSeq = 0
let threadSeq = 0
const pending = new Map()
const ASK_FLAGS = [
  '--ask',
  '--ask-then-complete',
  '--ask-then-exit',
  '--ask-twice',
  '--complete-then-ask',
]

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const msg = JSON.parse(line)
  log(msg)
  // A response to our own request: the answer (or refusal) to a `--ask` question, or to a
  // `--tool-call` tool call.
  if (msg.id !== undefined && !msg.method) {
    onAskAnswered(msg)
    return onToolAnswered(msg)
  }
  if (hang.has(msg.method)) return
  if (msg.method === 'initialize')
    return out({ id: msg.id, result: { envKeys: Object.keys(process.env), userAgent: 'fake' } })
  if (msg.method === 'thread/start') {
    // Unique even for concurrent thread/starts in the same millisecond.
    const id = `thread-${Date.now()}-${++threadSeq}`
    threads.add(id)
    return out({ id: msg.id, result: { model: 'fake-model', thread: { id } } })
  }
  if (msg.method === 'thread/resume') {
    if (!threads.has(msg.params.threadId))
      return out({ error: { code: -1, message: 'no thread' }, id: msg.id })
    return out({ id: msg.id, result: { thread: { id: msg.params.threadId } } })
  }
  if (msg.method === 'turn/start') return startTurn(msg)
  if (msg.method === 'turn/interrupt') {
    const p = pending.get(msg.params.turnId)
    if (p) {
      // Codex withdraws an open question when its turn is interrupted.
      if (p.askId)
        out({
          method: 'serverRequest/resolved',
          params: { requestId: p.askId, threadId: p.threadId },
        })
      clearTimeout(p.timer)
      pending.delete(msg.params.turnId)
      out({
        method: 'turn/completed',
        params: { threadId: p.threadId, turn: { id: msg.params.turnId, status: 'interrupted' } },
      })
    }
    return out({ id: msg.id, result: {} })
  }
  if (msg.id !== undefined && msg.method)
    out({ error: { code: -32601, message: 'unknown' }, id: msg.id })
})

/** Asks the "Which tone?" question (`FAKE_ASK_PARAMS`, a JSON object, overrides its params).
 *  - `--ask`: the turn waits for the answer (or an interrupt);
 *  - `--ask-twice`: as `--ask`, plus a second request reusing the same item id;
 *  - `--ask-then-exit`: the app-server exits with the question open;
 *  - `--ask-then-complete`: the turn ends at once with the question still open;
 *  - `--complete-then-ask`: the turn ends, then the question arrives (for an idle session). */
function ask(threadId, turnId, turnDone) {
  const request = {
    id: 'ask-' + turnId,
    method: 'item/tool/requestUserInput',
    params: {
      autoResolutionMs: null,
      isBlocking: true,
      itemId: 'q-' + turnId,
      questions: [
        {
          header: 'Tone',
          id: 'tone',
          isOther: true,
          isSecret: false,
          options: [
            { description: 'Light and fun', label: 'Playful (Recommended)' },
            { description: 'Calm', label: 'Serious' },
          ],
          question: 'Which tone?',
        },
      ],
      threadId,
      turnId,
    },
  }
  if (process.env.FAKE_ASK_PARAMS)
    Object.assign(request.params, JSON.parse(process.env.FAKE_ASK_PARAMS))
  const line = (m) => JSON.stringify(m) + '\n'
  if (flags.has('--ask-then-complete')) return process.stdout.write(line(request) + line(turnDone))
  if (flags.has('--complete-then-ask')) return process.stdout.write(line(turnDone) + line(request))
  out(request)
  if (flags.has('--ask-twice')) out({ ...request, id: 'ask2-' + turnId })
  if (flags.has('--ask-then-exit')) setTimeout(() => process.exit(4), 100)
  pending.set(turnId, { askId: request.id, threadId, timer: null })
}

/** `--tool-call`: after turn/start, asks the client to run the `ping` tool (a ReelMakeEasy
 *  dynamic tool), then finishes the turn with the tool's answer as the agent message. */
function toolCall(threadId, turnId, turnDone) {
  const callId = 'exec-' + turnId
  const item = {
    arguments: { x: 'hi' },
    id: callId,
    namespace: null,
    status: 'inProgress',
    tool: 'ping',
    type: 'dynamicToolCall',
  }
  out({ method: 'item/started', params: { item, threadId, turnId } })
  const request = {
    id: 'tool-' + turnId,
    method: 'item/tool/call',
    params: { arguments: { x: 'hi' }, callId, namespace: null, threadId, tool: 'ping', turnId },
  }
  out(request)
  pending.set(turnId, { threadId, timer: null, toolId: request.id, turnDone })
}

/** The client's answer to a `--tool-call` request: the tool item completes and the turn ends
 *  with the tool's text as the agent message. */
function onToolAnswered(msg) {
  const entry = [...pending].find(([, p]) => p.toolId === msg.id)
  if (!entry) return
  const [turnId, p] = entry
  pending.delete(turnId)
  const text = msg.result?.contentItems?.[0]?.text ?? 'tool error'
  const item = {
    arguments: { x: 'hi' },
    contentItems: msg.result?.contentItems ?? null,
    id: 'exec-' + turnId,
    namespace: null,
    status: 'completed',
    success: !!msg.result?.success,
    tool: 'ping',
    type: 'dynamicToolCall',
  }
  out({ method: 'item/completed', params: { item, threadId: p.threadId, turnId } })
  out({
    method: 'item/completed',
    params: {
      item: { id: 'msg-' + turnId, text, type: 'agentMessage' },
      threadId: p.threadId,
      turnId,
    },
  })
  out(p.turnDone)
}

/** Codex's side of an answered (result) or refused (error) question: finish the turn.
 *  With `--slow-after-answer` the turn keeps working for 600 ms after an answer (it can
 *  still be interrupted meanwhile). */
function onAskAnswered(msg) {
  const entry = [...pending].find(([, p]) => p.askId === msg.id)
  if (!entry) return
  const [turnId, p] = entry
  pending.delete(turnId)
  if (msg.result) {
    const finish = () => {
      pending.delete(turnId)
      out({
        method: 'item/completed',
        params: {
          item: {
            id: 'm-' + turnId,
            text: 'answered:' + JSON.stringify(msg.result),
            type: 'agentMessage',
          },
          threadId: p.threadId,
        },
      })
      out({
        method: 'turn/completed',
        params: { threadId: p.threadId, turn: { id: turnId, status: 'completed' } },
      })
    }
    if (!flags.has('--slow-after-answer')) return finish()
    pending.set(turnId, { threadId: p.threadId, timer: setTimeout(finish, 600) })
  } else if (msg.error) {
    out({
      method: 'turn/completed',
      params: {
        threadId: p.threadId,
        turn: { error: { message: msg.error.message }, id: turnId, status: 'failed' },
      },
    })
  }
}

/** `--schema-echo` / `--reject-schema`: a pipeline LLM call. With an outputSchema the reply
 *  echoes it back as JSON (`--reject-schema` fails the turn instead, the way Codex rejects a
 *  loose schema); without one the reply is `plain:` + the first input text. */
function schemaTurn(msg) {
  const { outputSchema, threadId } = msg.params
  const turnId = `turn-${++turnSeq}`
  out({ id: msg.id, result: { turn: { id: turnId, status: 'inProgress' } } })
  out({ method: 'turn/started', params: { threadId, turn: { id: turnId, status: 'inProgress' } } })
  if (outputSchema && flags.has('--reject-schema')) {
    const message =
      "Invalid schema for response_format 'codex_output_schema': invalid_json_schema - " +
      "'additionalProperties' is required to be supplied and to be false"
    return out({
      method: 'turn/completed',
      params: { threadId, turn: { error: { message }, id: turnId, status: 'failed' } },
    })
  }
  const firstText = (msg.params.input ?? []).find((i) => i.type === 'text')?.text ?? ''
  const text = outputSchema
    ? JSON.stringify({ echoedSchema: outputSchema, note: null })
    : 'plain:' + firstText
  out({
    method: 'item/completed',
    params: { item: { id: 'm-' + turnId, text, type: 'agentMessage' }, threadId },
  })
  out({ method: 'turn/completed', params: { threadId, turn: { id: turnId, status: 'completed' } } })
}

/** Answers turn/start and plays the turn out as the flags say. */
function startTurn(msg) {
  if (flags.has('--crash-on-turn')) process.exit(3)
  if (flags.has('--schema-echo') || flags.has('--reject-schema')) return schemaTurn(msg)
  if (flags.has('--hold-stdio')) {
    // Leave behind a short-lived detached subprocess that inherits our
    // stdout/stderr, then exit - simulating Codex leaving a backgrounded
    // shell command holding the pipe open. 'close' won't fire until that
    // subprocess itself exits (here, after 3s); 'exit' fires immediately.
    const holder = spawn(process.execPath, ['-e', 'setTimeout(()=>{}, 3000)'], {
      detached: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
    holder.unref()
    process.exit(2)
  }
  const turnId = `turn-${++turnSeq}`
  const response = { id: msg.id, result: { turn: { id: turnId, status: 'inProgress' } } }
  const started = {
    method: 'turn/started',
    params: { threadId: msg.params.threadId, turn: { id: turnId, status: 'inProgress' } },
  }
  const delta = {
    method: 'item/agentMessage/delta',
    params: { delta: 'Hello', itemId: 'm-' + turnId, threadId: msg.params.threadId },
  }
  const itemDone = {
    method: 'item/completed',
    params: {
      item: {
        id: 'm-' + turnId,
        text: replies[turnSeq - 1] ?? 'Hello from fake',
        type: 'agentMessage',
      },
      threadId: msg.params.threadId,
    },
  }
  const turnDone = {
    method: 'turn/completed',
    params: { threadId: msg.params.threadId, turn: { id: turnId, status: 'completed' } },
  }
  if (ASK_FLAGS.some((f) => flags.has(f))) {
    out(response)
    out(started)
    return ask(msg.params.threadId, turnId, turnDone)
  }
  // `--fail-first-turn`: the first turn says it started, then fails (as a Claude turn whose query
  // throws before the agent saw the message).
  if (flags.has('--fail-first-turn') && turnSeq === 1) {
    out(response)
    out(started)
    return out({
      method: 'turn/completed',
      params: {
        threadId: msg.params.threadId,
        turn: {
          error: { message: 'Claude Code process exited with code 1' },
          id: turnId,
          status: 'failed',
        },
      },
    })
  }
  if (flags.has('--tool-call')) {
    out(response)
    out(started)
    return toolCall(msg.params.threadId, turnId, turnDone)
  }
  if (flags.has('--instant-turn')) {
    // Write the turn/start response and every notification for this turn as
    // ONE stdout write, so the reader gets them in a single chunk: exercises
    // a turn that completes before its own turn/start response has even
    // been awaited (each `out()` call below is a separate write, which a
    // pipe's read side can - and reliably does - see as separate chunks
    // with a microtask boundary in between).
    process.stdout.write(
      [response, started, delta, itemDone, turnDone].map((m) => JSON.stringify(m)).join('\n') +
        '\n',
    )
    return
  }
  out(response)
  out(started)
  const timer = setTimeout(
    () => {
      pending.delete(turnId)
      out(delta)
      out(itemDone)
      out(turnDone)
    },
    // FAKE_TURN_MS overrides how long a normal turn takes.
    flags.has('--slow')
      ? 5000
      : flags.has('--slow-turn')
        ? 2000
        : Number(process.env.FAKE_TURN_MS ?? 10),
  )
  pending.set(turnId, { threadId: msg.params.threadId, timer })
}
