import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { NotFoundException } from '@nestjs/common'
import type {
  AgentAnswers,
  AgentMode,
  AgentResumeAction,
  AgentSession,
  AgentUiEvent,
} from '@shared/types/api/agent'
import { isRankingTopicQuestion } from '@shared/types/api/agent'

import type { AgentAppServer } from './claude/agent-app-server'
import { buildAppServerArgs } from './codex/codex-config'
import { CodexRpcClient } from './codex/codex-rpc'
import { briefFor, kickoffFor, rankingKickoff } from './agent-brief'

const AUTONOMOUS_BRIEF = briefFor({ mode: 'autonomous' }, 'codex')
const FREE_CHAT_BRIEF = briefFor({ mode: 'free' }, 'codex')
const FREE_CHAT_KICKOFF = kickoffFor('codex')
import {
  AgentFlowCancelledError,
  AgentSessionBusyError,
  AgentSessionService,
  appServerArgsForMode,
  FlowActiveError,
  HarnessNotReadyError,
  InvalidAnswerError,
  ModeAlreadyChosenError,
  ModeNotChattableError,
  NotResumableError,
  PickTopicFirstError,
  QuestionNotOpenError,
  QuestionReplacedError,
  ShuttingDownError,
  type SpawnOptions,
  UnknownAttachmentError,
} from './agent-session.service'
import { AgentSessionStore } from './agent-session.store'

const FAKE = path.join(__dirname, 'codex', '__fixtures__', 'fake-app-server.mjs')

/** What the Codex-era tests check of a spawn: the mode, and editing when set (the harness and
 *  tool list are checked in the harness tests). */
const codexSpawnOpts = ({ harness: _harness, tools: _tools, ...rest }: SpawnOptions) => rest

const never = (): never => {
  throw new Error('not spawned in this test')
}

let services: AgentSessionService[] = []
/** Every `spawnCodex` call's options, in order, across the services `makeService` built. */
let spawnOpts: { mode: AgentMode | undefined }[] = []

/** Every event a chat has so far (its subscription replays them at once). */
function eventsOf(svc: AgentSessionService, id: string): AgentUiEvent[] {
  const events: AgentUiEvent[] = []
  svc.subscribe(id, 0, (e) => events.push(e))()
  return events
}

function makeService(
  root: string,
  flags: string[] = [],
  env: Record<string, string> = {},
  idleMs?: number,
  requestTimeoutsMs?: Record<string, number>,
) {
  const svc = new AgentSessionService({
    idleMs,
    root,
    spawnCodex: async (cwd, opts) => {
      spawnOpts.push(codexSpawnOpts(opts))
      Object.assign(process.env, env)
      return CodexRpcClient.spawn(process.execPath, [FAKE, ...flags], { cwd, requestTimeoutsMs })
    },
  })
  services.push(svc)
  return svc
}

const waitFor = async (fn: () => boolean, ms = 3000) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** Read the fake app-server's request log as parsed JSON-RPC messages. */
const readLog = (log: string) =>
  fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l) as { method?: string; params?: Record<string, unknown> })

afterEach(() => {
  delete process.env.FAKE_LOG
  delete process.env.FAKE_THREADS
  delete process.env.FAKE_ASK_PARAMS
  delete process.env.FAKE_TURN_MS
  for (const svc of services) svc.onModuleDestroy()
  services = []
  spawnOpts = []
})

describe('AgentSessionService', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-'))

  it('runs a turn and streams mapped events to subscribers', async () => {
    const svc = makeService(root)
    const session = await svc.createSession({ title: 'Bees' })
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))
    await svc.sendMessage(session.id, 'hi')
    await waitFor(() => events.some((e) => e.type === 'turn' && e.status === 'completed'))
    expect(events.map((e) => e.type)).toEqual([
      'user_message',
      'turn',
      'text_delta',
      'message',
      'turn',
    ])
    expect(svc.getSession(session.id)).toMatchObject({
      status: 'idle',
      threadId: expect.stringMatching(/^thread-/),
    })
  })

  it('resumes the saved thread, with its session policy, after a restart', async () => {
    const first = makeService(root)
    const session = await first.createSession()
    await first.sendMessage(session.id, 'one')
    await waitFor(() => first.getSession(session.id).status === 'idle')
    const { threadId } = first.getSession(session.id)
    first.onModuleDestroy()

    const log = path.join(root, 'fake-log.jsonl')
    const second = makeService(root, [], { FAKE_LOG: log, FAKE_THREADS: threadId! })
    await second.sendMessage(session.id, 'two')
    await waitFor(() => second.getSession(session.id).status === 'idle')
    const entries = readLog(log)
    const methods = entries.map((e) => e.method)
    expect(methods).toContain('thread/resume')
    expect(methods).not.toContain('thread/start')
    const resume = entries.find((e) => e.method === 'thread/resume')
    expect(resume?.params).toMatchObject({
      approvalPolicy: 'never',
      sandbox: 'workspace-write',
      threadId,
    })
    expect(typeof resume?.params?.['cwd']).toBe('string')
  })

  it('marks the session stopped when Codex crashes, and recovers on the next message', async () => {
    const crashing = makeService(root, ['--crash-on-turn'])
    const session = await crashing.createSession()
    const events: AgentUiEvent[] = []
    crashing.subscribe(session.id, 0, (e) => events.push(e))
    await crashing.sendMessage(session.id, 'boom').catch(() => undefined)
    await waitFor(() => crashing.getSession(session.id).status === 'stopped')
    expect(events).toContainEqual(expect.objectContaining({ status: 'stopped', type: 'session' }))

    const { threadId } = crashing.getSession(session.id)
    const recovered = makeService(root, [], { FAKE_THREADS: threadId! })
    await recovered.sendMessage(session.id, 'again')
    await waitFor(() => recovered.getSession(session.id).status === 'idle')
    expect(recovered.getSession(session.id).status).toBe('idle')
  })

  it('interrupts a running turn', async () => {
    const svc = makeService(root, ['--slow'])
    const session = await svc.createSession()
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))
    await svc.sendMessage(session.id, 'long')
    await svc.interrupt(session.id)
    await waitFor(() => events.some((e) => e.type === 'turn' && e.status === 'interrupted'))
    expect(events).toContainEqual(expect.objectContaining({ status: 'interrupted', type: 'turn' }))
    expect(svc.getSession(session.id).status).toBe('idle')
  })

  it('stops an idle child after idleMs', async () => {
    const svc = makeService(root, [], {}, 200)
    const session = await svc.createSession()
    await svc.sendMessage(session.id, 'hi')
    await waitFor(() => svc.getSession(session.id).status === 'idle')
    await waitFor(() => !svc.isRunning(session.id), 2000)
    expect(svc.isRunning(session.id)).toBe(false)
  })

  it('spawns exactly one child and thread for two concurrent sendMessage calls', async () => {
    const log = path.join(root, 'fake-log-concurrent.jsonl')
    const svc = makeService(root, [], { FAKE_LOG: log })
    const session = await svc.createSession()

    const results = await Promise.allSettled([
      svc.sendMessage(session.id, 'a'),
      svc.sendMessage(session.id, 'b'),
    ])
    await waitFor(() => svc.getSession(session.id).status === 'idle')

    const methods = readLog(log).map((e) => e.method)
    expect(methods.filter((m) => m === 'initialize')).toHaveLength(1)
    expect(methods.filter((m) => m === 'thread/start')).toHaveLength(1)

    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    for (const r of rejected) expect(r.reason).toBeInstanceOf(AgentSessionBusyError)
  })

  it('handles a turn that completes in the same chunk as its own start response', async () => {
    const svc = makeService(root, ['--instant-turn'])
    const session = await svc.createSession()
    await svc.sendMessage(session.id, 'fast')
    await waitFor(() => svc.getSession(session.id).status === 'idle')
    expect(svc.getSession(session.id).status).toBe('idle')

    // The session must not be stuck `running`/busy: a second message on the
    // same session has to succeed rather than throw AgentSessionBusyError.
    await svc.sendMessage(session.id, 'fast again')
    await waitFor(() => svc.getSession(session.id).status === 'idle')
    expect(svc.getSession(session.id).status).toBe('idle')
  })

  it('resets a session persisted as running to stopped on construction, and says why', () => {
    const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-stale-'))
    const store = new AgentSessionStore(staleRoot)
    const session = store.create({ id: randomUUID(), title: 'Stale' })
    store.update(session.id, { status: 'running' })

    const svc = makeService(staleRoot)
    expect(svc.getSession(session.id).status).toBe('stopped')
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))
    expect(events).toEqual([
      { id: 1, reason: 'ReelMakeEasy restarted', status: 'stopped', type: 'session' },
    ])
  })

  it("keeps a stale session's updatedAt across the restart that reconciles it: a restart is not activity", () => {
    const staleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-stale-touch-'))
    const store = new AgentSessionStore(staleRoot)
    const session = store.create({ id: randomUUID(), title: 'Stale' })
    const stale = store.update(session.id, { status: 'running' })

    const svc = makeService(staleRoot)

    expect(svc.getSession(session.id)).toMatchObject({ status: 'stopped' })
    expect(svc.getSession(session.id).updatedAt).toBe(stale.updatedAt)
  })

  describe('mode', () => {
    // `chooseMode` only ever attaches detached work through `.catch(...)`, synchronously,
    // the same tick it starts it - so none of these tests should ever leave a rejection
    // unhandled. Guard the whole block for it, the way the old fire-and-forget `greet()`
    // (called from `createSession`) relied on the same pattern.
    const unhandled: unknown[] = []
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason)

    beforeAll(() => process.on('unhandledRejection', onUnhandledRejection))
    afterAll(() => process.off('unhandledRejection', onUnhandledRejection))
    afterEach(async () => {
      // Give Node a tick to report a rejection that only became unhandled after the test's
      // own awaits settled. Throw (rather than `expect`, which eslint's jest/no-standalone-expect
      // forbids outside a test block) so a leak still fails the test that caused it.
      await new Promise((r) => setImmediate(r))
      const caught = unhandled.splice(0)
      if (caught.length) throw new Error(`Unhandled rejection(s): ${caught.map(String).join(', ')}`)
    })

    it('spawns nothing until a mode is chosen', async () => {
      const log = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-nogreet-')),
        'log.jsonl',
      )
      const svc = makeService(root, [], { FAKE_LOG: log })
      const session = await svc.createSession()

      expect(fs.existsSync(log)).toBe(false)
      expect(svc.isRunning(session.id)).toBe(false)
      expect(session.mode).toBeUndefined()
    })

    it('free: emits mode then runs the hidden kickoff turn, with no user message', async () => {
      const log = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-free-events-')),
        'log.jsonl',
      )
      const svc = makeService(root, [], { FAKE_LOG: log })
      const session = await svc.createSession()
      const events: AgentUiEvent[] = []
      svc.subscribe(session.id, 0, (e) => events.push(e))

      await svc.chooseMode(session.id, 'free')
      await waitFor(() => events.some((e) => e.type === 'message'))
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      expect(events.map((e) => e.type)).toEqual([
        'mode',
        'session',
        'turn',
        'text_delta',
        'message',
        'turn',
      ])
      expect(events[0]).toEqual({ id: expect.any(Number), mode: 'free', type: 'mode' })
      expect(events[1]).toMatchObject({ status: 'running', type: 'session' })
      expect(events[1]).not.toHaveProperty('reason')
      expect(events.some((e) => e.type === 'user_message')).toBe(false)
    })

    it('a chat saved in the removed Guided mode carries on as Free chat after a restart', async () => {
      const log = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-guided-')),
        'log.jsonl',
      )
      const first = makeService(root)
      const session = await first.createSession()
      first.onModuleDestroy()
      // What an older ReelMakeEasy saved for a Guided chat.
      const file = path.join(root, 'sessions.json')
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
      saved[session.id] = { ...saved[session.id], harness: 'codex', mode: 'guided' }
      fs.writeFileSync(file, JSON.stringify(saved))

      const svc = makeService(root, [], { FAKE_LOG: log })
      expect(svc.getSession(session.id).mode).toBe('free')
      await svc.sendMessage(session.id, 'Make it about bees')
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      const threadStart = readLog(log).find((e) => e.method === 'thread/start')
      expect(threadStart?.params?.['developerInstructions']).toBe(FREE_CHAT_BRIEF)
      expect(spawnOpts).toEqual([{ mode: 'free' }])
      // A mode is already set, so the welcome card can't start another one.
      await expect(svc.chooseMode(session.id, 'autonomous')).rejects.toBeInstanceOf(
        ModeAlreadyChosenError,
      )
    })

    it('free: runs the hidden kickoff turn with the free-chat brief and kickoff text', async () => {
      const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-free-')), 'log.jsonl')
      const svc = makeService(root, [], { FAKE_LOG: log })
      const session = await svc.createSession()

      await svc.chooseMode(session.id, 'free')
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      expect(svc.getSession(session.id).mode).toBe('free')
      const entries = readLog(log)
      const turnStart = entries.find((e) => e.method === 'turn/start')
      expect(turnStart?.params?.['input']).toEqual([{ text: FREE_CHAT_KICKOFF, type: 'text' }])
      const threadStart = entries.find((e) => e.method === 'thread/start')
      expect(threadStart?.params?.['developerInstructions']).toBe(FREE_CHAT_BRIEF)
      expect(threadStart?.params?.['sandbox']).toBe('workspace-write')
      expect(spawnOpts).toEqual([{ mode: 'free' }])
    })

    it('ranking: runs its kickoff (on the ranking it was opened on) with the ranking brief and tools', async () => {
      const log = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-ranking-')),
        'log.jsonl',
      )
      const svc = makeService(root, [], { FAKE_LOG: log })
      const rankingId = '11111111-2222-3333-4444-555555555555'
      const session = await svc.createSession({ rankingId })
      const events: string[] = []
      svc.subscribe(session.id, 0, (e) => events.push(e.type))

      await svc.chooseMode(session.id, 'ranking')
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      const entries = readLog(log)
      const turnStart = entries.find((e) => e.method === 'turn/start')
      expect(turnStart?.params?.['input']).toEqual([
        { text: rankingKickoff('codex', rankingId), type: 'text' },
      ])
      const threadStart = entries.find((e) => e.method === 'thread/start')
      expect(threadStart?.params?.['developerInstructions']).toBe(
        briefFor({ mode: 'ranking' }, 'codex'),
      )
      const tools = (threadStart?.params?.['dynamicTools'] as { name: string }[]).map((t) => t.name)
      expect(tools.every((t) => t.startsWith('ranking_'))).toBe(true)

      svc.followRanking(session.id, '99999999-2222-3333-4444-555555555555')
      expect(svc.getSession(session.id).rankingId).toBe('99999999-2222-3333-4444-555555555555')
      expect(events).toContain('ranking')
    })

    it('ranking: a request typed in the studio is the first message, and the first turn does it', async () => {
      const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-ask-')), 'log.jsonl')
      const svc = makeService(root, [], { FAKE_LOG: log })
      const rankingId = '11111111-2222-3333-4444-555555555555'
      const session = await svc.createSession({ rankingId })
      const shown: string[] = []
      svc.subscribe(session.id, 0, (e) => {
        if (e.type === 'user_message') shown.push(e.text)
      })

      await svc.chooseMode(session.id, 'ranking', undefined, 'Add a boom when the dog falls on #2')
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      expect(shown).toEqual(['Add a boom when the dog falls on #2'])
      expect(svc.getSession(session.id).title).toBe('Add a boom when the dog falls on #2')
      const turnStart = readLog(log).find((e) => e.method === 'turn/start')
      expect(turnStart?.params?.['input']).toEqual([
        {
          text: rankingKickoff('codex', rankingId, false, 'Add a boom when the dog falls on #2'),
          type: 'text',
        },
      ])
    })

    it('ranking easy: asks the topic with its own card, then starts the agent on the answer', async () => {
      const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-easy-')), 'log.jsonl')
      const svc = makeService(root, [], { FAKE_LOG: log })
      const session = await svc.createSession()
      const events: AgentUiEvent[] = []
      svc.subscribe(session.id, 0, (e) => events.push(e))

      await svc.chooseMode(session.id, 'ranking_easy')
      const card = events.find((e) => e.type === 'question')
      expect(card).toMatchObject({ server: true })
      const cardId = card?.type === 'question' ? card.questionId : ''
      expect(isRankingTopicQuestion(cardId)).toBe(true)
      const question = card?.type === 'question' ? card.questions[0] : undefined
      expect(question?.isOther).toBe(true)
      expect(question?.options).toHaveLength(4)
      // Nothing runs until it is answered: no agent has even started.
      expect(fs.existsSync(log)).toBe(false)

      // The recommended pick: its mark stays on the card, not in the topic.
      const recommended = question?.options[0]?.label ?? ''
      expect(recommended).toMatch(/ \(Recommended\)$/)
      svc.answerQuestion(session.id, cardId, { topic: [recommended] })
      await waitFor(() => fs.existsSync(log) && readLog(log).some((e) => e.method === 'turn/start'))
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      const entries = readLog(log)
      expect(entries.find((e) => e.method === 'turn/start')?.params?.['input']).toEqual([
        {
          text: rankingKickoff('codex', undefined, true, 'Guiltiest dogs caught in the act'),
          type: 'text',
        },
      ])
      expect(svc.getSession(session.id).title).toBe('Guiltiest dogs caught in the act')
      const threadStart = entries.find((e) => e.method === 'thread/start')
      expect(threadStart?.params?.['developerInstructions']).toBe(
        briefFor({ mode: 'ranking_easy' }, 'codex'),
      )
      const tools = (threadStart?.params?.['dynamicTools'] as { name: string }[]).map((t) => t.name)
      expect(tools).toContain('ranking_add_sound')
    })

    it('ranking easy: a message typed instead of answering the topic card is the topic', async () => {
      const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-easy2-')), 'log.jsonl')
      const svc = makeService(root, [], { FAKE_LOG: log })
      const session = await svc.createSession()
      const events: AgentUiEvent[] = []
      svc.subscribe(session.id, 0, (e) => events.push(e))

      await svc.chooseMode(session.id, 'ranking_easy')
      const card = events.find((e) => e.type === 'question')
      const cardId = card?.type === 'question' ? card.questionId : ''
      // Files alone can't say what it's about: refused, and the card stays.
      await expect(svc.sendMessage(session.id, '')).rejects.toBeInstanceOf(PickTopicFirstError)
      expect(events.some((e) => e.type === 'question_expired')).toBe(false)

      await svc.sendMessage(session.id, 'Cats who steal food')
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      expect(events).toContainEqual(
        expect.objectContaining({ questionId: cardId, type: 'question_expired' }),
      )
      // It starts the guided flow exactly as a picked topic does.
      const starts = readLog(log).filter((e) => e.method === 'turn/start')
      expect(starts).toHaveLength(1)
      expect(starts[0]?.params?.['input']).toEqual([
        { text: rankingKickoff('codex', undefined, true, 'Cats who steal food'), type: 'text' },
      ])
    })

    it('ranking easy: a picked topic the agent never got goes ahead of the next message', async () => {
      // The agent can't start, so the picked topic never reaches it.
      const broken = makeService(root, ['--fail-start'])
      const session = await broken.createSession()
      await broken.chooseMode(session.id, 'ranking_easy')
      const card = eventsOf(broken, session.id).find((e) => e.type === 'question')
      const cardId = card?.type === 'question' ? card.questionId : ''
      broken.answerQuestion(session.id, cardId, { topic: ['Worst parking jobs ever'] })
      await waitFor(() =>
        eventsOf(broken, session.id).some((e) => e.type === 'session' && e.status === 'stopped'),
      )

      const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-lost-')), 'log.jsonl')
      const svc = makeService(root, [], { FAKE_LOG: log })
      await svc.sendMessage(session.id, 'Use my clips')
      await waitFor(() => svc.getSession(session.id).status === 'idle')
      await svc.sendMessage(session.id, 'Make it 4 ranks')
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      const inputs = readLog(log)
        .filter((e) => e.method === 'turn/start')
        .map((e) => e.params?.['input'])
      expect(inputs).toEqual([
        [
          {
            text: `${rankingKickoff('codex', undefined, true, 'Worst parking jobs ever')}\n\nUse my clips`,
            type: 'text',
          },
        ],
        // Once a turn completed, the agent has it: later messages go as they are.
        [{ text: 'Make it 4 ranks', type: 'text' }],
      ])
    })

    it('ranking easy: a topic whose turn started but failed goes again with the next message', async () => {
      // A Claude turn says it started before its query runs; the query can then fail before
      // the agent ever saw the topic.
      const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-fail1-')), 'log.jsonl')
      const svc = makeService(root, ['--fail-first-turn'], { FAKE_LOG: log })
      const session = await svc.createSession()
      await svc.chooseMode(session.id, 'ranking_easy')
      const card = eventsOf(svc, session.id).find((e) => e.type === 'question')
      const cardId = card?.type === 'question' ? card.questionId : ''
      svc.answerQuestion(session.id, cardId, { topic: ['Worst parking jobs ever'] })
      await waitFor(() =>
        eventsOf(svc, session.id).some((e) => e.type === 'turn' && e.status === 'failed'),
      )
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      await svc.sendMessage(session.id, 'go')
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      const inputs = readLog(log)
        .filter((e) => e.method === 'turn/start')
        .map((e) => e.params?.['input'])
      const kickoff = rankingKickoff('codex', undefined, true, 'Worst parking jobs ever')
      expect(inputs).toEqual([
        [{ text: kickoff, type: 'text' }],
        [{ text: `${kickoff}\n\ngo`, type: 'text' }],
      ])
    })

    /** Backdates a chat's `updatedAt` on disk, so a bump would show. */
    const backdate = (id: string, updatedAt: string) => {
      const file = path.join(root, 'sessions.json')
      const all = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, AgentSession>
      fs.writeFileSync(file, JSON.stringify({ ...all, [id]: { ...all[id], updatedAt } }))
    }

    it('ranking easy: after a restart, a chat still waiting on its topic keeps its card, answerable', async () => {
      const svc = makeService(root)
      const session = await svc.createSession()
      await svc.chooseMode(session.id, 'ranking_easy')
      const before = eventsOf(svc, session.id)
      const first = before.find((e) => e.type === 'question')
      const firstId = first?.type === 'question' ? first.questionId : ''
      backdate(session.id, '2026-09-01T00:00:00.000Z')

      // A new process on the same data (the old one died without a clean shutdown), twice:
      // the same card stays, nothing is added, and the chat keeps its place in the list.
      makeService(root)
      const again = makeService(root)
      expect(eventsOf(again, session.id)).toEqual(before)
      expect(again.getSession(session.id).updatedAt).toBe('2026-09-01T00:00:00.000Z')

      // The card still answers, and an answered one is not asked again on the next start.
      const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-rearm-')), 'log.jsonl')
      const answering = makeService(root, [], { FAKE_LOG: log })
      answering.answerQuestion(session.id, firstId, { topic: ['Worst parking jobs ever'] })
      await waitFor(() => fs.existsSync(log) && readLog(log).some((e) => e.method === 'turn/start'))
      await waitFor(() => answering.getSession(session.id).status === 'idle')
      const third = makeService(root)
      expect(eventsOf(third, session.id).filter((e) => e.type === 'question')).toHaveLength(1)
    })

    it('ranking easy: a clean shutdown leaves the topic card for the next start', async () => {
      const svc = makeService(root)
      const session = await svc.createSession()
      await svc.chooseMode(session.id, 'ranking_easy')
      svc.onModuleDestroy()
      expect(eventsOf(svc, session.id).some((e) => e.type === 'question_expired')).toBe(false)
    })

    it('ranking easy: after a restart, a chat whose topic card had expired gets a new one, quietly', async () => {
      const svc = makeService(root)
      const session = await svc.createSession()
      await svc.chooseMode(session.id, 'ranking_easy')
      const first = eventsOf(svc, session.id).find((e) => e.type === 'question')
      const firstId = first?.type === 'question' ? first.questionId : ''
      // An older build expired it on shutdown.
      svc['store'].append(session.id, { questionId: firstId, type: 'question_expired' })
      backdate(session.id, '2026-09-01T00:00:00.000Z')

      const again = makeService(root)
      const asked = eventsOf(again, session.id).filter((e) => e.type === 'question')
      expect(asked).toHaveLength(2)
      const newId = asked[1]?.type === 'question' ? asked[1].questionId : ''
      expect(isRankingTopicQuestion(newId)).toBe(true)
      expect(newId).not.toBe(firstId)
      expect(again.getSession(session.id).updatedAt).toBe('2026-09-01T00:00:00.000Z')
      // The next start keeps that one.
      expect(
        eventsOf(makeService(root), session.id).filter((e) => e.type === 'question'),
      ).toHaveLength(2)
    })

    it('sends attached files: their paths in the text, pictures as localImage, shown with the message', async () => {
      const log = path.join(
        fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-attach-')),
        'log.jsonl',
      )
      const svc = makeService(root, [], { FAKE_LOG: log })
      const session = await svc.createSession()
      await svc.chooseMode(session.id, 'free')
      await waitFor(() => svc.getSession(session.id).status === 'idle')
      const dir = svc.attachmentsDir(session.id)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'shot-a1.png'), 'png')
      fs.writeFileSync(path.join(dir, 'song-b2.mp3'), 'mp3')
      const events: AgentUiEvent[] = []
      svc.subscribe(session.id, 0, (e) => events.push(e))

      await expect(svc.sendMessage(session.id, 'hi', ['nope.png'])).rejects.toBeInstanceOf(
        UnknownAttachmentError,
      )
      await svc.sendMessage(session.id, 'Use these', ['shot-a1.png', 'song-b2.mp3'])
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      const png = fs.realpathSync(path.join(dir, 'shot-a1.png'))
      const mp3 = fs.realpathSync(path.join(dir, 'song-b2.mp3'))
      const turns = readLog(log).filter((e) => e.method === 'turn/start')
      expect(turns.at(-1)?.params?.['input']).toEqual([
        {
          text: `Use these\n\nThe user attached these files (saved on this computer; open them from these paths):\n- ${png} (image, 3 B)\n- ${mp3} (audio, 3 B)`,
          type: 'text',
        },
        { path: png, type: 'localImage' },
      ])
      expect(events.filter((e) => e.type === 'user_message')).toEqual([
        expect.objectContaining({
          attachments: [
            { kind: 'image', name: 'shot-a1.png', path: png, size: 3 },
            { kind: 'audio', name: 'song-b2.mp3', path: mp3, size: 3 },
          ],
          text: 'Use these',
        }),
      ])
    })

    it("runs a free chat's turns on its model: the chat's pick, else what the catalog says", async () => {
      const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-model-')), 'log.jsonl')
      const choiceFor = jest.fn(
        (_harness: string, chat?: { effort?: string; model: string }) =>
          chat ?? { effort: 'medium', model: 'gpt-6-astra' },
      )
      const svc = new AgentSessionService({
        chatModels: { choiceFor },
        root,
        spawnCodex: async (cwd) => {
          Object.assign(process.env, { FAKE_LOG: log })
          return CodexRpcClient.spawn(process.execPath, [FAKE], { cwd })
        },
      })
      services.push(svc)
      const session = await svc.createSession()
      await svc.chooseMode(session.id, 'free')
      await waitFor(() => svc.getSession(session.id).status === 'idle')
      svc.setChatModel(session.id, { effort: 'high', model: 'gpt-6-sol' })
      await svc.sendMessage(session.id, 'hi')
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      const turns = readLog(log).filter((e) => e.method === 'turn/start')
      expect(turns[0]?.params).toMatchObject({ effort: 'medium', model: 'gpt-6-astra' })
      expect(turns[1]?.params).toMatchObject({ effort: 'high', model: 'gpt-6-sol' })
      expect(choiceFor).toHaveBeenLastCalledWith('codex', { effort: 'high', model: 'gpt-6-sol' })
      expect(svc.setChatModel(session.id, null).chatModel).toBeUndefined()
    })

    it('runs every mode on the picked model; a turn that sets its own thinking level keeps it', async () => {
      const choiceFor = jest.fn(
        (_h: string, chat?: { effort?: string; model: string }) =>
          chat ?? { effort: 'medium', model: 'gpt-6-astra' },
      )
      const svc = new AgentSessionService({ chatModels: { choiceFor }, root })
      services.push(svc)
      const session = await svc.createSession()
      const turnModel = (
        svc as never as { turnModel: (id: string, p: object) => object }
      ).turnModel.bind(svc)
      svc['store'].update(session.id, { mode: 'autonomous' })
      expect(turnModel(session.id, { effort: 'low' })).toEqual({ model: 'gpt-6-astra' })
      expect(turnModel(session.id, {})).toEqual({ effort: 'medium', model: 'gpt-6-astra' })
      svc.setChatModel(session.id, { effort: 'high', model: 'claude-haiku-5-5' })
      expect(turnModel(session.id, { effort: 'low' })).toEqual({ model: 'claude-haiku-5-5' })
      svc['store'].update(session.id, { mode: 'free' })
      expect(turnModel(session.id, {})).toEqual({ effort: 'high', model: 'claude-haiku-5-5' })
    })

    it('spawn args by mode: autonomous searches the web with no shell; free chat never searches', () => {
      expect(appServerArgsForMode('autonomous')).toEqual(
        buildAppServerArgs({ shell: false, webSearch: true }),
      )
      for (const mode of ['free', undefined] as const)
        expect(appServerArgsForMode(mode)).toEqual(buildAppServerArgs({ webSearch: false }))
    })

    it('throws ModeAlreadyChosenError for a second chooseMode call', async () => {
      const svc = makeService(root)
      const session = await svc.createSession()
      await svc.chooseMode(session.id, 'free')
      await waitFor(() => svc.getSession(session.id).status === 'idle')

      await expect(svc.chooseMode(session.id, 'autonomous')).rejects.toBeInstanceOf(
        ModeAlreadyChosenError,
      )
      await expect(svc.chooseMode(session.id, 'free')).rejects.toBeInstanceOf(
        ModeAlreadyChosenError,
      )
    })

    it('persists the chosen mode across a restart', async () => {
      const first = makeService(root)
      const session = await first.createSession()
      await first.chooseMode(session.id, 'free')
      await waitFor(() => first.getSession(session.id).status === 'idle')
      first.onModuleDestroy()

      const second = makeService(root)
      expect(second.getSession(session.id).mode).toBe('free')
    })

    it('resolves as soon as the mode is recorded, before the kickoff turn completes', async () => {
      const svc = makeService(root, ['--slow'])
      const session = await svc.createSession()
      const events: AgentUiEvent[] = []
      svc.subscribe(session.id, 0, (e) => events.push(e))

      await svc.chooseMode(session.id, 'free')

      // `chooseMode` resolved before the child even finished spawning (`--slow` holds the
      // turn open well past that): only the synchronous `mode`/`session` events are in yet,
      // never mind the turn completing.
      expect(svc.getSession(session.id).status).toBe('running')
      expect(events.map((e) => e.type)).toEqual(['mode', 'session'])
      expect(events.some((e) => e.type === 'turn')).toBe(false)

      // `--slow` holds the turn open for 5s; the default 3s `waitFor` isn't enough.
      await waitFor(() => svc.getSession(session.id).status === 'idle', 7000)
      expect(events.some((e) => e.type === 'turn' && e.status === 'completed')).toBe(true)
    }, 10_000)

    it('throws AgentSessionBusyError for a message sent while the kickoff turn is in flight', async () => {
      const svc = makeService(root, ['--slow'])
      const session = await svc.createSession()

      await svc.chooseMode(session.id, 'free')
      // `chooseMode` claims the session synchronously, before the first await, even though
      // it resolves without waiting for the turn to finish.
      expect(svc.getSession(session.id).status).toBe('running')

      await expect(svc.sendMessage(session.id, 'hi')).rejects.toBeInstanceOf(AgentSessionBusyError)
      // No need to wait out the rest of the (5s) slow turn: cleanup (`onModuleDestroy`) in
      // the outer `afterEach` closes the child regardless of where the turn is.
    })

    it('a kickoff spawn failure resolves chooseMode, with exactly one stopped notice', async () => {
      const svc = new AgentSessionService({
        root,
        spawnCodex: () => Promise.reject(new Error('no codex')),
      })
      services.push(svc)

      const session = await svc.createSession()
      const events: AgentUiEvent[] = []
      svc.subscribe(session.id, 0, (e) => events.push(e))

      await expect(svc.chooseMode(session.id, 'free')).resolves.toBeUndefined()

      await waitFor(() => svc.getSession(session.id).status === 'stopped')
      const stopped = events.filter((e) => e.type === 'session' && e.status === 'stopped')
      expect(stopped).toEqual([
        {
          id: expect.any(Number),
          reason: 'Codex could not start: no codex',
          status: 'stopped',
          type: 'session',
        },
      ])
      expect(svc.getSession(session.id).status).toBe('stopped')
    })

    it('resolves at once for autonomous, even when the runner never settles', async () => {
      const svc = new AgentSessionService({
        autonomous: { start: () => new Promise(() => undefined) },
        root,
        spawnCodex: () => Promise.reject(new Error('autonomous must never spawn Codex itself')),
      })
      services.push(svc)
      const session = await svc.createSession()

      await expect(svc.chooseMode(session.id, 'autonomous')).resolves.toBeUndefined()
      // Nothing ran, and nothing claims the session while the runner is still "working".
      expect(svc.getSession(session.id).status).toBe('idle')
      expect(svc.isRunning(session.id)).toBe(false)
    })

    it("autonomous: the default runner's rejection resolves chooseMode, with exactly one stopped notice, never running", async () => {
      const svc = makeService(root)
      const session = await svc.createSession()
      const events: AgentUiEvent[] = []
      svc.subscribe(session.id, 0, (e) => events.push(e))

      await expect(svc.chooseMode(session.id, 'autonomous')).resolves.toBeUndefined()

      await waitFor(() => svc.getSession(session.id).status === 'stopped')
      const stopped = events.filter((e) => e.type === 'session' && e.status === 'stopped')
      expect(stopped).toEqual([
        {
          id: expect.any(Number),
          reason: 'Autonomous mode is not available yet',
          status: 'stopped',
          type: 'session',
        },
      ])
      expect(svc.getSession(session.id).status).toBe('stopped')
      expect(svc.isRunning(session.id)).toBe(false)
    })
  })

  describe('questions', () => {
    const QUESTION = {
      questionId: 'q-turn-1',
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
      type: 'question',
    }

    /** A session whose turn has asked the fake's "Which tone?" question and is waiting. */
    async function asked(flags = ['--ask'], env: Record<string, string> = {}, idleMs?: number) {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-q-'))
      const svc = makeService(root, flags, env, idleMs)
      const session = await svc.createSession()
      const events: AgentUiEvent[] = []
      svc.subscribe(session.id, 0, (e) => events.push(e))
      await svc.sendMessage(session.id, 'make a video')
      await waitFor(() => events.some((e) => e.type === 'question'))
      return { events, id: session.id, svc }
    }

    const turnEnded = (events: AgentUiEvent[]) =>
      events.some((e) => e.type === 'turn' && e.status !== 'started')

    const tempLog = () =>
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-q-log-')), 'log.jsonl')

    /** Responses the fake received to its request `requestId` (answers or refusals). */
    const repliesTo = (log: string, requestId: string) =>
      readLog(log).filter((m) => (m as { id?: unknown }).id === requestId && !m.method)

    it('emits the question, and an answer resumes the turn', async () => {
      const { events, id, svc } = await asked()
      expect(events.find((e) => e.type === 'question')).toEqual({
        ...QUESTION,
        id: expect.any(Number),
      })
      expect(svc.getSession(id).status).toBe('running')

      svc.answerQuestion(id, 'q-turn-1', { tone: [' Serious '] })

      await waitFor(() => turnEnded(events))
      const after = events.slice(events.findIndex((e) => e.type === 'question') + 1)
      expect(after).toEqual([
        {
          answers: { tone: ['Serious'] },
          id: expect.any(Number),
          questionId: 'q-turn-1',
          type: 'question_answered',
        },
        {
          id: expect.any(Number),
          itemId: 'm-turn-1',
          text: 'answered:{"answers":{"tone":{"answers":["Serious"]}}}',
          type: 'message',
        },
        { id: expect.any(Number), status: 'completed', type: 'turn' },
      ])
      expect(svc.getSession(id).status).toBe('idle')
    })

    it('refuses an answer to a question that is not open', async () => {
      const { events, id, svc } = await asked()
      expect(() => svc.answerQuestion(id, 'nope', { tone: ['x'] })).toThrow(QuestionNotOpenError)

      svc.answerQuestion(id, 'q-turn-1', { tone: ['Serious'] })
      expect(() => svc.answerQuestion(id, 'q-turn-1', { tone: ['Serious'] })).toThrow(
        QuestionNotOpenError,
      )
      await waitFor(() => turnEnded(events))
      expect(events.filter((e) => e.type === 'question_answered')).toHaveLength(1)
    })

    it('refuses invalid answers and keeps the question open', async () => {
      const { events, id, svc } = await asked()
      const invalid: Record<string, unknown>[] = [
        {},
        { tone: [] },
        { tone: [''] },
        { tone: ['   '] },
        { extra: ['y'], tone: ['x'] },
        { tone: ['x'.repeat(2001)] },
        { tone: [1] },
        { tone: 'x' },
        { tone: Array.from({ length: 21 }, (_, i) => `answer ${i}`) },
      ]
      for (const answers of invalid)
        expect(() => svc.answerQuestion(id, 'q-turn-1', answers as AgentAnswers)).toThrow(
          InvalidAnswerError,
        )
      expect(events.some((e) => e.type === 'question_answered')).toBe(false)

      svc.answerQuestion(id, 'q-turn-1', { tone: ['A custom tone'] })
      await waitFor(() => turnEnded(events))
      expect(events).toContainEqual(
        expect.objectContaining({
          text: 'answered:{"answers":{"tone":{"answers":["A custom tone"]}}}',
          type: 'message',
        }),
      )
    })

    it('expires the question when the turn is interrupted, without answering Codex', async () => {
      const log = tempLog()
      const { events, id, svc } = await asked(['--ask'], { FAKE_LOG: log })

      await svc.interrupt(id)

      await waitFor(() => turnEnded(events))
      const after = events.slice(events.findIndex((e) => e.type === 'question') + 1)
      expect(after).toEqual([
        { id: expect.any(Number), questionId: 'q-turn-1', type: 'question_expired' },
        { id: expect.any(Number), status: 'interrupted', type: 'turn' },
      ])
      expect(() => svc.answerQuestion(id, 'q-turn-1', { tone: ['Serious'] })).toThrow(
        QuestionNotOpenError,
      )
      expect(svc.getSession(id).status).toBe('idle')
      // Codex withdrew the request: it gets no reply. The next turn/start is logged after
      // anything the service wrote before it, so a late reply would already show up.
      await svc.sendMessage(id, 'next')
      expect(repliesTo(log, 'ask-turn-1')).toEqual([])
    })

    it('expires a question still open when its turn ends, and tells Codex', async () => {
      const log = tempLog()
      const { events, id, svc } = await asked(['--ask-then-complete'], { FAKE_LOG: log })

      await waitFor(() => svc.getSession(id).status === 'idle')
      expect(events).toContainEqual(
        expect.objectContaining({ questionId: 'q-turn-1', type: 'question_expired' }),
      )
      expect(() => svc.answerQuestion(id, 'q-turn-1', { tone: ['Serious'] })).toThrow(
        QuestionNotOpenError,
      )
      await waitFor(() => readLog(log).some((m) => (m as { id?: unknown }).id === 'ask-turn-1'))
      expect(readLog(log)).toContainEqual({
        error: { code: -32000, message: 'Question expired' },
        id: 'ask-turn-1',
      })
    })

    it('expires an open question when Codex exits, then stops the session', async () => {
      const { events, id, svc } = await asked(['--ask-then-exit'])

      await waitFor(() => svc.getSession(id).status === 'stopped')
      const after = events.slice(events.findIndex((e) => e.type === 'question') + 1)
      expect(after).toEqual([
        { id: expect.any(Number), questionId: 'q-turn-1', type: 'question_expired' },
        {
          id: expect.any(Number),
          reason: 'Codex stopped (exit 4)',
          status: 'stopped',
          type: 'session',
        },
      ])
    })

    it('expires an open question when the idle child is stopped', async () => {
      // The question arrives after its turn ended, so it is still open when the idle timer fires.
      const { events, id, svc } = await asked(['--complete-then-ask'], {}, 200)
      expect(svc.getSession(id).status).toBe('idle')

      await waitFor(() => !svc.isRunning(id))
      expect(events.at(-1)).toEqual({
        id: expect.any(Number),
        questionId: 'q-turn-1',
        type: 'question_expired',
      })
      expect(() => svc.answerQuestion(id, 'q-turn-1', { tone: ['Serious'] })).toThrow(
        QuestionNotOpenError,
      )
    })

    it('never stores or replays the answer to a secret question', async () => {
      const questions = [
        {
          header: 'Tone',
          id: 'tone',
          isOther: true,
          isSecret: false,
          options: [],
          question: 'Tone?',
        },
        {
          header: 'Key',
          id: 'key',
          isOther: true,
          isSecret: true,
          options: null,
          question: 'Key?',
        },
      ]
      const { events, id, svc } = await asked(['--ask'], {
        FAKE_ASK_PARAMS: JSON.stringify({ questions }),
      })

      svc.answerQuestion(id, 'q-turn-1', { key: [' hunter2 '], tone: ['Serious'] })

      await waitFor(() => turnEnded(events))
      const answered = { answers: { key: ['••••'], tone: ['Serious'] }, questionId: 'q-turn-1' }
      expect(events).toContainEqual({
        ...answered,
        id: expect.any(Number),
        type: 'question_answered',
      })
      // Codex got the real text.
      expect(events).toContainEqual(
        expect.objectContaining({
          text: 'answered:{"answers":{"tone":{"answers":["Serious"]},"key":{"answers":["hunter2"]}}}',
          type: 'message',
        }),
      )
      // Nothing but Codex's own reply mentions it on disk.
      const replayed: AgentUiEvent[] = []
      svc.subscribe(id, 0, (e) => replayed.push(e))
      expect(replayed).toContainEqual(expect.objectContaining(answered))
      expect(JSON.stringify(replayed.filter((e) => e.type !== 'message'))).not.toContain('hunter2')
    })

    it('refuses a second request with the same question id and keeps the first open', async () => {
      const log = tempLog()
      const { events, id, svc } = await asked(['--ask-twice'], { FAKE_LOG: log })

      await waitFor(() => repliesTo(log, 'ask2-turn-1').length > 0)
      expect(repliesTo(log, 'ask2-turn-1')).toEqual([
        { error: { code: -32000, message: 'Duplicate question id' }, id: 'ask2-turn-1' },
      ])
      expect(events.filter((e) => e.type === 'question')).toHaveLength(1)

      svc.answerQuestion(id, 'q-turn-1', { tone: ['Serious'] })
      await waitFor(() => turnEnded(events))
      expect(events).toContainEqual(expect.objectContaining({ status: 'completed', type: 'turn' }))
    })

    it('shows only well-formed questions, with defaults, keyed by request id without an item id', async () => {
      const questions = [
        {
          header: 'Tone',
          id: 'tone',
          isOther: false,
          isSecret: false,
          options: null,
          question: 'Tone?',
        },
        {
          header: 'Length',
          id: 'length',
          options: [{ label: 'Short' }, { description: 'no label' }, 'junk'],
          question: 'How long?',
        },
        { id: 'no-header', question: 'Dropped?' },
        'junk',
        null,
      ]
      const { events, id, svc } = await asked(['--ask'], {
        FAKE_ASK_PARAMS: JSON.stringify({ itemId: null, questions }),
      })

      expect(events.find((e) => e.type === 'question')).toEqual({
        id: expect.any(Number),
        questionId: 'ask-turn-1',
        questions: [
          {
            header: 'Tone',
            id: 'tone',
            isOther: false,
            isSecret: false,
            options: [],
            question: 'Tone?',
          },
          {
            header: 'Length',
            id: 'length',
            isOther: false,
            isSecret: false,
            options: [{ description: '', label: 'Short' }],
            question: 'How long?',
          },
        ],
        type: 'question',
      })
      svc.answerQuestion(id, 'ask-turn-1', { length: ['Short'], tone: ['Calm'] })
      await waitFor(() => turnEnded(events))
      expect(events).toContainEqual(expect.objectContaining({ status: 'completed', type: 'turn' }))
    })

    it('answers Codex "No questions" and shows no card when every question is malformed', async () => {
      const log = tempLog()
      const svc = makeService(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-q-')), ['--ask'], {
        FAKE_ASK_PARAMS: JSON.stringify({ questions: [{ id: 'bad' }, 'junk'] }),
        FAKE_LOG: log,
      })
      const session = await svc.createSession()
      const events: AgentUiEvent[] = []
      svc.subscribe(session.id, 0, (e) => events.push(e))
      await svc.sendMessage(session.id, 'make a video')

      await waitFor(() => turnEnded(events))
      expect(repliesTo(log, 'ask-turn-1')).toEqual([
        { error: { code: -32000, message: 'No questions' }, id: 'ask-turn-1' },
      ])
      expect(events.some((e) => e.type === 'question')).toBe(false)
      expect(events).toContainEqual(expect.objectContaining({ status: 'failed', type: 'turn' }))
    })

    it('expires an open question on shutdown', async () => {
      const { events, id, svc } = await asked()

      svc.onModuleDestroy()

      expect(events).toContainEqual(
        expect.objectContaining({ questionId: 'q-turn-1', type: 'question_expired' }),
      )
      expect(() => svc.answerQuestion(id, 'q-turn-1', { tone: ['Serious'] })).toThrow(
        QuestionNotOpenError,
      )
    })

    it('interrupts a turn left waiting on a question for idleMs, then stops the idle child', async () => {
      const { events, id, svc } = await asked(['--ask'], {}, 200)
      expect(svc.getSession(id).status).toBe('running')

      await waitFor(() => turnEnded(events))
      const after = events.slice(events.findIndex((e) => e.type === 'question') + 1)
      expect(after).toEqual([
        { id: expect.any(Number), questionId: 'q-turn-1', type: 'question_expired' },
        { id: expect.any(Number), status: 'interrupted', type: 'turn' },
      ])
      expect(svc.getSession(id).status).toBe('idle')
      // The ordinary post-turn idle timer then closes the child, leaving the session idle.
      await waitFor(() => !svc.isRunning(id))
      expect(svc.getSession(id).status).toBe('idle')
    })

    it('cancels the question idle timer once the question is answered', async () => {
      // The turn keeps working for 600 ms after the answer: past the 200 ms question timer.
      const { events, id, svc } = await asked(['--ask', '--slow-after-answer'], {}, 200)
      const interrupt = jest.spyOn(svc, 'interrupt')

      svc.answerQuestion(id, 'q-turn-1', { tone: ['Serious'] })

      await waitFor(() => turnEnded(events))
      expect(interrupt).not.toHaveBeenCalled()
      expect(events).toContainEqual(expect.objectContaining({ status: 'completed', type: 'turn' }))
      expect(events.some((e) => e.type === 'turn' && e.status === 'interrupted')).toBe(false)
    })
  })

  it('shows the message and claims the session before a slow cold start finishes', async () => {
    let release: () => void = () => undefined
    const gate = new Promise<void>((r) => (release = r))
    const svc = new AgentSessionService({
      root,
      spawnCodex: async (cwd) => {
        await gate
        return CodexRpcClient.spawn(process.execPath, [FAKE], { cwd })
      },
    })
    services.push(svc)
    const session = await svc.createSession()
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))

    const sending = svc.sendMessage(session.id, 'hello')
    // Synchronously, before the child has even spawned:
    expect(events).toEqual([expect.objectContaining({ text: 'hello', type: 'user_message' })])
    expect(svc.getSession(session.id).status).toBe('running')
    await expect(svc.sendMessage(session.id, 'again')).rejects.toBeInstanceOf(AgentSessionBusyError)

    release()
    await sending
    await waitFor(() => svc.getSession(session.id).status === 'idle')
    expect(events.filter((e) => e.type === 'user_message')).toHaveLength(1)
  })

  it('reports a start failure, with the stderr tail, as a stopped session', async () => {
    const svc = makeService(root, ['--fail-start'])
    const session = await svc.createSession()
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))

    await expect(svc.sendMessage(session.id, 'hi')).rejects.toThrow(/invalid transport/)

    expect(svc.getSession(session.id).status).toBe('stopped')
    expect(events.map((e) => e.type)).toEqual(['user_message', 'session'])
    expect(events[1]).toMatchObject({
      reason: expect.stringMatching(/^Codex could not start: .*invalid transport/),
      status: 'stopped',
    })
  })

  it('fails the start instead of hanging when the app-server never answers initialize', async () => {
    const svc = makeService(root, ['--hang=initialize'], {}, undefined, { initialize: 150 })
    const session = await svc.createSession()
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))

    await expect(svc.sendMessage(session.id, 'hi')).rejects.toThrow(/did not answer initialize/)

    expect(svc.getSession(session.id).status).toBe('stopped')
    expect(events.at(-1)).toMatchObject({ status: 'stopped', type: 'session' })
  })

  it('stops the session (once) when turn/start is never answered', async () => {
    const svc = makeService(root, ['--hang=turn/start'], {}, undefined, { 'turn/start': 150 })
    const session = await svc.createSession()
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))

    await expect(svc.sendMessage(session.id, 'hi')).rejects.toThrow(/did not answer turn\/start/)

    expect(svc.getSession(session.id).status).toBe('stopped')
    expect(svc.isRunning(session.id)).toBe(false)
    const failures = events.filter((e) => e.type === 'session' || e.type === 'turn')
    expect(failures).toEqual([
      expect.objectContaining({
        reason: expect.stringContaining('did not answer turn/start'),
        status: 'stopped',
        type: 'session',
      }),
    ])
  })

  it('tells the user when the earlier conversation could not be resumed', async () => {
    const svc = makeService(root)
    const session = await svc.createSession()
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))
    await svc.sendMessage(session.id, 'one')
    await waitFor(() => svc.getSession(session.id).status === 'idle')
    svc.onModuleDestroy()

    // A fresh process whose Codex doesn't know the saved thread (FAKE_THREADS unset).
    const next = makeService(root)
    const nextEvents: AgentUiEvent[] = []
    next.subscribe(session.id, 0, (e) => nextEvents.push(e))
    await next.sendMessage(session.id, 'two')
    await waitFor(() => next.getSession(session.id).status === 'idle')

    expect(nextEvents).toContainEqual(
      expect.objectContaining({
        reason: 'Codex could not resume the earlier conversation; started a new one.',
        type: 'session',
      }),
    )
  })

  it('ends every open stream on shutdown', async () => {
    const svc = makeService(root)
    const session = await svc.createSession()
    const ended: string[] = []
    svc.subscribe(
      session.id,
      0,
      () => undefined,
      () => ended.push('a'),
    )
    svc.subscribe(
      session.id,
      0,
      () => undefined,
      () => ended.push('b'),
    )
    const unsubscribe = svc.subscribe(
      session.id,
      0,
      () => undefined,
      () => ended.push('gone'),
    )
    unsubscribe()

    svc.onModuleDestroy()

    expect(ended.sort()).toEqual(['a', 'b'])
    // A stream opened after shutdown ends at once.
    svc.subscribe(
      session.id,
      0,
      () => undefined,
      () => ended.push('late'),
    )
    expect(ended).toContain('late')
  })

  describe('Autonomous mode support', () => {
    const IDEA_QUESTION = [
      {
        header: 'Idea',
        id: 'idea',
        isOther: true,
        isSecret: false,
        options: [{ description: 'A hook', label: 'Fun fact: Octopus hearts (Recommended)' }],
        question: 'Which idea should we make?',
      },
    ]

    async function started(flags: string[] = [], env: Record<string, string> = {}) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-ff-'))
      const svc = makeService(dir, flags, env)
      const session = await svc.createSession()
      const events: AgentUiEvent[] = []
      svc.subscribe(session.id, 0, (e) => events.push(e))
      return { events, id: session.id, svc }
    }

    const tempLog = () =>
      path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-ff-log-')), 'log.jsonl')

    it('starts an autonomous thread with the brief that allows web search', async () => {
      const log = tempLog()
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-ff-brief-'))
      const svc = makeService(dir, [], { FAKE_LOG: log })
      const { id } = await svc.createSession()
      new AgentSessionStore(dir).update(id, { mode: 'autonomous' })

      await svc.runQuietTurn(id, 'find ideas', {})

      const threadStart = readLog(log).find((m) => m.method === 'thread/start')
      expect(threadStart?.params?.['developerInstructions']).toBe(AUTONOMOUS_BRIEF)
      // Web search runs next to no shell, in a read-only sandbox.
      expect(threadStart?.params?.['sandbox']).toBe('read-only')
      expect(spawnOpts).toEqual([{ mode: 'autonomous' }])
    })

    it('resumes an autonomous thread read-only too', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-ff-resume-'))
      const first = makeService(dir)
      const { id } = await first.createSession()
      new AgentSessionStore(dir).update(id, { mode: 'autonomous' })
      await first.runQuietTurn(id, 'one', {})
      const { threadId } = first.getSession(id)
      first.onModuleDestroy()

      const log = tempLog()
      const second = makeService(dir, [], { FAKE_LOG: log, FAKE_THREADS: threadId! })
      await second.runQuietTurn(id, 'two', {})

      const resume = readLog(log).find((m) => m.method === 'thread/resume')
      expect(resume?.params).toMatchObject({ sandbox: 'read-only', threadId })
      expect(spawnOpts).toEqual([{ mode: 'autonomous' }, { mode: 'autonomous' }])
    })

    it('runQuietTurn returns the agent message without showing it; activity still shows', async () => {
      const { events, id, svc } = await started()

      await expect(svc.runQuietTurn(id, 'find ideas', {})).resolves.toBe('Hello from fake')

      expect(events.map((e) => e.type)).toEqual(['session', 'turn', 'turn'])
      expect(events[0]).toMatchObject({ status: 'running', type: 'session' })
      expect(events.at(-1)).toMatchObject({ status: 'completed', type: 'turn' })
      expect(svc.getSession(id).status).toBe('idle')
    })

    it('runQuietTurn sends effort and outputSchema on turn/start', async () => {
      const log = tempLog()
      const { id, svc } = await started(['--schema-echo'], { FAKE_LOG: log })
      const schema = { additionalProperties: false, properties: {}, required: [], type: 'object' }

      const text = await svc.runQuietTurn(id, 'polish', { effort: 'low', outputSchema: schema })

      expect(JSON.parse(text)).toEqual({ echoedSchema: schema, note: null })
      const turnStart = readLog(log).find((e) => e.method === 'turn/start')
      expect(turnStart?.params).toEqual({
        effort: 'low',
        input: [{ text: 'polish', type: 'text' }],
        outputSchema: schema,
        threadId: svc.getSession(id).threadId,
      })
    })

    it('runQuietTurn rejects on a failed turn, and the chat gets no raw error', async () => {
      const { events, id, svc } = await started(['--reject-schema'])

      await expect(svc.runQuietTurn(id, 'x', { outputSchema: { type: 'object' } })).rejects.toThrow(
        /invalid_json_schema/,
      )

      const failed = events.find((e) => e.type === 'turn' && e.status === 'failed')
      expect(failed).toEqual({ id: expect.any(Number), status: 'failed', type: 'turn' })
      expect(svc.getSession(id).status).toBe('idle')
    })

    it('runQuietTurn refuses a busy session', async () => {
      const { id, svc } = await started(['--slow'])
      await svc.sendMessage(id, 'long')

      await expect(svc.runQuietTurn(id, 'x', {})).rejects.toBeInstanceOf(AgentSessionBusyError)
      await svc.interrupt(id)
    })

    it('runQuietTurn rejects with AgentFlowCancelledError when the user stops it', async () => {
      const { events, id, svc } = await started([], { FAKE_TURN_MS: '3000' })
      // Caught at once: it may reject before `interrupt` itself resolves.
      const quiet = svc.runQuietTurn(id, 'ideas', {}).catch((error: unknown) => error)
      await waitFor(() => events.some((e) => e.type === 'turn' && e.status === 'started'))

      await svc.interrupt(id)

      expect(await quiet).toBeInstanceOf(AgentFlowCancelledError)
      expect(events.some((e) => e.type === 'message' || e.type === 'text_delta')).toBe(false)
      await waitFor(() => svc.getSession(id).status === 'idle')
    })

    it('a normal turn after a quiet one shows its message again', async () => {
      const { events, id, svc } = await started()
      await svc.runQuietTurn(id, 'quiet', {})

      await svc.sendMessage(id, 'loud')
      await waitFor(() => events.some((e) => e.type === 'message'))

      expect(events.filter((e) => e.type === 'message')).toHaveLength(1)
    })

    it('askServerQuestion shows a question card and resolves with the answers; Codex gets no reply', async () => {
      const log = tempLog()
      const { events, id, svc } = await started([], { FAKE_LOG: log })
      await svc.runQuietTurn(id, 'warm up', {})

      const answer = svc.askServerQuestion(id, 'autonomous-idea-1', IDEA_QUESTION)
      // Marked as ReelMakeEasy's own card: the chat keeps it open past the agent's turn.
      expect(events.at(-1)).toEqual({
        id: expect.any(Number),
        questionId: 'autonomous-idea-1',
        questions: IDEA_QUESTION,
        server: true,
        type: 'question',
      })

      svc.answerQuestion(id, 'autonomous-idea-1', { idea: [' my own idea '] })

      await expect(answer).resolves.toEqual({ idea: ['my own idea'] })
      expect(events.at(-1)).toEqual({
        answers: { idea: ['my own idea'] },
        id: expect.any(Number),
        questionId: 'autonomous-idea-1',
        type: 'question_answered',
      })
      // Only requests reach the fake: no JSON-RPC response for the server question.
      expect(readLog(log).filter((m) => !m.method)).toEqual([])
      expect(() => svc.answerQuestion(id, 'autonomous-idea-1', { idea: ['again'] })).toThrow(
        QuestionNotOpenError,
      )
    })

    it('askServerQuestion needs no running Codex, and keeps the card open on a bad answer', async () => {
      const { id, svc } = await started()

      const answer = svc.askServerQuestion(id, 'autonomous-retry-1', IDEA_QUESTION)
      expect(svc.isRunning(id)).toBe(false)
      expect(() => svc.answerQuestion(id, 'autonomous-retry-1', { other: ['x'] })).toThrow(
        InvalidAnswerError,
      )

      svc.answerQuestion(id, 'autonomous-retry-1', { idea: ['Try again'] })
      await expect(answer).resolves.toEqual({ idea: ['Try again'] })
      expect(svc.isRunning(id)).toBe(false)
    })

    it('askServerQuestion refuses a question id that is already open', async () => {
      const { id, svc } = await started()
      const first = svc.askServerQuestion(id, 'autonomous-idea-1', IDEA_QUESTION)

      await expect(svc.askServerQuestion(id, 'autonomous-idea-1', IDEA_QUESTION)).rejects.toThrow(
        /already open/,
      )
      svc.answerQuestion(id, 'autonomous-idea-1', { idea: ['a'] })
      await first
    })

    it('expireServerQuestion closes one replaced card: it expires, and its asker rejects', async () => {
      const { events, id, svc } = await started()
      const replaced = svc
        .askServerQuestion(id, 'autonomous-loop-1', IDEA_QUESTION)
        .catch((error: unknown) => error)
      const kept = svc.askServerQuestion(id, 'autonomous-loop-2', IDEA_QUESTION)

      svc.expireServerQuestion(id, 'autonomous-loop-1')
      svc.expireServerQuestion(id, 'autonomous-loop-9')

      expect(await replaced).toBeInstanceOf(QuestionReplacedError)
      expect(events.at(-1)).toEqual({
        id: expect.any(Number),
        questionId: 'autonomous-loop-1',
        type: 'question_expired',
      })
      expect(() => svc.answerQuestion(id, 'autonomous-loop-1', { idea: ['a'] })).toThrow(
        QuestionNotOpenError,
      )
      svc.answerQuestion(id, 'autonomous-loop-2', { idea: ['a'] })
      await expect(kept).resolves.toEqual({ idea: ['a'] })
    })

    it('Stop expires an open server question and its asker rejects with AgentFlowCancelledError', async () => {
      const { events, id, svc } = await started()
      const answer = svc
        .askServerQuestion(id, 'autonomous-idea-1', IDEA_QUESTION)
        .catch((error: unknown) => error)

      await svc.interrupt(id)

      expect(await answer).toBeInstanceOf(AgentFlowCancelledError)
      expect(events.at(-1)).toEqual({
        id: expect.any(Number),
        questionId: 'autonomous-idea-1',
        type: 'question_expired',
      })
      expect(() => svc.answerQuestion(id, 'autonomous-idea-1', { idea: ['a'] })).toThrow(
        QuestionNotOpenError,
      )
    })

    it('shutdown expires open server questions', async () => {
      const { events, id, svc } = await started()
      const answer = svc.askServerQuestion(id, 'autonomous-idea-1', IDEA_QUESTION)

      svc.onModuleDestroy()

      await expect(answer).rejects.toBeInstanceOf(AgentFlowCancelledError)
      expect(events.at(-1)).toMatchObject({ type: 'question_expired' })
    })

    it('emitNotice and emitMessage post ReelMakeEasy-authored entries that replay', async () => {
      const { id, svc } = await started()

      svc.emitNotice(id, "Couldn't find ideas: boom")
      svc.emitMessage(id, 'Hello from ReelMakeEasy')
      svc.emitMessage(id, 'Second')

      const replayed: AgentUiEvent[] = []
      svc.subscribe(id, 0, (e) => replayed.push(e))
      expect(replayed).toEqual([
        { id: 1, text: "Couldn't find ideas: boom", type: 'notice' },
        { id: 2, itemId: 'ly-2', text: 'Hello from ReelMakeEasy', type: 'message' },
        { id: 3, itemId: 'ly-3', text: 'Second', type: 'message' },
      ])
    })
  })

  describe('Autonomous flow lifecycle', () => {
    /** A service whose autonomous runner is a stub: `start` never settles on its own. */
    function withRunner(opts: { cold?: Promise<void>; log?: string } = {}) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-flow-'))
      const runner = { cancel: jest.fn(), start: jest.fn(() => new Promise<void>(() => undefined)) }
      const svc = new AgentSessionService({
        autonomous: runner,
        root: dir,
        spawnCodex: async (cwd) => {
          if (opts.log) process.env.FAKE_LOG = opts.log
          await opts.cold
          return CodexRpcClient.spawn(process.execPath, [FAKE], { cwd })
        },
      })
      services.push(svc)
      return { dir, runner, svc }
    }

    it('refuses chat messages while the autonomous flow runs, and after it ends', async () => {
      const { svc } = withRunner()
      const { id } = await svc.createSession()
      const events: AgentUiEvent[] = []
      svc.subscribe(id, 0, (e) => events.push(e))
      await svc.chooseMode(id, 'autonomous')
      expect(svc.getSession(id).flowActive).toBe(true)

      await expect(svc.sendMessage(id, 'hi')).rejects.toBeInstanceOf(FlowActiveError)

      svc.endAutonomousFlow(id)
      expect(svc.getSession(id).flowActive).toBe(false)
      // A finished autonomous session is not a free chat: nothing is shown or started.
      await expect(svc.sendMessage(id, 'hi')).rejects.toBeInstanceOf(ModeNotChattableError)
      expect(events.some((e) => e.type === 'user_message')).toBe(false)
      expect(svc.getSession(id).status).toBe('idle')
      expect(svc.isRunning(id)).toBe(false)
    })

    it('Stop marks the flow cancelled and tells the runner, even with no turn running', async () => {
      const { runner, svc } = withRunner()
      const { id } = await svc.createSession()
      await svc.chooseMode(id, 'autonomous')
      expect(svc.isFlowCancelled(id)).toBe(false)

      await svc.interrupt(id)

      expect(svc.isFlowCancelled(id)).toBe(true)
      expect(runner.cancel).toHaveBeenCalledWith(id)
      svc.endAutonomousFlow(id)
      expect(svc.isFlowCancelled(id)).toBe(false)
    })

    it('Stop during a quiet turn cold start never starts the turn', async () => {
      let release: () => void = () => undefined
      const cold = new Promise<void>((r) => (release = r))
      const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-cold-')), 'l.jsonl')
      const { svc } = withRunner({ cold, log })
      const { id } = await svc.createSession()
      await svc.chooseMode(id, 'autonomous')
      const events: AgentUiEvent[] = []
      svc.subscribe(id, 0, (e) => events.push(e))
      const quiet = svc.runQuietTurn(id, 'ideas', {}).catch((error: unknown) => error)

      await svc.interrupt(id)
      release()

      expect(await quiet).toBeInstanceOf(AgentFlowCancelledError)
      expect(readLog(log).some((m) => m.method === 'turn/start')).toBe(false)
      expect(events.at(-1)).toMatchObject({ status: 'interrupted', type: 'turn' })
      expect(svc.getSession(id).status).toBe('idle')
    })

    it('ending the flow drops its empty server-question map', async () => {
      const { svc } = withRunner()
      const { id } = await svc.createSession()
      await svc.chooseMode(id, 'autonomous')
      const answer = svc.askServerQuestion(id, 'autonomous-idea-1', [
        { header: 'Idea', id: 'idea', isOther: true, isSecret: false, options: [], question: 'Q?' },
      ])
      svc.answerQuestion(id, 'autonomous-idea-1', { idea: ['x'] })
      await answer

      svc.endAutonomousFlow(id)

      expect(
        (svc as unknown as { serverQuestions: Map<string, unknown> }).serverQuestions.has(id),
      ).toBe(false)
    })

    it('a restart stops an autonomous session whose flow was still going, once', async () => {
      const { dir, svc } = withRunner()
      const { id } = await svc.createSession()
      await svc.chooseMode(id, 'autonomous')
      const done = await svc.createSession()
      await svc.chooseMode(done.id, 'autonomous')
      svc.endAutonomousFlow(done.id)
      // A crash, not a clean shutdown: no onModuleDestroy.
      services = services.filter((s) => s !== svc)

      const next = new AgentSessionService({ root: dir, spawnCodex: async () => never() })
      services.push(next)

      expect(next.getSession(id)).toMatchObject({ flowActive: false, status: 'stopped' })
      const replay: AgentUiEvent[] = []
      next.subscribe(id, 0, (e) => replay.push(e))
      expect(replay.filter((e) => e.type === 'session')).toEqual([
        {
          id: expect.any(Number),
          reason: 'ReelMakeEasy restarted',
          status: 'stopped',
          type: 'session',
        },
      ])
      expect(next.getSession(done.id).status).toBe('idle')
      // The flow is gone, and the session stays a finished autonomous session (no chat).
      await expect(next.sendMessage(id, 'hi')).rejects.toBeInstanceOf(ModeNotChattableError)
    })

    it('expires the cards ReelMakeEasy asked that were still open when it crashed', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-restart-cards-'))
      const svc = new AgentSessionService({ root: dir, spawnCodex: async () => never() })
      services.push(svc)
      const { id } = await svc.createSession()
      const card = {
        header: 'Loop short',
        id: 'make',
        isOther: false,
        isSecret: false,
        options: [{ description: '', label: 'Make it' }],
        question: 'Make this loop?',
      }
      const settled = (p: Promise<unknown>) => void p.catch(() => undefined)
      settled(svc.askServerQuestion(id, 'autonomous-loop-1', [card]))
      settled(svc.askServerQuestion(id, 'autonomous-loop-2', [card]))
      svc.expireServerQuestion(id, 'autonomous-loop-1')
      // The loop's start was under way when the process died.
      svc.setFlowWorking(id, true)
      services = services.filter((s) => s !== svc)

      const next = new AgentSessionService({ root: dir, spawnCodex: async () => never() })
      services.push(next)

      const replay: AgentUiEvent[] = []
      next.subscribe(id, 0, (e) => replay.push(e))
      const tail = replay.slice(-2).map(({ id: _id, ...e }) => e)
      expect(tail).toEqual([
        { questionId: 'autonomous-loop-2', type: 'question_expired' },
        { reason: 'ReelMakeEasy restarted', status: 'stopped', type: 'session' },
      ])
      expect(replay.filter((e) => e.type === 'question_expired')).toHaveLength(2)
    })

    it('shutdown stops an autonomous session whose flow was still going', async () => {
      const { svc } = withRunner()
      const { id } = await svc.createSession()
      await svc.chooseMode(id, 'autonomous')

      svc.onModuleDestroy()

      expect(svc.getSession(id)).toMatchObject({ flowActive: false, status: 'stopped' })
    })
  })

  describe('an Easy flow cut off by a restart', () => {
    const idea = {
      header: 'Idea',
      id: 'idea',
      isOther: true,
      isSecret: false,
      options: [{ description: 'Hook', label: 'Fun fact: Octopus hearts (Recommended)' }],
      question: 'Which idea should we make?',
    }

    /** A service whose runner's `start` and `resume` never settle on their own. */
    function withRunner(dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-resume-'))) {
      const runner = {
        cancel: jest.fn(),
        resume: jest.fn(() => new Promise<void>(() => undefined)),
        resumeAction: jest.fn((): AgentResumeAction => ({ kind: 'carry_on' })),
        start: jest.fn(() => new Promise<void>(() => undefined)),
      }
      const svc = new AgentSessionService({
        autonomous: runner,
        root: dir,
        spawnCodex: async (cwd) => CodexRpcClient.spawn(process.execPath, [FAKE], { cwd }),
      })
      services.push(svc)
      return { dir, runner, svc }
    }

    /** The next process on the same data folder (after a crash, `services` forgets `svc`). */
    function restart(dir: string, crashed?: AgentSessionService) {
      if (crashed) services = services.filter((s) => s !== crashed)
      return withRunner(dir)
    }

    /** An Easy chat waiting on its idea card. */
    async function easyOnACard(svc: AgentSessionService) {
      const { id } = await svc.createSession()
      await svc.chooseMode(id, 'autonomous')
      void svc.askServerQuestion(id, 'autonomous-idea-1', [idea]).catch(() => undefined)
      return id
    }

    it('shutdown marks it interrupted; a Stop by the user, a finished video and Free chat are not', async () => {
      const { dir, svc } = withRunner()
      const cut = await easyOnACard(svc)
      const stopped = await easyOnACard(svc)
      await svc.interrupt(stopped)
      const started = await easyOnACard(svc)
      svc.recordAutonomous(started, { projectId: 'p1' })
      // Free chat, its kickoff turn running.
      const free = await svc.createSession()
      await svc.chooseMode(free.id, 'free')
      expect(svc.getSession(free.id).status).toBe('running')

      svc.onModuleDestroy()

      expect(svc.getSession(cut)).toMatchObject({
        flowActive: false,
        interrupted: true,
        status: 'stopped',
      })
      expect(svc.getSession(stopped).interrupted).not.toBe(true)
      expect(svc.getSession(started).interrupted).not.toBe(true)
      expect(svc.getSession(free.id).interrupted).not.toBe(true)

      // The next start reads them the same: only the chat ReelMakeEasy cut off can pick up.
      const next = restart(dir)
      expect(next.svc.getSession(cut).interrupted).toBe(true)
      expect(next.svc.getSession(stopped).interrupted).not.toBe(true)
      expect(next.svc.getSession(started).interrupted).not.toBe(true)
      expect(next.svc.getSession(free.id).interrupted).not.toBe(true)
      expect(() => next.svc.resumeFlow(stopped)).toThrow(
        new NotResumableError(stopped, 'You stopped this chat. Start a new chat to make a video.'),
      )
    })

    it('a Stop while a step runs with no card open stays a Stop through a shutdown and the next start', async () => {
      const { dir, svc } = withRunner()
      // Easy, mid-step (writing the script, starting the video): no card, no turn.
      const { id } = await svc.createSession()
      await svc.chooseMode(id, 'autonomous')
      await svc.interrupt(id)

      svc.onModuleDestroy()
      expect(svc.getSession(id)).toMatchObject({ interrupted: false, status: 'stopped' })

      const { runner, svc: next } = restart(dir)
      expect(next.getSession(id).interrupted).toBe(false)
      expect(() => next.resumeFlow(id)).toThrow(
        new NotResumableError(id, 'You stopped this chat. Start a new chat to make a video.'),
      )
      expect(runner.resume).not.toHaveBeenCalled()
    })

    it('a Stop while a step runs, then a crash: the next start does not offer to pick it up', async () => {
      const first = withRunner()
      const { id } = await first.svc.createSession()
      await first.svc.chooseMode(id, 'autonomous')
      await first.svc.interrupt(id)

      const { runner, svc } = restart(first.dir, first.svc)

      expect(svc.getSession(id)).toMatchObject({
        flowActive: false,
        interrupted: false,
        status: 'stopped',
      })
      expect(() => svc.resumeFlow(id)).toThrow(NotResumableError)
      expect(runner.resume).not.toHaveBeenCalled()
    })

    it('a chat picked up again and then cut off by a crash can pick up again', async () => {
      const first = withRunner()
      const id = await easyOnACard(first.svc)
      first.svc.onModuleDestroy()
      const second = restart(first.dir)
      second.svc.resumeFlow(id)

      const { svc } = restart(first.dir, second.svc)

      expect(svc.getSession(id)).toMatchObject({ interrupted: true, status: 'stopped' })
    })

    it('a crash: the next start marks an Easy flow that was still going as interrupted', async () => {
      const first = withRunner()
      const id = await easyOnACard(first.svc)
      const done = await easyOnACard(first.svc)
      first.svc.endAutonomousFlow(done)

      const { svc } = restart(first.dir, first.svc)

      expect(svc.getSession(id)).toMatchObject({
        flowActive: false,
        interrupted: true,
        status: 'stopped',
      })
      // A flow that had ended (a failure, "Not now") has nothing to pick up.
      expect(svc.getSession(done).interrupted).not.toBe(true)
    })

    it('an Easy chat a shutdown stopped before ReelMakeEasy kept the mark is interrupted on start', async () => {
      const first = withRunner()
      const cut = await easyOnACard(first.svc)
      const cancelled = await easyOnACard(first.svc)
      await first.svc.interrupt(cancelled)
      first.svc.emitAutonomousEvent(cancelled, { type: 'flow_cancelled' })
      first.svc.endAutonomousFlow(cancelled)
      first.svc.recordAutonomous(cancelled, { status: 'stopped' })
      const failed = await easyOnACard(first.svc)
      first.svc.endAutonomousFlow(failed)
      first.svc.recordAutonomous(failed, { status: 'stopped' })
      first.svc.emitNotice(failed, 'Codex could not start: boom')
      first.svc.onModuleDestroy()
      // As an older ReelMakeEasy left them: stopped by the shutdown, with no mark.
      const store = new AgentSessionStore(first.dir)
      for (const id of [cut, cancelled, failed])
        store.update(id, { interrupted: undefined }, { touch: false })

      const { svc } = restart(first.dir)

      expect(svc.getSession(cut).interrupted).toBe(true)
      expect(svc.getSession(cancelled).interrupted).not.toBe(true)
      expect(svc.getSession(failed).interrupted).not.toBe(true)
    })

    it('resumeFlow claims the flow again and hands it to the runner, once', async () => {
      const first = withRunner()
      const id = await easyOnACard(first.svc)
      first.svc.onModuleDestroy()
      const { runner, svc } = restart(first.dir)
      const events: AgentUiEvent[] = []
      svc.subscribe(id, 0, (e) => events.push(e))
      const before = events.length

      svc.resumeFlow(id)

      expect(runner.resume).toHaveBeenCalledWith(id)
      expect(svc.getSession(id)).toMatchObject({
        flowActive: true,
        interrupted: false,
        status: 'running',
      })
      expect(events.slice(before).map(({ id: _id, ...e }) => e)).toEqual([
        { status: 'running', type: 'session' },
      ])
      // A double click: the flow already runs, nothing starts twice.
      expect(() => svc.resumeFlow(id)).toThrow(FlowActiveError)
      expect(runner.resume).toHaveBeenCalledTimes(1)
      // The chat still takes only card answers while it runs.
      await expect(svc.sendMessage(id, 'hi')).rejects.toBeInstanceOf(FlowActiveError)
    })

    it('refuses to pick up while ReelMakeEasy shuts down, in plain words, and starts nothing', async () => {
      const first = withRunner()
      const id = await easyOnACard(first.svc)
      first.svc.onModuleDestroy()
      const { dir, runner, svc } = restart(first.dir)

      svc.onModuleDestroy()

      expect(() => svc.resumeFlow(id)).toThrow(ShuttingDownError)
      expect(() => svc.resumeFlow(id)).toThrow('ReelMakeEasy is restarting. Try again in a moment.')
      expect(runner.resume).not.toHaveBeenCalled()
      expect(svc.getSession(id)).toMatchObject({
        flowActive: false,
        interrupted: true,
        status: 'stopped',
      })
      // Nothing was claimed: the next start still offers to pick it up.
      const next = restart(dir)
      expect(next.svc.getSession(id).interrupted).toBe(true)
      next.svc.resumeFlow(id)
      expect(next.runner.resume).toHaveBeenCalledWith(id)
    })

    it("the chat's view says what picking up does, from the runner, only while it can pick up", async () => {
      const first = withRunner()
      const id = await easyOnACard(first.svc)
      const stopped = await easyOnACard(first.svc)
      await first.svc.interrupt(stopped)
      first.svc.onModuleDestroy()
      const { runner, svc } = restart(first.dir)
      runner.resumeAction.mockReturnValue({ costUsd: 1.2, kind: 'make_loop' })

      expect(svc.sessionView(id)).toEqual({
        ...svc.getSession(id),
        resume: { costUsd: 1.2, kind: 'make_loop' },
      })
      expect(runner.resumeAction).toHaveBeenCalledWith(id)
      // Only the view says it: the saved chat never keeps it.
      expect(svc.getSession(id).resume).toBeUndefined()
      // Nothing to pick up: nothing said, and the runner isn't asked.
      expect(svc.sessionView(stopped)).toEqual(svc.getSession(stopped))
      expect(runner.resumeAction).not.toHaveBeenCalledWith(stopped)
      // Picked up: the flow runs again, and the button is gone.
      svc.resumeFlow(id)
      expect(svc.sessionView(id).resume).toBeUndefined()
      expect(runner.resumeAction).toHaveBeenCalledTimes(1)
    })

    it("the chat's view of a chat that can pick up says the plain words when the runner can't say more", async () => {
      const first = withRunner()
      const id = await easyOnACard(first.svc)
      first.svc.onModuleDestroy()
      const { runner, svc } = restart(first.dir)
      runner.resumeAction.mockImplementation(() => {
        throw new Error('The transcript is unreadable')
      })

      expect(svc.sessionView(id).resume).toEqual({ kind: 'carry_on' })
    })

    it('the runner sets the working state down when it carries on; a failure stops the chat', async () => {
      const first = withRunner()
      const id = await easyOnACard(first.svc)
      first.svc.onModuleDestroy()
      const { runner, svc } = restart(first.dir)
      runner.resume.mockImplementationOnce(async () => {
        svc.setFlowWorking(id, false)
        throw new Error('boom')
      })

      svc.resumeFlow(id)
      await waitFor(() => svc.getSession(id).status === 'stopped')

      expect(svc.getSession(id)).toMatchObject({ flowActive: false, status: 'stopped' })
    })

    it('refuses, in plain words, a chat the user stopped, a started video, Free chat or an unknown chat', async () => {
      const { svc } = withRunner()
      const stopped = await easyOnACard(svc)
      await svc.interrupt(stopped)
      svc.emitAutonomousEvent(stopped, { type: 'flow_cancelled' })
      svc.endAutonomousFlow(stopped)
      const started = await easyOnACard(svc)
      svc.recordAutonomous(started, { projectId: 'p1' })
      svc.endAutonomousFlow(started)
      const free = await svc.createSession()
      await svc.chooseMode(free.id, 'free').catch(() => undefined)

      expect(() => svc.resumeFlow(stopped)).toThrow(
        new NotResumableError(stopped, 'You stopped this chat. Start a new chat to make a video.'),
      )
      expect(() => svc.resumeFlow(started)).toThrow(
        new NotResumableError(started, "This chat's video was already started."),
      )
      expect(() => svc.resumeFlow(free.id)).toThrow(
        new NotResumableError(free.id, 'Only an Easy chat can pick up where it left off.'),
      )
      expect(() => svc.resumeFlow(randomUUID())).toThrow(NotFoundException)
    })

    it('Free chat: typing still works after a restart, on a new conversation when the old one is gone', async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-free-restart-'))
      const svc = makeService(dir, [], { FAKE_TURN_MS: '3000' })
      const { id } = await svc.createSession()
      const before: AgentUiEvent[] = []
      svc.subscribe(id, 0, (e) => before.push(e))
      await svc.chooseMode(id, 'free')
      // Shut down mid-turn (its kickoff).
      await waitFor(() => before.some((e) => e.type === 'turn' && e.status === 'started'))
      svc.onModuleDestroy()
      expect(svc.getSession(id)).toMatchObject({ status: 'stopped' })
      expect(svc.getSession(id).interrupted).not.toBe(true)

      // A fresh process whose agent no longer knows the saved thread.
      const next = makeService(dir, [], { FAKE_TURN_MS: '10' })
      const events: AgentUiEvent[] = []
      next.subscribe(id, 0, (e) => events.push(e))
      await next.sendMessage(id, 'two')
      await waitFor(() => next.getSession(id).status === 'idle')

      expect(events).toContainEqual(expect.objectContaining({ text: 'two', type: 'user_message' }))
      expect(events).toContainEqual(
        expect.objectContaining({
          reason: 'Codex could not resume the earlier conversation; started a new one.',
          type: 'session',
        }),
      )
      expect(() => next.resumeFlow(id)).toThrow(NotResumableError)
    })
  })

  describe('notifyAgent', () => {
    const turnTexts = (log: string) =>
      fs.existsSync(log)
        ? readLog(log)
            .filter((m) => m.method === 'turn/start')
            .map((m) => (m.params?.['input'] as { text: string }[])[0].text)
        : []

    async function chat(mode: AgentMode, env: Record<string, string> = {}) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-svc-note-'))
      const log = path.join(dir, 'log.jsonl')
      const svc = makeService(dir, [], { FAKE_LOG: log, ...env })
      const { id } = await svc.createSession()
      new AgentSessionStore(dir).update(id, { mode })
      const events: AgentUiEvent[] = []
      svc.subscribe(id, 0, (e) => events.push(e))
      return { events, id, log, svc }
    }

    it("tells a Free chat's agent in a hidden turn: no user message, and its answer shows", async () => {
      const { events, id, log, svc } = await chat('free')

      svc.notifyAgent(id, 'The loop failed: narration too long.')

      // Claimed at once, like a message: the working state shows.
      expect(svc.getSession(id).status).toBe('running')
      await waitFor(() => events.some((e) => e.type === 'turn' && e.status === 'completed'))
      expect(turnTexts(log)).toEqual(['The loop failed: narration too long.'])
      expect(events.map((e) => e.type)).toEqual([
        'session',
        'turn',
        'text_delta',
        'message',
        'turn',
      ])
      expect(svc.getSession(id).status).toBe('idle')
    })

    it('waits for a running turn to end, then tells the agent', async () => {
      const { events, id, log, svc } = await chat('free', { FAKE_TURN_MS: '300' })
      await svc.sendMessage(id, 'hi')

      svc.notifyAgent(id, 'The loop failed.')
      expect(turnTexts(log)).toEqual(['hi'])

      await waitFor(() => events.filter((e) => e.type === 'message').length === 2)
      expect(turnTexts(log)).toEqual(['hi', 'The loop failed.'])
      // The user's message shows; the note never does.
      expect(events.filter((e) => e.type === 'user_message')).toHaveLength(1)
      await waitFor(() => svc.getSession(id).status === 'idle')
    })

    it("leaves a running turn's working state alone while a card's flow works beside it", async () => {
      const { events, id, log, svc } = await chat('free', { FAKE_TURN_MS: '300' })
      await svc.sendMessage(id, 'hi')

      // The user clicks "Make it" on a loop card while the agent's turn still runs.
      svc.setFlowWorking(id, true)
      svc.notifyAgent(id, 'The loop failed.')
      svc.setFlowWorking(id, false)
      await new Promise((r) => setTimeout(r, 20))

      // Still the turn's: never idle under it, and the note waits for the turn to end.
      expect(svc.getSession(id).status).toBe('running')
      expect(events.filter((e) => e.type === 'session')).toEqual([])
      await expect(svc.sendMessage(id, 'again')).rejects.toBeInstanceOf(AgentSessionBusyError)
      expect(turnTexts(log)).toEqual(['hi'])
      await waitFor(() => events.filter((e) => e.type === 'message').length === 2)
      expect(turnTexts(log)).toEqual(['hi', 'The loop failed.'])
      await waitFor(() => svc.getSession(id).status === 'idle')
    })

    it('shows the working state while a flow works with no turn running, then sends notes', async () => {
      const { events, id, log, svc } = await chat('free')

      svc.setFlowWorking(id, true)
      expect(svc.getSession(id).status).toBe('running')
      svc.notifyAgent(id, 'The loop failed.')
      expect(turnTexts(log)).toEqual([])
      svc.setFlowWorking(id, false)

      expect(events.filter((e) => e.type === 'session').slice(0, 2)).toEqual([
        expect.objectContaining({ status: 'running', type: 'session' }),
        expect.objectContaining({ status: 'idle', type: 'session' }),
      ])
      await waitFor(() => events.some((e) => e.type === 'turn' && e.status === 'completed'))
      expect(turnTexts(log)).toEqual(['The loop failed.'])
    })

    it('tells nothing to an Easy chat (no agent to talk to until it edits)', async () => {
      const { events, id, log, svc } = await chat('autonomous')

      svc.notifyAgent(id, 'The video failed.')
      await new Promise((r) => setTimeout(r, 50))

      expect(turnTexts(log)).toEqual([])
      expect(events).toEqual([])
      expect(svc.getSession(id).status).toBe('idle')
    })
  })

  describe('pastQuestions', () => {
    const question = (header: string, label: string) => ({
      header,
      id: 'idea',
      isOther: true,
      isSecret: false,
      options: [{ description: '', label }],
      question: '?',
    })

    it('returns the questions with that header from every chat, newest chat first', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-past-'))
      const store = new AgentSessionStore(dir)
      const [older, newer] = [randomUUID(), randomUUID()]
      store.create({ id: older, title: 'x' })
      store.create({ id: newer, title: 'y' })
      store.update(older, { createdAt: '2026-01-01T00:00:00.000Z' })
      store.update(newer, { createdAt: '2026-02-01T00:00:00.000Z' })
      store.append(older, {
        questionId: 'q1',
        questions: [question('Idea', 'Old')],
        type: 'question',
      })
      store.append(newer, {
        questionId: 'q2',
        questions: [question('Style', 'S')],
        type: 'question',
      })
      store.append(newer, {
        questionId: 'q3',
        questions: [question('Idea', 'New')],
        type: 'question',
      })

      const labels = makeService(dir)
        .pastQuestions('Idea')
        .map((q) => q.options[0].label)
      expect(labels).toEqual(['New', 'Old'])
    })
  })

  describe('titles', () => {
    it('starts as "New chat" and takes its name from the first message', async () => {
      const svc = makeService(root, [])
      const session = await svc.createSession()
      expect(session.title).toBe('New chat')
      await svc.chooseMode(session.id, 'free')
      await waitFor(() => svc.getSession(session.id).status === 'idle')
      await svc.sendMessage(session.id, 'A video about   bees')
      expect(svc.getSession(session.id).title).toBe('A video about bees')
      await waitFor(() => svc.getSession(session.id).status === 'idle')
      await svc.sendMessage(session.id, 'Something else')
      expect(svc.getSession(session.id).title).toBe('A video about bees')
    })

    it('titleChat names an unset chat only', async () => {
      const svc = makeService(root, [])
      const session = await svc.createSession()
      svc.titleChat(session.id, 'Comet tonight')
      svc.titleChat(session.id, 'Other')
      expect(svc.getSession(session.id).title).toBe('Comet tonight')
    })
  })

  describe('deleteSession', () => {
    it('deletes an idle chat, its folder and its idle Codex child', async () => {
      const svc = makeService(root, [])
      const session = await svc.createSession()
      await svc.chooseMode(session.id, 'free')
      await waitFor(() => svc.getSession(session.id).status === 'idle')
      expect(svc.isRunning(session.id)).toBe(true)
      svc.deleteSession(session.id)
      expect(svc.isRunning(session.id)).toBe(false)
      expect(() => svc.getSession(session.id)).toThrow(NotFoundException)
      expect(svc.listSessions().some((s) => s.id === session.id)).toBe(false)
      expect(fs.existsSync(path.join(root, session.id))).toBe(false)
    })

    it('refuses while Codex is working or the flow is setting up', async () => {
      const svc = makeService(root, ['--slow-turn'])
      const session = await svc.createSession()
      await svc.chooseMode(session.id, 'free')
      await waitFor(() => svc.getSession(session.id).status === 'running')
      expect(() => svc.deleteSession(session.id)).toThrow(AgentSessionBusyError)

      const auto = await svc.createSession()
      ;(svc as unknown as { store: { update: (id: string, p: object) => void } }).store.update(
        auto.id,
        { flowActive: true },
      )
      expect(() => svc.deleteSession(auto.id)).toThrow(FlowActiveError)
    })

    it('ends open event streams', async () => {
      const svc = makeService(root, [])
      const session = await svc.createSession()
      const onEnd = jest.fn()
      svc.subscribe(session.id, 0, () => undefined, onEnd)
      svc.deleteSession(session.id)
      expect(onEnd).toHaveBeenCalledTimes(1)
    })
  })
})

describe('dynamic tools', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tools-'))

  it('declares the session tools on thread/start with the experimental capability, and answers a tool call', async () => {
    const log = path.join(root, `tools-${Date.now()}.log`)
    process.env.FAKE_LOG = log
    const calls: Array<{ args: unknown; tool: string }> = []
    const svc = new AgentSessionService({
      onToolCall: async (_id, tool, args) => {
        calls.push({ args, tool })
        return { success: true, text: 'pong-42' }
      },
      root,
      spawnCodex: async (cwd, opts) => {
        spawnOpts.push(codexSpawnOpts(opts))
        return CodexRpcClient.spawn(process.execPath, [FAKE, '--tool-call'], { cwd })
      },
    })
    services.push(svc)
    const session = await svc.createSession()
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))
    await svc.chooseMode(session.id, 'free')
    await waitFor(() => events.some((e) => e.type === 'turn' && e.status === 'completed'))

    const msgs = readLog(log)
    expect(msgs.find((m) => m.method === 'initialize')?.params).toMatchObject({
      capabilities: { experimentalApi: true },
    })
    const start = msgs.find((m) => m.method === 'thread/start')
    expect((start?.params?.dynamicTools as Array<{ name: string }>).map((t) => t.name)).toEqual([
      'make_video',
      'make_beat_loop',
      'regenerate_clip',
      'render_video',
      'set_music',
      'use_image_as_keyframe',
      'ranking_list',
      'ranking_create',
      'ranking_get',
      'ranking_update',
      'ranking_add_clip',
      'ranking_add_sound',
      'ranking_add_sticker_image',
      'ranking_export',
      'ranking_analyze_reference',
      'ranking_find_moments',
      'ranking_generate_clips',
      'ranking_style_list',
      'ranking_style_get',
      'ranking_style_save',
      'ranking_apply_style',
    ])
    expect(calls).toEqual([{ args: { x: 'hi' }, tool: 'ping' }])
    // The fake finishes the turn with the tool's answer as the agent message.
    expect(events.some((e) => e.type === 'message' && e.text === 'pong-42')).toBe(true)
    expect(events.filter((e) => e.type === 'tool').map((e) => e.status)).toEqual([
      'started',
      'completed',
    ])
  })

  it('sends no dynamicTools for an autonomous session that is not editing', async () => {
    const log = path.join(root, `notools-${Date.now()}.log`)
    process.env.FAKE_LOG = log
    const svc = makeService(root)
    const session = await svc.createSession()
    // chooseMode('autonomous') hands off to the default runner, which rejects; a quiet turn
    // starts the child instead.
    svc['store'].update(session.id, { mode: 'autonomous' })
    await svc.runQuietTurn(session.id, 'hi')
    const start = readLog(log).find((m) => m.method === 'thread/start')
    expect(start?.params).not.toHaveProperty('dynamicTools')
  })
})

describe('edit mode', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-edit-'))

  it('runs an editing Easy session with a shell and no web search', () => {
    expect(appServerArgsForMode('autonomous', true)).toEqual(
      buildAppServerArgs({ webSearch: false }),
    )
  })

  it('beginEditing restarts Codex with the edit config, a new thread and the project link', async () => {
    const log = path.join(root, `edit-${Date.now()}.log`)
    process.env.FAKE_LOG = log
    const svc = makeService(root)
    const session = await svc.createSession()
    svc['store'].update(session.id, { flowActive: false, mode: 'autonomous', projectId: 'p1' })
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'))
    svc.beginEditing(session.id, projectDir)
    expect(svc.getSession(session.id)).toMatchObject({ editing: true, threadId: null })
    expect(fs.readlinkSync(path.join(svc.sessionDir(session.id), 'edit', 'project'))).toBe(
      projectDir,
    )
    expect(events.at(-2)).toMatchObject({
      text: expect.stringContaining('Tell me what to fix'),
      type: 'message',
    })
    expect(events.at(-1)).toEqual({ id: expect.any(Number), type: 'editing' })

    await svc.sendMessage(session.id, 'clip 2 is wrong')
    await waitFor(() => events.some((e) => e.type === 'turn' && e.status === 'completed'))
    expect(spawnOpts.at(-1)).toEqual({ editing: true, mode: 'autonomous' })
    const start = readLog(log).find((m) => m.method === 'thread/start')
    expect(start?.params).toMatchObject({
      cwd: path.join(svc.sessionDir(session.id), 'edit'),
      sandbox: 'workspace-write',
    })
    expect(String(start?.params?.developerInstructions)).toContain('regenerate_clip')
    expect((start?.params?.dynamicTools as Array<{ name: string }>).map((t) => t.name)).toEqual([
      'regenerate_clip',
      'render_video',
      'set_music',
      'use_image_as_keyframe',
    ])
    // Idempotent: a second call changes nothing and posts nothing.
    const count = events.length
    svc.beginEditing(session.id, projectDir)
    expect(events.length).toBe(count)
  })

  it('editing survives a restart: the next service resumes in edit mode', async () => {
    const first = makeService(root)
    const session = await first.createSession()
    first['store'].update(session.id, { flowActive: false, mode: 'autonomous', projectId: 'p1' })
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-'))
    first.beginEditing(session.id, projectDir)
    first.onModuleDestroy()
    const next = makeService(root)
    expect(next.getSession(session.id).editing).toBe(true)
    await next.sendMessage(session.id, 'hi')
    expect(spawnOpts.at(-1)).toEqual({ editing: true, mode: 'autonomous' })
  })

  it('refuses chat in an autonomous session until it is editing', async () => {
    const svc = makeService(root)
    const session = await svc.createSession()
    svc['store'].update(session.id, { flowActive: false, mode: 'autonomous', projectId: 'p1' })
    await expect(svc.sendMessage(session.id, 'hi')).rejects.toBeInstanceOf(ModeNotChattableError)
  })
})

describe('Stop in edit mode', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stop-edit-'))

  it('marks an editing session cancelled until the next tool call clears it', async () => {
    const svc = makeService(root)
    const session = await svc.createSession()
    svc['store'].update(session.id, { flowActive: false, mode: 'autonomous', projectId: 'p1' })
    svc.beginEditing(session.id, fs.mkdtempSync(path.join(os.tmpdir(), 'proj-')))
    expect(svc.isFlowCancelled(session.id)).toBe(false)
    await svc.interrupt(session.id)
    expect(svc.isFlowCancelled(session.id)).toBe(true)
    svc.clearFlowCancelled(session.id)
    expect(svc.isFlowCancelled(session.id)).toBe(false)
  })
})

describe('review fixes: edit mode robustness', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-fixes-'))

  it("beginEditing clears the old child's idle timer so it cannot stop the new child", async () => {
    let spawns = 0
    const svc = new AgentSessionService({
      idleMs: 300,
      root,
      spawnCodex: async (cwd, opts) => {
        spawnOpts.push(codexSpawnOpts(opts))
        spawns += 1
        // The first child answers fast; the second (the edit child) takes 2 s per turn.
        const flags = spawns === 1 ? [] : ['--slow-turn']
        return CodexRpcClient.spawn(process.execPath, [FAKE, ...flags], { cwd })
      },
    })
    services.push(svc)
    const session = await svc.createSession()
    svc['store'].update(session.id, { flowActive: false, mode: 'autonomous', projectId: 'p1' })
    await svc.runQuietTurn(session.id, 'hi') // the first child's idle timer is now pending
    svc.beginEditing(session.id, fs.mkdtempSync(path.join(os.tmpdir(), 'proj-')))
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))
    const replayed = events.length // the quiet turn's own completion is already stored
    await svc.sendMessage(session.id, 'redo clip 2')
    await new Promise((r) => setTimeout(r, 500)) // past the stale timer's 300 ms
    expect(svc.isRunning(session.id)).toBe(true)
    expect(svc.getSession(session.id).status).toBe('running')
    await waitFor(
      () => events.slice(replayed).some((e) => e.type === 'turn' && e.status === 'completed'),
      4000,
    )
    expect(svc.getSession(session.id).status).toBe('idle')
  })

  it('Stop flags a Free chat session so a waiting tool call sees it', async () => {
    const svc = makeService(root)
    const session = await svc.createSession()
    svc['store'].update(session.id, { mode: 'free', projectId: 'p1' })
    expect(svc.isFlowCancelled(session.id)).toBe(false)
    await svc.interrupt(session.id)
    expect(svc.isFlowCancelled(session.id)).toBe(true)
    svc.clearFlowCancelled(session.id)
    expect(svc.isFlowCancelled(session.id)).toBe(false)
  })

  it('a Free thread started before the tools existed is replaced by a new thread with them', async () => {
    const log = path.join(root, `retool-${Date.now()}.log`)
    process.env.FAKE_LOG = log
    const svc = makeService(root, [], { FAKE_THREADS: 'thread-old' })
    const session = await svc.createSession()
    svc['store'].update(session.id, { mode: 'free', threadId: 'thread-old' })
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))
    await svc.sendMessage(session.id, 'hi')
    await waitFor(() => events.some((e) => e.type === 'turn' && e.status === 'completed'))
    const methods = readLog(log).map((m) => m.method)
    expect(methods).toContain('thread/start')
    expect(methods).not.toContain('thread/resume')
    expect(svc.getSession(session.id).tools).toEqual([
      'make_video',
      'make_beat_loop',
      'regenerate_clip',
      'render_video',
      'set_music',
      'use_image_as_keyframe',
      'ranking_list',
      'ranking_create',
      'ranking_get',
      'ranking_update',
      'ranking_add_clip',
      'ranking_add_sound',
      'ranking_add_sticker_image',
      'ranking_export',
      'ranking_analyze_reference',
      'ranking_find_moments',
      'ranking_generate_clips',
      'ranking_style_list',
      'ranking_style_get',
      'ranking_style_save',
      'ranking_apply_style',
    ])
    expect(svc.getSession(session.id).threadId).not.toBe('thread-old')
    expect(events.some((e) => e.type === 'session' && /tools/i.test(e.reason ?? ''))).toBe(true)
    // With the tools recorded, the next child resumes the thread.
    svc.onModuleDestroy()
    const next = makeService(root, [], { FAKE_THREADS: svc.getSession(session.id).threadId ?? '' })
    const log2 = path.join(root, `retool2-${Date.now()}.log`)
    process.env.FAKE_LOG = log2
    await next.sendMessage(session.id, 'again')
    expect(readLog(log2).map((m) => m.method)).toContain('thread/resume')
  })
})

describe('harness choice', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-harness-'))
  const ready = async () => ({ available: true, binary: '/c', loggedIn: true, version: '1' })

  function harnessService(
    over: Partial<ConstructorParameters<typeof AgentSessionService>[0]> = {},
  ) {
    const spawns: SpawnOptions[] = []
    const log = path.join(root, `harness-${Date.now()}-${Math.random()}.log`)
    process.env.FAKE_LOG = log
    const svc = new AgentSessionService({
      harnessStatus: ready,
      root,
      spawnCodex: async (cwd, opts) => {
        spawns.push(opts)
        return CodexRpcClient.spawn(process.execPath, [FAKE], { cwd })
      },
      ...over,
    })
    services.push(svc)
    return { log, spawns, svc }
  }

  it('records the harness with the mode and starts that harness with its tools', async () => {
    const { spawns, svc } = harnessService()
    const session = await svc.createSession()
    await svc.chooseMode(session.id, 'free', 'claude')
    await waitFor(() => svc.getSession(session.id).status === 'idle')
    expect(svc.getSession(session.id)).toMatchObject({ harness: 'claude', mode: 'free' })
    expect(spawns[0]).toMatchObject({ harness: 'claude', mode: 'free' })
    expect(spawns[0]?.tools.map((t) => t.name)).toContain('generate_image')
  })

  it('uses the Claude tool names in the brief and the kickoff', async () => {
    const { log, svc } = harnessService()
    const session = await svc.createSession()
    await svc.chooseMode(session.id, 'free', 'claude')
    await waitFor(() => svc.getSession(session.id).status === 'idle')
    const entries = readLog(log)
    const threadStart = entries.find((e) => e.method === 'thread/start')
    expect(threadStart?.params?.['developerInstructions']).toBe(
      briefFor({ mode: 'free' }, 'claude'),
    )
    expect(threadStart?.params?.['developerInstructions']).toContain('AskUserQuestion')
    expect(entries.find((e) => e.method === 'turn/start')?.params?.['input']).toEqual([
      { text: kickoffFor('claude'), type: 'text' },
    ])
  })

  it('defaults to AGENT_HARNESS, else codex', async () => {
    const { spawns, svc } = harnessService()
    const a = await svc.createSession()
    await svc.chooseMode(a.id, 'free')
    await waitFor(() => svc.getSession(a.id).status === 'idle')
    expect(svc.getSession(a.id).harness).toBe('codex')
    expect(spawns[0]).toMatchObject({ harness: 'codex' })
    process.env.AGENT_HARNESS = 'claude'
    try {
      const b = await svc.createSession()
      await svc.chooseMode(b.id, 'free')
      expect(svc.getSession(b.id).harness).toBe('claude')
    } finally {
      delete process.env.AGENT_HARNESS
    }
  })

  it('keeps the agent picked when the chat was created, and uses it for the mode', async () => {
    const { spawns, svc } = harnessService()
    const session = await svc.createSession({ harness: 'claude' })
    expect(svc.getSession(session.id).harness).toBe('claude')
    await svc.chooseMode(session.id, 'free')
    await waitFor(() => svc.getSession(session.id).status === 'idle')
    expect(svc.getSession(session.id)).toMatchObject({ harness: 'claude', mode: 'free' })
    expect(spawns[0]).toMatchObject({ harness: 'claude' })
  })

  it('refuses a harness that is not ready, leaving the mode unchosen', async () => {
    const { svc } = harnessService({
      harnessStatus: async () => ({
        available: false,
        binary: '/c',
        loggedIn: false,
        reason: 'not-logged-in',
        version: '1',
      }),
    })
    const session = await svc.createSession()
    await expect(svc.chooseMode(session.id, 'free', 'claude')).rejects.toBeInstanceOf(
      HarnessNotReadyError,
    )
    expect(svc.getSession(session.id).mode).toBeUndefined()
  })

  it('names Claude in its notices', async () => {
    const { svc } = harnessService({
      spawnCodex: () => Promise.reject(new Error('no claude')),
    })
    const session = await svc.createSession()
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, 0, (e) => events.push(e))
    await svc.chooseMode(session.id, 'free', 'claude')
    await waitFor(() => events.some((e) => e.type === 'session' && e.status === 'stopped'))
    expect(events).toContainEqual(
      expect.objectContaining({ reason: 'Claude could not start: no claude', type: 'session' }),
    )
  })
})

describe('a turn that ends on a replaced child', () => {
  it('is ignored: no event, no status change, no idle timer for the new child', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stale-'))
    const handlers: ((msg: { method: string; params?: Record<string, unknown> }) => void)[] = []
    let turnsStarted = 0
    const fakeChild = (): AgentAppServer => ({
      close: () => undefined,
      notify: () => undefined,
      onExit: () => undefined,
      onNotification: (fn) => void handlers.push(fn),
      onServerRequest: () => undefined,
      request: async <T>(method: string) => {
        if (method === 'turn/start') turnsStarted++
        return (
          method === 'thread/start'
            ? { thread: { id: 't1' } }
            : method === 'turn/start'
              ? { turn: { id: 'turn-1' } }
              : {}
        ) as T
      },
    })
    const svc = new AgentSessionService({
      harnessStatus: async () => ({ available: true, binary: '/c', loggedIn: true, version: '1' }),
      root,
      spawnCodex: async () => fakeChild(),
    })
    services.push(svc)
    const session = await svc.createSession()
    await svc.chooseMode(session.id, 'free', 'claude')
    await waitFor(() => turnsStarted === 1)
    svc.beginEditing(session.id, fs.mkdtempSync(path.join(os.tmpdir(), 'agent-stale-project-')))
    const events: AgentUiEvent[] = []
    svc.subscribe(session.id, Number.MAX_SAFE_INTEGER, (e) => events.push(e))
    handlers[0]?.({
      method: 'turn/completed',
      params: { turn: { id: 'turn-1', status: 'interrupted' } },
    })
    expect(events).toEqual([])
    expect(svc.getSession(session.id).status).toBe('running')
  })
})
