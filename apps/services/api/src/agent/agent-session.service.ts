import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import {
  chatTitleFrom,
  DEFAULT_CHAT_TITLE,
  isUnsetChatTitle,
} from '@reelmakeeasy/common/codex-agent/agent-sessions'
import { splitRecommended } from '@reelmakeeasy/common/codex-agent/agent-storyboard'
import { REELMAKEEASY_MESSAGE_PREFIX } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import { Logger } from '@reelmakeeasy/common/logger'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Injectable, NotFoundException, OnModuleDestroy, Optional } from '@nestjs/common'
import type {
  AgentAnswers,
  AgentAttachment,
  AgentHarnessName,
  AgentMode,
  AgentMotionSetupView,
  AgentQuestion,
  AgentResumeAction,
  AgentSession,
  AgentUiEvent,
  ChatModelChoice,
  HarnessStatus,
} from '@shared/types/api/agent'
import {
  isRankingMode,
  isRankingTopicQuestion,
  RANKING_TOPIC_QUESTION_PREFIX,
} from '@shared/types/api/agent'

import type { AgentAppServer } from './claude/agent-app-server'
import { ClaudeAppServer } from './claude/claude-app-server'
import { defaultHarness } from './claude/claude-config'
import { getClaudeStatus, resolveClaudeBinaryOrThrow } from './claude/claude-locator'
import { buildAppServerArgs, scrubCodexEnv } from './codex/codex-config'
import { mapCodexNotification } from './codex/codex-events'
import { ensureAgentCodexHome } from './codex/codex-home'
import { resolveCodexBinaryOrThrow } from './codex/codex-locator'
import { CodexRpcClient, type RpcId } from './codex/codex-rpc'
import { type DynamicToolSpec, type ToolCallResult, toolsForSession } from './tools/agent-tools'
import {
  type AgentTurnInput,
  attachmentsDir as attachmentsFolder,
  resolveAttachment,
  turnInput,
} from './agent-attachments'
import {
  briefFor,
  EDIT_INTRO,
  kickoffFor,
  RANKING_TOPIC_ID,
  rankingKickoff,
  rankingTopicQuestion,
} from './agent-brief'
import { AgentSessionStore } from './agent-session.store'

/** Drives an autonomous session once the user picks that mode (`AutonomousService`
 *  in the app; a session built without one falls back to a runner that always fails). */
export interface AutonomousRunner {
  /** The user pressed Stop: end the flow if it is only waiting (e.g. for a style). Work in
   *  flight sees `isFlowCancelled` and stops at its next step. */
  cancel?(sessionId: string): void
  /** Picks a flow a restart cut off up where it left off (`resumeFlow` has claimed it, in the
   *  working state, which the runner ends once it carries on). */
  resume?(sessionId: string): Promise<void>
  /** What `resume` will do for a flow a restart cut off, for the chat's view (its button says
   *  so before the click). Missing: the plain "Pick up where you left off" (`carry_on`). */
  resumeAction?(sessionId: string): AgentResumeAction
  start(sessionId: string): Promise<void>
}

/** Why a session stopped when ReelMakeEasy itself stopped it: a clean shutdown, or the next start
 *  after a crash. */
export const SHUTDOWN_REASON = 'ReelMakeEasy is shutting down'
export const RESTARTED_REASON = 'ReelMakeEasy restarted'

const defaultAutonomousRunner: AutonomousRunner = {
  start: () => Promise.reject(new Error('Autonomous mode is not available yet')),
}

export interface SessionDeps {
  autonomous?: AutonomousRunner
  /** The model a chat's turns run on (picked, saved default or recommended); unset or
   *  null leaves the harness's own default. */
  chatModels?: {
    choiceFor(harness: AgentHarnessName, chat?: ChatModelChoice): ChatModelChoice | null
    /** A Motion Reel chat's model (Opus or Astra, at medium thinking or more). */
    motionChoiceFor?(harness: AgentHarnessName, chat?: ChatModelChoice): ChatModelChoice | null
  }
  /** Whether a harness can run a chat now (default: the Claude Code probe; Codex is checked
   *  when it starts, as before). */
  harnessStatus?: (harness: AgentHarnessName) => Promise<HarnessStatus | null>
  idleMs?: number
  /** Runs a ReelMakeEasy tool the agent called (`item/tool/call`); the text goes back to it. */
  onToolCall?: (sessionId: string, tool: string, args: unknown) => Promise<ToolCallResult>
  root?: string
  /** Starts a session's agent (its Codex app-server, or Claude Code behind the same protocol);
   *  `opts.harness` picks which, `opts.mode` decides its tools. */
  spawnCodex?: (cwd: string, opts: SpawnOptions) => Promise<AgentAppServer>
}

/** What `SessionDeps.spawnCodex` needs to know about the session it starts the agent for. */
export interface SpawnOptions {
  /** The session is editing its finished video: shell on, web search off. */
  editing?: boolean
  harness: AgentHarnessName
  mode: AgentMode | undefined
  /** The ReelMakeEasy tools the session declares (Claude takes them with every turn). */
  tools: DynamicToolSpec[]
}

/** Options for a quiet turn (`runQuietTurn`). */
export interface QuietTurnOptions {
  effort?: 'high' | 'low' | 'medium'
  outputSchema?: Record<string, unknown>
}

interface Live {
  client: AgentAppServer
  /** Turn ids whose terminal notification arrived before `sendMessage`'s
   *  `turn/start` continuation ran (same-chunk completion) - so that
   *  continuation knows not to resurrect a `currentTurnId` for a turn that's
   *  already finished. */
  completedTurnIds: Set<string>
  currentTurnId: null | string
  idleTimer?: NodeJS.Timeout
  /** Questions Codex is waiting on, keyed by question id. */
  questions: Map<string, PendingQuestion>
  /** Runs while a question is open: if nobody answers within `idleMs`, the turn is
   *  interrupted, so an abandoned question can't keep the child alive forever. */
  questionTimer?: NodeJS.Timeout
  /** Set while a quiet turn runs (from just before its `turn/start` until it ends). */
  quiet?: QuietTurn
  /** The child was stopped or replaced: whatever it still says is ignored (a Claude turn can
   *  end after its child is closed). */
  stopped?: boolean
}

/** The quiet turn in flight on a child: its agent message is kept here instead of shown. */
interface QuietTurn {
  settle: (outcome: { error: Error } | { text: string }) => void
  /** The last agent message of the turn. */
  text: null | string
}

/** An open `item/tool/requestUserInput` request: settling it answers Codex. */
interface PendingQuestion {
  questionIds: string[]
  reject: (error: Error) => void
  requestId: RpcId
  resolve: (result: unknown) => void
  /** Ids of `isSecret` questions: their answers go to Codex but are never stored or shown. */
  secretIds: Set<string>
}

/** A question ReelMakeEasy itself asks (autonomous mode); Codex never sees it or its answer. */
interface ServerQuestion {
  questionIds: string[]
  reject: (error: Error) => void
  resolve: (answers: AgentAnswers) => void
  secretIds: Set<string>
}

type Stored = AgentUiEvent & { id: number }

interface Subscriber {
  fn: (e: Stored) => void
  /** Ends the subscriber's stream (the service is shutting down). */
  onEnd?: () => void
}

/** Thrown by `sendMessage` when the session already has a turn in flight. */
/** A message named an attachment that isn't saved in the chat's `attachments/` folder. */
export class AgentSessionBusyError extends Error {
  constructor(readonly sessionId: string) {
    super(`Agent session ${sessionId} is busy`)
    this.name = 'AgentSessionBusyError'
  }
}

export class UnknownAttachmentError extends Error {
  constructor(name: string) {
    super(`No attached file named ${JSON.stringify(name)}: attach it again.`)
  }
}

/** Thrown by `answerQuestion` when the question isn't waiting for an answer (any more). */
export class QuestionNotOpenError extends Error {
  constructor(readonly questionId: string) {
    super(`Question ${questionId} is not open`)
    this.name = 'QuestionNotOpenError'
  }
}

/** A server question's asker gets this when a newer card replaced the question. */
export class QuestionReplacedError extends Error {
  constructor(readonly questionId: string) {
    super(`Question ${questionId} was replaced by a newer one`)
    this.name = 'QuestionReplacedError'
  }
}

/** Thrown by `answerQuestion` when the answers don't fit the open question. */
export class InvalidAnswerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvalidAnswerError'
  }
}

/** Files sent while an Easy ranking's topic card is open: they can't say what it's about. */
export class PickTopicFirstError extends Error {
  constructor() {
    super('Pick what the ranking is about first (the card above), then attach your clips.')
    this.name = 'PickTopicFirstError'
  }
}

/** A quiet turn or a server question ended because the user stopped the session (or ReelMakeEasy
 *  shut down), not because anything failed: whoever was waiting on it should stop quietly. */
export class AgentFlowCancelledError extends Error {
  constructor(message = 'Stopped') {
    super(message)
    this.name = 'AgentFlowCancelledError'
  }
}

/** Thrown by `sendMessage` while an autonomous flow runs: the user answers its cards instead. */
export class FlowActiveError extends Error {
  constructor(readonly sessionId: string) {
    super('Autonomous mode is making your video — answer the cards above.')
    this.name = 'FlowActiveError'
  }
}

/** Thrown by `sendMessage` for an autonomous session whose flow is over (its video started, or
 *  it was stopped): that session is not a free chat. */
export class ModeNotChattableError extends Error {
  constructor(readonly sessionId: string) {
    super('This autonomous session is finished. Start a new session to chat.')
    this.name = 'ModeNotChattableError'
  }
}

/** Thrown by `sendMessage` for a Motion Reel chat whose setup card hasn't been sent yet. */
export class MotionSetupPendingError extends Error {
  constructor(readonly sessionId: string) {
    super('Fill in the Motion Reel card above first.')
    this.name = 'MotionSetupPendingError'
  }
}

/** Thrown by `resumeFlow` for a chat with nothing to pick up; the message says why, plainly. */
export class NotResumableError extends Error {
  constructor(
    readonly sessionId: string,
    message: string,
  ) {
    super(message)
    this.name = 'NotResumableError'
  }
}

/** Thrown by `resumeFlow` while ReelMakeEasy shuts down: a flow picked up now would die with this
 *  process. The chat stays as it was, to pick up on the next start. */
export class ShuttingDownError extends Error {
  constructor(readonly sessionId: string) {
    super('ReelMakeEasy is restarting. Try again in a moment.')
    this.name = 'ShuttingDownError'
  }
}

/** Thrown by `chooseMode` when the picked harness can't run a chat now (not installed, signed
 *  out, not answering). */
export class HarnessNotReadyError extends Error {
  constructor(
    readonly harness: AgentHarnessName,
    readonly reason: string | undefined,
  ) {
    super(`${harnessLabel(harness)} is not ready (${reason ?? 'unknown'})`)
    this.name = 'HarnessNotReadyError'
  }
}

/** Thrown by `chooseMode` when the session already has a mode. */
export class ModeAlreadyChosenError extends Error {
  constructor(readonly sessionId: string) {
    super(`Agent session ${sessionId} already has a mode`)
    this.name = 'ModeAlreadyChosenError'
  }
}

const IDLE_MS = 15 * 60 * 1000
const MAX_ANSWER_CHARS = 2000
const MAX_ANSWERS_PER_QUESTION = 20
/** Stands in for a secret answer in stored (and replayed) events. */
const SECRET_MASK = '••••'
const spawnLogger = new Logger('AgentCodexHome')
const resumeFailedNotice = (who: string) =>
  `${who} could not resume the earlier conversation; started a new one.`
const toolsAddedNotice = (who: string) =>
  `${who} started a new conversation to gain ReelMakeEasy's video tools; it won't remember the earlier messages.`

/** How the chat names its agent. */
export function harnessLabel(harness: AgentHarnessName | undefined): 'Claude' | 'Codex' {
  return harness === 'claude' ? 'Claude' : 'Codex'
}

/**
 * The app-server argv for a session in `mode`. Web search and a shell never run together:
 * Autonomous mode searches the web for its ideas, so its Codex has no shell tool (and
 * a read-only sandbox, see `sandboxForMode`), so a poisoned page can't make it read and leak
 * a file. Free chat keeps its shell, with web search off.
 */
export function appServerArgsForMode(mode: AgentMode | undefined, editing = false): string[] {
  // An editing Easy session needs the shell (ffmpeg, reading the project files) and no web.
  return mode === 'autonomous' && !editing
    ? buildAppServerArgs({ shell: false, webSearch: true })
    : buildAppServerArgs({ webSearch: false })
}

/** The thread sandbox for a session in `mode` (thread/start and thread/resume). */
function sandboxForMode(
  mode: AgentMode | undefined,
  editing = false,
): 'read-only' | 'workspace-write' {
  return mode === 'autonomous' && !editing ? 'read-only' : 'workspace-write'
}

async function spawnUserCodex(cwd: string, opts: SpawnOptions): Promise<CodexRpcClient> {
  const binary = await resolveCodexBinaryOrThrow()
  const home = ensureAgentCodexHome({ warn: (msg) => spawnLogger.warn(msg) })
  return CodexRpcClient.spawn(binary, appServerArgsForMode(opts.mode, opts.editing), {
    cwd,
    env: { ...scrubCodexEnv(process.env), CODEX_HOME: home },
  })
}

/** Starts the session's agent: the user's Codex, or their Claude Code behind the same protocol. */
async function spawnAgent(cwd: string, opts: SpawnOptions): Promise<AgentAppServer> {
  if (opts.harness !== 'claude') return spawnUserCodex(cwd, opts)
  const binary = await resolveClaudeBinaryOrThrow()
  return new ClaudeAppServer({
    binary,
    cwd,
    editing: !!opts.editing,
    mode: opts.mode,
    tools: opts.tools,
  })
}

/** Claude Code must be found and signed in before a chat picks it; Codex keeps failing at its
 *  start, as it always has (its card says why). */
const defaultHarnessStatus = (harness: AgentHarnessName): Promise<HarnessStatus | null> =>
  harness === 'claude' ? getClaudeStatus({ refresh: true }) : Promise.resolve(null)

@Injectable()
export class AgentSessionService implements OnModuleDestroy {
  /** Autonomous flows the user stopped; cleared when the flow ends (`endAutonomousFlow`). */
  private readonly cancelledFlows = new Set<string>()
  private readonly deps: Required<SessionDeps>
  /** Set by `onModuleDestroy`: no new children, and new streams end at once. */
  private destroyed = false
  /** Sessions whose working state the autonomous flow set (`setFlowWorking`), not a turn. */
  private readonly flowWorking = new Set<string>()
  private readonly live = new Map<string, Live>()
  private readonly logger = new Logger(AgentSessionService.name)
  /** Notes for a chat's agent (`notifyAgent`) that wait for its running turn to end. */
  private readonly notes = new Map<string, string[]>()
  /** Open ReelMakeEasy-made questions, by session then question id. Kept apart from `Live`
   *  because they don't belong to a Codex turn or child: they stay open while no child runs
   *  (and through its idle stop), and expire only on Stop (`interrupt`) or shutdown. */
  private readonly serverQuestions = new Map<string, Map<string, ServerQuestion>>()
  /** In-flight `ensureLive` calls, keyed by session id, so two callers arriving
   *  before the child has finished starting share one spawn instead of racing. */
  private readonly starting = new Map<string, Promise<Live>>()
  private readonly store: AgentSessionStore
  private readonly subscribers = new Map<string, Set<Subscriber>>()

  constructor(@Optional() deps?: SessionDeps) {
    this.deps = {
      autonomous: deps?.autonomous ?? defaultAutonomousRunner,
      // No catalog: every chat runs on its harness's own default model.
      chatModels: deps?.chatModels ?? { choiceFor: () => null },
      harnessStatus: deps?.harnessStatus ?? defaultHarnessStatus,
      idleMs: deps?.idleMs ?? IDLE_MS,
      onToolCall:
        deps?.onToolCall ?? (async () => ({ success: false, text: 'No tools in this chat.' })),
      root: deps?.root ?? path.join(dataDir(), 'agent'),
      spawnCodex: deps?.spawnCodex ?? spawnAgent,
    }
    this.store = new AgentSessionStore(this.deps.root)
    // A session left `running` can only mean the previous process died without
    // a clean shutdown (crash, kill -9): there is no child for it any more. An autonomous flow
    // still under way is gone too (its state and open cards lived in memory), even if the
    // session was idle waiting on one of its cards.
    // An Easy flow cut off that way can pick up where it left off (`resumeFlow`).
    for (const session of this.store.list()) {
      if (session.status !== 'running' && !session.flowActive) {
        this.markEarlierCutOff(session)
        this.reopenServerCards(session)
        continue
      }
      // A restart is not activity: don't bump `updatedAt` for a session that crashed long ago.
      // Kept either way for an Easy chat, so it is never judged again from its events.
      this.store.update(
        session.id,
        {
          flowActive: false,
          status: 'stopped',
          ...(session.mode === 'autonomous' ? { interrupted: easyFlowUnderWay(session) } : {}),
        },
        { touch: false },
      )
      // Its open cards lived in memory too: they expire, as Stop and a shutdown expire them.
      for (const questionId of openServerQuestionIds(this.store.eventsAfter(session.id, 0)))
        this.emit(session.id, { questionId, type: 'question_expired' }, { touch: false })
      this.emit(session.id, { reason: RESTARTED_REASON, status: 'stopped', type: 'session' })
    }
  }

  /** Answers an open question; Codex's turn carries on from there. Throws
   *  `QuestionNotOpenError` or `InvalidAnswerError` (the question stays open). */
  answerQuestion(id: string, questionId: string, answers: AgentAnswers): void {
    const live = this.live.get(id)
    const codexQuestion = live?.questions.get(questionId)
    const serverQuestion = this.serverQuestions.get(id)?.get(questionId)
    const question = codexQuestion ?? serverQuestion
    if (!question) throw new QuestionNotOpenError(questionId)
    const trimmed = validateAnswers(answers, question.questionIds)
    if (live && codexQuestion) {
      live.questions.delete(questionId)
      this.settleQuestionTimer(id, live)
      codexQuestion.resolve({
        answers: Object.fromEntries(
          question.questionIds.map((key) => [key, { answers: trimmed[key] }]),
        ),
      })
    } else if (serverQuestion) {
      // Answered here, never sent to Codex: the asker gets the trimmed answers as they are.
      this.dropServerQuestion(id, questionId)
      serverQuestion.resolve(trimmed)
    }
    const shown = Object.fromEntries(
      question.questionIds.map((key) => [
        key,
        question.secretIds.has(key) ? trimmed[key].map(() => SECRET_MASK) : trimmed[key],
      ]),
    )
    this.emit(id, { answers: shown, questionId, type: 'question_answered' })
  }

  /** Posts a ReelMakeEasy-made question card (the same `question` event Codex's questions use).
   *  Resolves with the trimmed answers once it is answered through `answerQuestion`; rejects with
   *  `AgentFlowCancelledError` if the user stops the session (or ReelMakeEasy shuts down) first.
   *  Needs no running Codex, and Codex never sees the question or its answer. */
  async askServerQuestion(
    id: string,
    questionId: string,
    questions: AgentQuestion[],
    /** `show: false`: the chat already shows this card (a restart re-arms it); `touch: false`:
     *  posting it isn't activity (a restart asking again). */
    opts: { show?: boolean; touch?: boolean } = {},
  ): Promise<AgentAnswers> {
    // Everything up to the card's `question` event runs synchronously, at the call.
    this.getSession(id)
    const open = this.serverQuestions.get(id) ?? new Map<string, ServerQuestion>()
    if (open.has(questionId) || this.live.get(id)?.questions.has(questionId))
      throw new Error(`Question ${questionId} is already open`)
    this.serverQuestions.set(id, open)
    return await new Promise((resolve, reject) => {
      open.set(questionId, {
        questionIds: questions.map((q) => q.id),
        reject,
        resolve,
        secretIds: new Set(questions.filter((q) => q.isSecret).map((q) => q.id)),
      })
      // `server`: the chat keeps it open when the agent's turn ends (it is answered here).
      if (opts.show !== false)
        this.emit(id, { questionId, questions, server: true, type: 'question' }, opts)
    })
  }

  /** Where the files a user attaches to this chat's messages are saved. */
  attachmentsDir(id: string): string {
    return attachmentsFolder(this.workingDir(id))
  }

  /** Enters edit mode: the chat opens, Codex restarts with the edit config on a new thread, and
   *  the intro tells the user what to say. Idempotent. */
  beginEditing(id: string, projectDir: string): void {
    if (this.getSession(id).editing) return
    this.stopLive(id)
    this.store.update(id, { editing: true, threadId: null })
    this.linkProject(id, projectDir)
    this.emitMessage(id, EDIT_INTRO)
    this.emit(id, { type: 'editing' })
  }

  /** Picks the session's mode exactly once; throws `ModeAlreadyChosenError` if it is already
   *  set. Synchronous up to the first await, like `sendMessage`, so a concurrent call sees the
   *  mode already claimed. Resolves as soon as the mode is recorded and the `mode` event is
   *  emitted - it does not wait for the kickoff turn or the autonomous run, which (once Task 4
   *  lands) could be the whole autonomous video. Free chat starts its hidden kickoff
   *  turn detached: `runTurn` already turns a failure into a `Codex could not start: ...` stopped
   *  notice and rethrows, so the rejection here is only logged, not shown again. Autonomous hands
   *  the session to `deps.autonomous`, detached; its rejection (the default runner always
   *  rejects) surfaces as a stopped session rather than leaving it `running` forever.
   *  `harness` (default: the one picked when the chat was created, else `AGENT_HARNESS`) is fixed
   *  with the mode; a harness that isn't ready throws `HarnessNotReadyError` and leaves the mode
   *  unchosen. */
  async chooseMode(
    id: string,
    mode: AgentMode,
    picked?: AgentHarnessName,
    /** A Ranking chat's first message, typed before the chat opened (the studio's "Edit with
     *  agent" box): shown as the user's, and the first turn does it. */
    request?: string,
  ): Promise<void> {
    const session = this.getSession(id)
    if (session.mode) throw new ModeAlreadyChosenError(id)
    const harness = picked ?? session.harness ?? defaultHarness()
    const status = await this.deps.harnessStatus(harness)
    if (status && !status.available) throw new HarnessNotReadyError(harness, status.reason)
    // Checked again after the probe: a concurrent call may have claimed the mode meanwhile.
    if (this.getSession(id).mode) throw new ModeAlreadyChosenError(id)
    // Autonomous mode locks the chat (`flowActive`) from here until its flow ends.
    this.store.update(
      id,
      mode === 'autonomous' ? { flowActive: true, harness, mode } : { harness, mode },
    )
    this.emit(id, { mode, type: 'mode' })
    // A Motion Reel starts with its setup card; the agent's first turn waits for it
    // (`startMotionReel`).
    if (mode === 'motion') {
      this.emit(id, { type: 'motion_setup_request' })
      return
    }
    // Easy ranking with nothing to go on yet: ReelMakeEasy asks what it's about with its own
    // card (topic ideas, or their own words), and the agent starts once it is answered.
    if (mode === 'ranking_easy' && !request?.trim() && !session.rankingId) {
      void this.askRankingTopic(id, harness)
      return
    }
    if (mode === 'free' || isRankingMode(mode)) {
      const asked = isRankingMode(mode) ? request?.trim() : undefined
      if (asked) {
        if (isUnsetChatTitle(session.title))
          this.store.update(id, { title: chatTitleFrom(asked) }, { touch: false })
        this.emit(id, { text: asked, type: 'user_message' })
      }
      const prompt = isRankingMode(mode)
        ? rankingKickoff(harness, session.rankingId, mode === 'ranking_easy', asked)
        : kickoffFor(harness)
      void this.startKickoff(id, prompt).catch((error: unknown) =>
        this.logger.warn(`Kickoff for ${id} failed: ${ensureError(error).message}`),
      )
      return
    }
    void this.deps.autonomous.start(id).catch((error: unknown) => {
      this.endAutonomousFlow(id)
      this.store.update(id, { status: 'stopped' })
      this.emit(id, { reason: ensureError(error).message, status: 'stopped', type: 'session' })
    })
  }

  /** A new tool call starts: an earlier Stop no longer applies to it. */
  clearFlowCancelled(id: string): void {
    if (!this.getSession(id).flowActive) this.cancelledFlows.delete(id)
  }

  /** A new chat; `harness` is the agent picked before opening it (the Agent dialog), which its
   *  mode card then uses without asking again. */
  async createSession(
    input: { harness?: AgentHarnessName; rankingId?: string; title?: string } = {},
  ): Promise<AgentSession> {
    const session = this.store.create({
      id: randomUUID(),
      title: input.title?.trim() || DEFAULT_CHAT_TITLE,
    })
    if (input.harness) this.store.update(session.id, { harness: input.harness })
    if (input.rankingId) this.store.update(session.id, { rankingId: input.rankingId })
    return this.getSession(session.id)
  }

  /** Deletes a chat: its idle Codex child, open cards and event streams, then its record and
   *  folder. Refused while the autonomous flow sets up the video (`FlowActiveError`) or a
   *  Codex turn runs or starts (`AgentSessionBusyError`): stop it first. The project it made
   *  is not touched here (the controller clears the project's link). */
  deleteSession(id: string): void {
    const session = this.getSession(id)
    if (session.flowActive) throw new FlowActiveError(id)
    if (session.status === 'running' || this.starting.has(id)) throw new AgentSessionBusyError(id)
    const live = this.live.get(id)
    if (live) {
      // Not `stopLive`: it never clears `idleTimer`, which (unlike its usual caller, the
      // idle timer itself firing) is still pending here and would otherwise leak.
      clearTimeout(live.idleTimer)
      clearTimeout(live.questionTimer)
      this.expireQuestions(id, live)
      this.settleQuiet(live, { error: new AgentFlowCancelledError('Chat deleted') })
      this.live.delete(id)
      live.client.close()
    }
    this.expireServerQuestions(id)
    this.serverQuestions.delete(id)
    this.notes.delete(id)
    this.cancelledFlows.delete(id)
    this.flowWorking.delete(id)
    for (const sub of this.subscribers.get(id) ?? []) this.endSubscriber(sub)
    this.subscribers.delete(id)
    this.store.delete(id)
  }

  /** Emits one of the autonomous flow's own events (its brief, style request/choice, video started, the
   *  user stopped it). */
  emitAutonomousEvent(
    id: string,
    event: Extract<
      AgentUiEvent,
      {
        type:
          | 'brief'
          | 'flow_cancelled'
          | 'motion_setup_request'
          | 'motion_video'
          | 'style_chosen'
          | 'style_request'
          | 'video_rendered'
          | 'video_started'
      }
    >,
  ): void {
    this.emit(id, event)
  }

  /** Shows a picture ReelMakeEasy made in the chat (a Motion Reel's still); `file` must lie in
   *  the session's folder, which is where the chat's image route serves from. */
  emitImage(id: string, file: string): void {
    this.emit(id, {
      itemId: `${REELMAKEEASY_MESSAGE_PREFIX}img-${this.store.nextEventId(id)}`,
      path: file,
      type: 'image',
    })
  }

  /** Posts a ReelMakeEasy-authored assistant message (not from Codex). Its item id `ly-<n>` is
   *  the event's own id, so it is unique in the session and never collides with Codex's. */
  emitMessage(id: string, text: string): void {
    this.emit(id, {
      itemId: `${REELMAKEEASY_MESSAGE_PREFIX}${this.store.nextEventId(id)}`,
      text,
      type: 'message',
    })
  }

  /** Posts a ReelMakeEasy-authored notice, e.g. an autonomous step that failed. */
  emitNotice(id: string, text: string): void {
    this.emit(id, { text, type: 'notice' })
  }

  /** The autonomous flow is over (video started, stopped, failed): its lock (`flowActive`),
   *  cancellation and question bookkeeping go. The session stays closed to chat
   *  (`ModeNotChattableError`). */
  endAutonomousFlow(id: string): void {
    this.cancelledFlows.delete(id)
    if (this.serverQuestions.get(id)?.size === 0) this.serverQuestions.delete(id)
    if (this.store.get(id)?.flowActive) this.store.update(id, { flowActive: false })
  }

  /** Every event of the session's chat, in order (an interrupted flow reads its answers here). */
  events(id: string): AgentUiEvent[] {
    this.getSession(id)
    return this.store.eventsAfter(id, 0)
  }

  /** Closes one open ReelMakeEasy-made question that a newer card replaces: the user sees it expire,
   *  and its asker's promise rejects (`QuestionReplacedError`). Nothing when it isn't open. */
  expireServerQuestion(id: string, questionId: string): void {
    const question = this.serverQuestions.get(id)?.get(questionId)
    if (!question) return
    this.dropServerQuestion(id, questionId)
    question.reject(new QuestionReplacedError(questionId))
    this.emit(id, { questionId, type: 'question_expired' })
  }

  /** A file attached to one of this chat's messages, by its saved name, or null. It is looked
   *  for in both working folders: the chat's own, and `edit/` once the video is being edited. */
  findAttachment(id: string, name: string): AgentAttachment | null {
    const dir = this.store.sessionDir(id)
    return (
      resolveAttachment(attachmentsFolder(dir), name) ??
      resolveAttachment(attachmentsFolder(path.join(dir, 'edit')), name)
    )
  }

  /** A Ranking chat's tools read or changed this ranking: the chat follows it, and its preview
   *  reloads. */
  followRanking(id: string, rankingId: string): void {
    const session = this.store.get(id)
    if (!session || !isRankingMode(session.mode)) return
    if (session.rankingId !== rankingId) this.store.update(id, { rankingId }, { touch: false })
    this.emit(id, { rankingId, type: 'ranking' })
  }

  getSession(id: string): AgentSession {
    const session = this.store.get(id)
    if (!session) throw new NotFoundException(`Unknown agent session ${id}`)
    return session
  }

  /** Stops the running turn, if any, and expires every open ReelMakeEasy-made question, so a
   *  autonomous flow waiting on one stops too. */
  async interrupt(id: string): Promise<void> {
    const live = this.live.get(id)
    const { editing, flowActive, threadId } = this.getSession(id)
    const { mode } = this.getSession(id)
    if (flowActive) {
      // Even with no turn to interrupt (a cold start, or between steps): the flow stops at
      // its next step, and a quiet turn still starting never starts.
      this.cancelledFlows.add(id)
      // Kept at once: a restart before the flow sees the Stop must not offer to pick it up.
      if (mode === 'autonomous' && !editing) this.store.update(id, { stoppedByUser: true })
      this.deps.autonomous.cancel?.(id)
    }
    // Editing, or a Free chat (whose tools may be waiting on a clip or a render): the
    // waiting tool sees the flag and cancels its workflow.
    if (editing || mode === 'free' || mode === 'motion' || isRankingMode(mode))
      this.cancelledFlows.add(id)
    this.expireServerQuestions(id)
    if (!live?.currentTurnId || !threadId) return
    await live.client.request('turn/interrupt', { threadId, turnId: live.currentTurnId })
  }

  /** The user stopped this session's autonomous flow (or, while editing, its tool call). */
  isFlowCancelled(id: string): boolean {
    return this.cancelledFlows.has(id)
  }

  isRunning(id: string): boolean {
    return this.live.has(id)
  }

  /** Links the finished video's project folder into the working folder as `project`, with a
   *  `frames/` folder for the stills Codex pulls out of clips. */
  linkProject(id: string, projectDir: string): void {
    const dir = this.workingDir(id)
    fs.mkdirSync(path.join(dir, 'frames'), { recursive: true })
    const link = path.join(dir, 'project')
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link)
    } catch {
      // No link yet.
    }
    fs.symlinkSync(projectDir, link)
  }

  listSessions(): AgentSession[] {
    return this.store.list()
  }

  /**
   * Tells the chat's agent something that happened after its turn (a loop short's run failed),
   * in a hidden turn: the user sees the agent's answer, never the note. Only a chat with an
   * agent to talk to gets it (Free chat, or Easy once editing). While a turn runs, the
   * note waits for it to end; notes that pile up go together.
   */
  notifyAgent(id: string, text: string): void {
    const session = this.store.get(id)
    if (!session || this.destroyed || !text.trim()) return
    const chat =
      session.mode === 'free' ||
      session.mode === 'motion' ||
      isRankingMode(session.mode) ||
      !!session.editing
    if (!chat) return
    this.notes.set(id, [...(this.notes.get(id) ?? []), text.trim()])
    this.sendNotes(id)
  }

  onModuleDestroy(): void {
    this.destroyed = true
    for (const [id, live] of this.live) {
      clearTimeout(live.idleTimer)
      this.expireQuestions(id, live)
      this.settleQuiet(live, { error: new AgentFlowCancelledError(SHUTDOWN_REASON) })
      live.client.close()
      this.live.delete(id)
    }
    for (const id of this.serverQuestions.keys()) this.expireServerQuestions(id, { shutdown: true })
    // Includes sessions still starting (not yet in `live`), and autonomous sessions idle on a
    // card: their flow lives in memory and ends here. An Easy flow the user didn't stop can
    // pick up where it left off on the next start (`resumeFlow`).
    for (const session of this.store.list()) {
      if (session.status !== 'running' && !session.flowActive) continue
      const interrupted = easyFlowUnderWay(session) && !this.cancelledFlows.has(session.id)
      // A shutdown is not activity either. Kept either way for an Easy chat (a Stop the flow
      // hadn't seen yet included), so the next start never judges it again from its events.
      this.store.update(
        session.id,
        {
          flowActive: false,
          status: 'stopped',
          ...(session.mode === 'autonomous' ? { interrupted } : {}),
        },
        { touch: false },
      )
      this.emit(session.id, { reason: SHUTDOWN_REASON, status: 'stopped', type: 'session' })
    }
    // Open SSE streams never end on their own; end them so the HTTP server can close
    // (graceful shutdown otherwise waits out its whole deadline with an agent tab open).
    for (const set of this.subscribers.values()) {
      for (const sub of set) this.endSubscriber(sub)
      set.clear()
    }
  }

  /** Every question with this header asked in any chat, newest chat first (the autonomous
   *  flow reads the ideas it already offered, so it doesn't offer them again). */
  pastQuestions(header: string): AgentQuestion[] {
    const sessions = [...this.store.list()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return sessions.flatMap((session) =>
      this.store
        .eventsAfter(session.id, 0)
        .toReversed()
        .flatMap((event) =>
          event.type === 'question' ? event.questions.filter((q) => q.header === header) : [],
        ),
    )
  }

  /** Records the autonomous flow's progress on the session: its brief, what it made that its
   *  cards don't keep (`easyProgress`), the project its video went to, and the status once it
   *  is done. No event: the flow emits its own. */
  recordAutonomous(
    id: string,
    patch: Partial<Pick<AgentSession, 'autonomous' | 'easyProgress' | 'projectId' | 'status'>>,
  ): void {
    this.store.update(id, patch)
  }

  /**
   * Picks up an Easy flow a restart cut off (`interrupted`): claims the flow again (`flowActive`,
   * so the chat takes card answers only), shows the working state, then hands it to the
   * runner, detached, which carries on from its first unanswered card. Synchronous, so a second
   * call (a double click) finds the flow running: `FlowActiveError`. Throws `NotResumableError`,
   * with a plain message, for a chat with nothing to pick up (the user stopped it, its video
   * started, Free chat), `ShuttingDownError` while ReelMakeEasy shuts down (nothing is claimed, so
   * the next start offers it again), and `NotFoundException` for a deleted one.
   */
  resumeFlow(id: string): void {
    const session = this.getSession(id)
    if (this.destroyed) throw new ShuttingDownError(id)
    if (session.flowActive) throw new FlowActiveError(id)
    const refusal = resumeRefusal(session, () => this.store.eventsAfter(id, 0))
    const resume = this.deps.autonomous.resume?.bind(this.deps.autonomous)
    if (refusal || !resume) throw new NotResumableError(id, refusal ?? NOTHING_TO_RESUME)
    this.store.update(id, { flowActive: true, interrupted: false })
    // Running until the runner, having read where the flow stopped, carries on.
    this.setFlowWorking(id, true)
    void resume(id).catch((error: unknown) => {
      this.flowWorking.delete(id)
      this.endAutonomousFlow(id)
      this.store.update(id, { status: 'stopped' })
      this.emit(id, { reason: ensureError(error).message, status: 'stopped', type: 'session' })
    })
  }

  /** Runs one turn whose agent message is not shown (no `text_delta` / `message` events, and a
   *  failed turn's raw error is left out of its `turn` event); its activity (thinking, web
   *  searches, the turn's start and end) still shows. Claims the session like `sendMessage`
   *  (throws `AgentSessionBusyError` if a turn is running). Resolves with the turn's final agent
   *  message; rejects if the turn fails, or with `AgentFlowCancelledError` if the user stops it. */
  async runQuietTurn(id: string, text: string, opts: QuietTurnOptions = {}): Promise<string> {
    if (this.getSession(id).status === 'running') throw new AgentSessionBusyError(id)
    // Claim synchronously (before any await), like `startKickoff`: a concurrent send gets the
    // busy error, and the working state shows before the cold start.
    this.store.update(id, { status: 'running' })
    this.emit(id, { status: 'running', type: 'session' })
    return await new Promise((resolve, reject) => {
      const quiet: QuietTurn = {
        settle: (outcome) => ('error' in outcome ? reject(outcome.error) : resolve(outcome.text)),
        text: null,
      }
      const params = {
        ...(opts.effort ? { effort: opts.effort } : {}),
        ...(opts.outputSchema ? { outputSchema: opts.outputSchema } : {}),
      }
      this.runTurn(id, text, params, quiet).catch(reject)
    })
  }

  /**
   * Sends the user's message, with any files they attached (`attachments`: names saved in the
   * chat's `attachments/` folder by `POST .../attachments`). An unknown name is refused before
   * anything is sent.
   */
  async sendMessage(id: string, text: string, attachmentNames: unknown[] = []): Promise<void> {
    const session = this.getSession(id)
    const dir = this.attachmentsDir(id)
    const attachments = attachmentNames.map((name) => {
      const found = resolveAttachment(dir, name)
      if (!found) throw new UnknownAttachmentError(String(name))
      return found
    })
    // Autonomous mode only ever takes card answers (while its flow runs, and after it is over)
    // until the user opens the finished video for editing.
    if (session.mode === 'autonomous' && !session.editing)
      throw session.flowActive ? new FlowActiveError(id) : new ModeNotChattableError(id)
    if (session.mode === 'motion' && !session.motionReel) throw new MotionSetupPendingError(id)
    if (session.status === 'running') throw new AgentSessionBusyError(id)
    // An Easy ranking's topic card still open: a message answers it instead; files alone can't
    // say what it's about (the card stays, and the user is asked to pick first).
    const topicCard = [...(this.serverQuestions.get(id)?.keys() ?? [])].find(isRankingTopicQuestion)
    if (topicCard && !text.trim()) throw new PickTopicFirstError()
    if (topicCard)
      this.closeServerQuestion(
        id,
        topicCard,
        new AgentFlowCancelledError('Answered with a message'),
      )
    // Claim the session and show the message before the (possibly ~5 s) cold start, all
    // synchronously: a concurrent send now sees `running` and gets the busy error, and the
    // user sees their message and the working state right away.
    this.store.update(id, {
      status: 'running',
      // A chat is named after its first message.
      ...(isUnsetChatTitle(session.title) && text ? { title: chatTitleFrom(text) } : {}),
    })
    this.emit(id, { ...(attachments.length ? { attachments } : {}), text, type: 'user_message' })
    // An Easy ranking's start: a message typed instead of the topic card is the topic; a picked
    // topic that never reached the agent goes first, ahead of this message.
    const harness = session.harness ?? defaultHarness()
    const topic = topicCard ? null : topicNotSent(session, this.store.eventsAfter(id, 0))
    const prompt = topicCard
      ? rankingKickoff(harness, undefined, true, text)
      : topic
        ? `${rankingKickoff(harness, undefined, true, topic)}\n\n${text}`
        : text
    await this.runTurn(id, turnInput(prompt, attachments))
  }

  sessionDir(id: string): string {
    return this.store.sessionDir(id)
  }

  /**
   * The session as `GET /api/agent/sessions/:id` shows it: a chat that can pick up where it
   * left off (`resumeFlow` would take it) also says what picking up does (`resume`), so its
   * button can say so before the click. Never saved with the session. When the runner can't
   * tell, the plain words: picking up then fails before anything starts, as reading where the
   * flow got to fails the same way.
   */
  sessionView(id: string): AgentSession {
    const session = this.getSession(id)
    if (!session.interrupted || session.flowActive || !this.deps.autonomous.resume) return session
    if (resumeRefusal(session, () => this.store.eventsAfter(id, 0))) return session
    let resume: AgentResumeAction = { kind: 'carry_on' }
    try {
      resume = this.deps.autonomous.resumeAction?.(id) ?? resume
    } catch (error) {
      this.logger.warn(`Couldn't read what picking up ${id} does: ${ensureError(error).message}`)
    }
    return { ...session, resume }
  }

  /** Picks the model (and thinking level) for this chat's next turns; null goes back to the
   *  default. */
  setChatModel(id: string, choice: ChatModelChoice | null): AgentSession {
    this.getSession(id)
    return this.store.update(id, { chatModel: choice ?? undefined }, { touch: false })
  }

  /** Shows (or ends) the working state while the autonomous flow works outside a Codex turn
   *  (writing the script, starting the video). A turn already running (a Free chat's
   *  card answered mid-turn) keeps the state as its own: the flow neither claims it nor ends
   *  it, so the chat never looks idle under the turn and nothing is started on top of it. */
  setFlowWorking(id: string, working: boolean): void {
    if (working) {
      if (this.flowWorking.has(id) || this.store.get(id)?.status === 'running') return
      this.flowWorking.add(id)
    } else if (!this.flowWorking.delete(id)) return
    const status = working ? 'running' : 'idle'
    this.store.update(id, { status })
    this.emit(id, { status, type: 'session' })
    if (!working) this.sendNotesSoon(id)
  }

  /**
   * A Motion Reel's setup is in and its project is ready: the card shows what was chosen, and
   * the agent's first (hidden) turn starts with `prompt`. Refused when the setup was sent
   * already (`ModeAlreadyChosenError`: the card is answered once).
   */
  startMotionReel(id: string, setup: AgentMotionSetupView, prompt: string): void {
    const session = this.getSession(id)
    if (session.mode !== 'motion' || session.motionReel) throw new ModeAlreadyChosenError(id)
    this.store.update(id, {
      motionReel: setup,
      ...(isUnsetChatTitle(session.title) ? { title: chatTitleFrom(setup.subject) } : {}),
    })
    this.emit(id, { setup, type: 'motion_setup' })
    void this.startKickoff(id, prompt).catch((error: unknown) =>
      this.logger.warn(`Motion Reel kickoff for ${id} failed: ${ensureError(error).message}`),
    )
  }

  /** Replays events after `afterId`, then delivers new ones as they happen. `onEnd` is
   *  called if the service ends the subscription itself (on shutdown). */
  subscribe(id: string, afterId: number, fn: (e: Stored) => void, onEnd?: () => void): () => void {
    for (const e of this.store.eventsAfter(id, afterId)) fn(e)
    const sub: Subscriber = { fn, onEnd }
    if (this.destroyed) {
      this.endSubscriber(sub)
      return () => undefined
    }
    const set = this.subscribers.get(id) ?? new Set()
    set.add(sub)
    this.subscribers.set(id, set)
    return () => set.delete(sub)
  }

  /** Names a chat that has no name yet (the autonomous flow's picked idea). */
  titleChat(id: string, title: string): void {
    const trimmed = chatTitleFrom(title)
    if (!trimmed || !isUnsetChatTitle(this.getSession(id).title)) return
    this.store.update(id, { title: trimmed })
  }

  /** Where a session's Codex runs: `<sessionDir>/edit` while editing (it holds the `project`
   *  link and the frames Codex pulls), else the session folder. */
  workingDir(id: string): string {
    const dir = this.store.sessionDir(id)
    return this.getSession(id).editing ? path.join(dir, 'edit') : dir
  }

  /** (Re)starts the session's question idle timer: one per child, reset by every new question.
   *  When it fires the turn is interrupted - not the child stopped, since `onExit` ignores a
   *  child already removed from `live` and would leave the session `running`. Codex then
   *  withdraws the question and ends the turn, and the post-turn idle timer closes the child. */
  private armQuestionTimer(id: string, live: Live): void {
    clearTimeout(live.questionTimer)
    live.questionTimer = setTimeout(() => {
      live.questionTimer = undefined
      if (this.live.get(id) !== live) return
      this.interrupt(id).catch((error: unknown) =>
        this.logger.warn(
          `Interrupting ${id} after an unanswered question failed: ${ensureError(error).message}`,
        ),
      )
    }, this.deps.idleMs)
  }

  /**
   * An Easy ranking's first card: what it's about (a few ideas, or their own words). Its answer
   * starts the agent on it (`rankingKickoff` with the topic). Typing a message instead withdraws
   * the card (`sendMessage`), and the agent takes that message as the topic.
   */
  private async askRankingTopic(
    id: string,
    harness: AgentHarnessName,
    /** After a restart: the card the chat still shows (`card`, re-armed as it is) or none (a new
     *  one is posted); either way not activity. */
    restart?: { card?: { questionId: string; questions: AgentQuestion[] } },
  ): Promise<void> {
    let answers: AgentAnswers
    // Its own id each time a card is posted (two in the same millisecond too).
    const questionId =
      restart?.card?.questionId ?? `${RANKING_TOPIC_QUESTION_PREFIX}-${randomUUID().slice(0, 8)}`
    const questions = restart?.card?.questions ?? [rankingTopicQuestion()]
    try {
      answers = await this.askServerQuestion(
        id,
        questionId,
        questions,
        restart ? { show: !restart.card, touch: false } : {},
      )
    } catch {
      // Stopped, deleted, or answered with a message instead.
      return
    }
    // The picked label without its " (Recommended)" mark, or the words typed.
    const picked = answers[RANKING_TOPIC_ID]?.find((answer) => answer.trim())
    const topic = picked && splitRecommended(picked).text.trim()
    if (!topic || this.getSession(id).status === 'running') return
    if (isUnsetChatTitle(this.getSession(id).title))
      this.store.update(id, { title: chatTitleFrom(topic) }, { touch: false })
    await this.startKickoff(id, rankingKickoff(harness, undefined, true, topic)).catch(
      (error: unknown) =>
        this.logger.warn(`Kickoff for ${id} failed: ${ensureError(error).message}`),
    )
  }

  /** Shows Codex's questions to the user; the promise settles with their answer. */
  private askUser(id: string, live: Live, params: unknown, requestId: RpcId): Promise<unknown> {
    // A child already stopped or replaced: nothing would ever expire its card.
    if (this.live.get(id) !== live) return Promise.reject(new Error('Session is not running'))
    const p = (params ?? {}) as { itemId?: unknown; questions?: unknown }
    const questions = parseQuestions(p.questions)
    if (!questions.length) return Promise.reject(new Error('No questions'))
    const questionId = typeof p.itemId === 'string' && p.itemId ? p.itemId : String(requestId)
    if (live.questions.has(questionId)) return Promise.reject(new Error('Duplicate question id'))
    return new Promise((resolve, reject) => {
      live.questions.set(questionId, {
        questionIds: questions.map((q) => q.id),
        reject,
        requestId,
        resolve,
        secretIds: new Set(questions.filter((q) => q.isSecret).map((q) => q.id)),
      })
      this.armQuestionTimer(id, live)
      this.emit(id, { questionId, questions, type: 'question' })
    })
  }

  /** Wires notifications and exit handling for a not-yet-registered child. */
  private attachHandlers(id: string, live: Live): void {
    live.client.onNotification((msg) => {
      if (live.stopped) return
      if (msg.method === 'serverRequest/resolved') {
        // Codex withdrew a request (e.g. its turn was interrupted): nothing to answer.
        for (const [questionId, q] of live.questions) {
          if (q.requestId !== msg.params?.['requestId']) continue
          live.questions.delete(questionId)
          this.emit(id, { questionId, type: 'question_expired' })
        }
        this.settleQuestionTimer(id, live)
        return
      }
      const event = mapCodexNotification(msg)
      if (!event) return
      if (live.quiet && (event.type === 'message' || event.type === 'text_delta')) {
        // A quiet turn's answer is for ReelMakeEasy, not the chat (often raw JSON).
        if (event.type === 'message') live.quiet.text = event.text
        return
      }
      // A quiet turn's failure is reported by whoever ran it, in its own words.
      this.emit(
        id,
        live.quiet && event.type === 'turn' ? { status: event.status, type: 'turn' } : event,
      )
      if (event.type !== 'turn' || event.status === 'started') return
      // `mapCodexNotification` drops the turn id; read it from the raw
      // notification so a stale/foreign turn's completion (e.g. one that was
      // already interrupted) cannot clear the state of a turn that superseded it.
      // Only skip when BOTH ids are known and differ: `currentTurnId` is still
      // null until `sendMessage`'s `turn/start` continuation runs, which is a
      // later microtask - so a turn that completes in the same stdout chunk as
      // its own start response must still be handled here, not dropped.
      const turnId = (msg.params?.turn as undefined | { id?: string })?.id
      if (turnId && live.currentTurnId && turnId !== live.currentTurnId) return
      this.expireQuestions(id, live)
      // `currentTurnId` is still null: `sendMessage`'s `turn/start` continuation
      // hasn't run yet, so remember this id as already-finished for it to check.
      if (turnId && live.currentTurnId === null) live.completedTurnIds.add(turnId)
      live.currentTurnId = null
      clearTimeout(live.idleTimer)
      this.store.update(id, { status: 'idle' })
      live.idleTimer = setTimeout(() => this.stopLive(id), this.deps.idleMs)
      this.settleQuiet(live, quietOutcome(event, live.quiet?.text ?? null))
      this.sendNotesSoon(id)
    })
    live.client.onExit((code, reason) => {
      if (this.live.get(id) !== live) return
      this.expireQuestions(id, live)
      const who = harnessLabel(this.store.get(id)?.harness)
      const stopped = code === null ? `${who} stopped: ${reason}` : `${who} stopped (exit ${code})`
      this.settleQuiet(live, { error: new Error(stopped) })
      this.live.delete(id)
      clearTimeout(live.idleTimer)
      if (this.store.get(id)?.status === 'running') {
        this.store.update(id, { status: 'stopped' })
        this.emit(id, {
          // No exit code means the client gave up on the child itself (e.g. a request
          // timed out); the reason says why.
          reason: stopped,
          status: 'stopped',
          type: 'session',
        })
      }
    })
  }

  /** A ReelMakeEasy tool call from Codex, answered with the tool's text. An error is still an
   *  answer: the turn goes on and Codex can tell the user what happened. */
  private async callTool(id: string, live: Live, params: unknown): Promise<unknown> {
    if (this.live.get(id) !== live) throw new Error('Session is not running')
    const p = (params ?? {}) as { arguments?: unknown; tool?: unknown }
    const tool = typeof p.tool === 'string' ? p.tool : ''
    let result: ToolCallResult
    try {
      result = await this.deps.onToolCall(id, tool, p.arguments)
    } catch (error) {
      result = { success: false, text: ensureError(error).message }
    }
    return { contentItems: [{ text: result.text, type: 'inputText' }], success: result.success }
  }

  /** Closes one of ReelMakeEasy's open cards, if it is open: its asker stops waiting (with
   *  `error`) and the chat shows it expired. */
  private closeServerQuestion(id: string, questionId: string, error: Error): void {
    const question = this.serverQuestions.get(id)?.get(questionId)
    if (!question) return
    this.dropServerQuestion(id, questionId)
    question.reject(error)
    this.emit(id, { questionId, type: 'question_expired' })
  }

  /** Forgets an answered server question, and the session's map once it is empty. */
  private dropServerQuestion(id: string, questionId: string): void {
    const open = this.serverQuestions.get(id)
    open?.delete(questionId)
    if (open?.size === 0) this.serverQuestions.delete(id)
  }

  private emit(id: string, event: AgentUiEvent, opts: { touch?: boolean } = {}): void {
    const stored = this.store.append(id, event, opts)
    for (const { fn } of this.subscribers.get(id) ?? []) {
      try {
        fn(stored)
      } catch (error) {
        this.logger.error(`Subscriber for session ${id} threw: ${ensureError(error).message}`)
      }
    }
  }

  private endSubscriber(sub: Subscriber): void {
    try {
      sub.onEnd?.()
    } catch (error) {
      this.logger.error(`Ending an agent stream threw: ${ensureError(error).message}`)
    }
  }

  /** The running child for a session: spawned, initialized and on its thread (new or resumed).
   *  Concurrent callers share the same in-flight start; the child is only registered as
   *  `live` once initialize and thread/start-or-resume have both succeeded. */
  private ensureLive(id: string): Promise<Live> {
    const existing = this.live.get(id)
    if (existing) return Promise.resolve(existing)
    const inFlight = this.starting.get(id)
    if (inFlight) return inFlight
    const promise = this.startLive(id).finally(() => this.starting.delete(id))
    this.starting.set(id, promise)
    return promise
  }

  /** Closes every open question: Codex gets an error answer, the user sees it expire. */
  private expireQuestions(id: string, live: Live): void {
    clearTimeout(live.questionTimer)
    live.questionTimer = undefined
    for (const [questionId, q] of live.questions) {
      live.questions.delete(questionId)
      q.reject(new Error('Question expired'))
      this.emit(id, { questionId, type: 'question_expired' })
    }
  }

  /** Closes every open ReelMakeEasy-made question of the session: its asker gets
   *  `AgentFlowCancelledError`, the user sees it expire. */
  /** At a `shutdown`, an Easy ranking's topic card stays shown for the next start to re-arm (its
   *  asker still stops waiting), and the others expire without counting as activity. */
  private expireServerQuestions(id: string, opts: { shutdown?: boolean } = {}): void {
    const open = this.serverQuestions.get(id)
    if (!open) return
    this.serverQuestions.delete(id)
    for (const [questionId, q] of open) {
      q.reject(new AgentFlowCancelledError())
      if (opts.shutdown && isRankingTopicQuestion(questionId)) continue
      this.emit(id, { questionId, type: 'question_expired' }, { touch: !opts.shutdown })
    }
  }

  /** An Easy chat an earlier ReelMakeEasy stopped mid-flow, before it kept the `interrupted` mark:
   *  marked now when its chat shows ReelMakeEasy cut it off (not the user, a failure or a finished
   *  video); the answer is kept either way, so each chat is read once. */
  private markEarlierCutOff(session: AgentSession): void {
    const { editing, id, interrupted, mode, projectId, status } = session
    if (interrupted !== undefined || mode !== 'autonomous' || editing || projectId) return
    if (status !== 'stopped') return
    const cut = !session.stoppedByUser && cutOffByReelMakeEasy(this.store.eventsAfter(id, 0))
    this.store.update(id, { interrupted: cut }, { touch: false })
  }

  /** Makes a started child the session's live one - unless the service shut down meanwhile. */
  private register(id: string, live: Live): Live {
    if (this.destroyed) throw new Error(SHUTDOWN_REASON)
    this.live.set(id, live)
    return live
  }

  /**
   * After a restart, an idle chat's open ReelMakeEasy cards: they lived in memory, so they can't
   * be answered and expire. An Easy ranking still waiting on what it's about keeps its topic
   * card (asked again: re-armed if the chat still shows it, else a new one). None of it is
   * activity.
   */
  private reopenServerCards(session: AgentSession): void {
    const events = this.store.eventsAfter(session.id, 0)
    const waiting = waitingOnTopic(session, events)
    const open = openServerQuestionIds(events)
    const topicId = waiting ? open.findLast(isRankingTopicQuestion) : undefined
    for (const questionId of open)
      if (questionId !== topicId)
        this.emit(session.id, { questionId, type: 'question_expired' }, { touch: false })
    if (!waiting) return
    const shown = topicId ? questionsOf(events, topicId) : null
    void this.askRankingTopic(session.id, session.harness ?? defaultHarness(), {
      ...(topicId && shown ? { card: { questionId: topicId, questions: shown } } : {}),
    })
  }

  /** Starts one turn (a real user message, the hidden kickoff, or a quiet turn); resolves once
   *  Codex has accepted it. The caller has already claimed the session (`status: 'running'`)
   *  and shown whatever it wants shown for the turn's start. `params` are extra `turn/start`
   *  params; `quiet` marks the turn quiet (see `runQuietTurn`) and is settled when it ends. */
  private async runTurn(
    id: string,
    message: AgentTurnInput[] | string,
    params: QuietTurnOptions = {},
    quiet?: QuietTurn,
  ): Promise<void> {
    let live: Live
    try {
      live = await this.ensureLive(id)
    } catch (error) {
      // No child to fall back on: the session is stopped until the next message retries.
      // The reason carries the app-server's stderr tail, so the user sees why.
      this.store.update(id, { status: 'stopped' })
      this.emit(id, {
        reason: `${harnessLabel(this.store.get(id)?.harness)} could not start: ${ensureError(error).message}`,
        status: 'stopped',
        type: 'session',
      })
      throw error
    }
    clearTimeout(live.idleTimer)
    if (quiet && this.cancelledFlows.has(id)) {
      // Stopped during the cold start: never start the turn.
      this.store.update(id, { status: 'idle' })
      live.idleTimer = setTimeout(() => this.stopLive(id), this.deps.idleMs)
      this.emit(id, { status: 'interrupted', type: 'turn' })
      throw new AgentFlowCancelledError()
    }
    const { threadId } = this.getSession(id)
    // Before `turn/start`: the turn's first notifications may arrive with its response.
    live.quiet = quiet
    try {
      const { turn } = await live.client.request<{ turn: { id: string } }>('turn/start', {
        ...this.turnModel(id, params),
        ...params,
        input: typeof message === 'string' ? [{ text: message, type: 'text' }] : message,
        threadId,
      })
      // A turn that completes before this continuation runs (its response and
      // terminal notification landed in the same stdout chunk) already went
      // through the notification handler below; don't resurrect its id here.
      if (!live.completedTurnIds.delete(turn.id)) live.currentTurnId = turn.id
    } catch (error) {
      // The turn never started: nothing will settle it (the caller gets this error instead).
      if (live.quiet === quiet) live.quiet = undefined
      // If the child already exited (crash, or a timeout that stopped it), `onExit` has
      // already moved the session to `stopped` and told the user why; don't stomp that
      // with `idle` or report the same failure twice.
      if (this.live.get(id) === live) {
        this.store.update(id, { status: 'idle' })
        clearTimeout(live.idleTimer)
        live.idleTimer = setTimeout(() => this.stopLive(id), this.deps.idleMs)
        this.emit(
          id,
          quiet
            ? { status: 'failed', type: 'turn' }
            : { error: ensureError(error).message, status: 'failed', type: 'turn' },
        )
        this.sendNotesSoon(id)
      }
      throw error
    }
  }

  /** Sends the session's waiting notes (`notifyAgent`) as one hidden turn, unless a turn runs
   *  or is starting: then they wait for the next idle. Claims the session like `sendMessage`. */
  private sendNotes(id: string): void {
    const notes = this.notes.get(id)
    const session = this.store.get(id)
    if (!notes?.length || !session || this.destroyed) return
    if (session.status === 'running' || this.starting.has(id)) return
    this.notes.delete(id)
    this.store.update(id, { status: 'running' })
    this.emit(id, { status: 'running', type: 'session' })
    // `runTurn` already shows a failure (a stopped notice, or the failed turn).
    this.runTurn(id, notes.join('\n\n')).catch((error: unknown) =>
      this.logger.warn(`Telling the agent of ${id} failed: ${ensureError(error).message}`),
    )
  }

  /** The session just went idle: waiting notes go next, after whatever settles with it (a
   *  quiet turn's caller may start its next turn at once, and goes first). */
  private sendNotesSoon(id: string): void {
    if (!this.notes.has(id)) return
    setTimeout(() => this.sendNotes(id), 0)
  }

  /** After a question closes: stop the question idle timer once none is open; with another
   *  still open, restart it for that one. */
  private settleQuestionTimer(id: string, live: Live): void {
    if (live.questions.size) return this.armQuestionTimer(id, live)
    clearTimeout(live.questionTimer)
    live.questionTimer = undefined
  }

  /** Ends the child's quiet turn, if one is in flight, with `outcome`. */
  private settleQuiet(live: Live, outcome: Parameters<QuietTurn['settle']>[0]): void {
    const quiet = live.quiet
    if (!quiet) return
    live.quiet = undefined
    quiet.settle(outcome)
  }

  /** Hidden kickoff turn: shows the working state, but no user message. Used by `chooseMode`
   *  for free chat (`kickoffFor`). */
  private async startKickoff(id: string, prompt: string): Promise<void> {
    // Claim the session synchronously, before the first await, exactly like `sendMessage`:
    // a concurrent send sees `running` and gets the busy error right away.
    this.store.update(id, { status: 'running' })
    this.emit(id, { status: 'running', type: 'session' })
    await this.runTurn(id, prompt)
  }

  private async startLive(id: string): Promise<Live> {
    const cwd = this.workingDir(id)
    fs.mkdirSync(cwd, { recursive: true })
    // The mode is chosen before any child starts, and never changes: it fixes the child's tools.
    // Editing (Easy, after the Edit card) is the one later change, and restarts the child.
    const started = this.getSession(id)
    const { editing, mode } = started
    const harness = started.harness ?? 'codex'
    const tools: DynamicToolSpec[] = toolsForSession(started, harness)
    const client = await this.deps.spawnCodex(cwd, {
      harness,
      mode,
      tools,
      ...(editing ? { editing: true } : {}),
    })
    const live: Live = {
      client,
      completedTurnIds: new Set(),
      currentTurnId: null,
      questions: new Map(),
    }
    try {
      this.attachHandlers(id, live)
      client.onServerRequest((method, params, requestId) => {
        if (method === 'item/tool/requestUserInput')
          return this.askUser(id, live, params, requestId)
        if (method === 'item/tool/call') return this.callTool(id, live, params)
        return null
      })
      await client.request('initialize', {
        // ReelMakeEasy's tools (make_video, regenerate_clip, render_video) are dynamic tools,
        // an experimental part of the app-server API.
        capabilities: { experimentalApi: true },
        clientInfo: { name: 'reelmakeeasy', title: 'ReelMakeEasy', version: '1' },
      })
      client.notify('initialized')
      const session = this.getSession(id)
      // Each mode has its own brief; autonomous is the only one that may search
      // the web, since its ideas step needs real recent news - and so it gets no shell and a
      // read-only sandbox (`appServerArgsForMode`).
      const developerInstructions = briefFor(session, harness)
      const threadParams = {
        approvalPolicy: 'never',
        cwd,
        developerInstructions,
        sandbox: sandboxForMode(mode, !!session.editing),
      }
      // Tools are declared with the thread and kept by Codex, so a resume needs none - but a
      // thread started without tools the session now needs (a Free chat from before the
      // tools existed) is replaced, so Codex can actually call them. Claude takes its tools with
      // every turn, so its conversation is kept whatever the tool list.
      const toolNames = tools.map((t) => t.name)
      const retool =
        harness === 'codex' &&
        !!session.threadId &&
        JSON.stringify(session.tools ?? []) !== JSON.stringify(toolNames)
      let resumeFailed = false
      if (session.threadId && !retool) {
        try {
          await client.request('thread/resume', { threadId: session.threadId, ...threadParams })
          if (harness === 'claude') this.store.update(id, { tools: toolNames })
          return this.register(id, live)
        } catch (error) {
          resumeFailed = true
          this.logger.warn(
            `Resume failed for ${id}, starting a new thread: ${ensureError(error).message}`,
          )
        }
      }
      const { thread } = await client.request<{ thread: { id: string } }>('thread/start', {
        ...threadParams,
        ...(tools.length ? { dynamicTools: tools } : {}),
      })
      this.store.update(id, { threadId: thread.id, tools: toolNames })
      // The agent won't remember the earlier messages; say so rather than let it look forgetful.
      const who = harnessLabel(harness)
      if (resumeFailed)
        this.emit(id, { reason: resumeFailedNotice(who), status: 'running', type: 'session' })
      else if (retool)
        this.emit(id, { reason: toolsAddedNotice(who), status: 'running', type: 'session' })
      return this.register(id, live)
    } catch (error) {
      client.close()
      throw error
    }
  }

  private stopLive(id: string): void {
    const live = this.live.get(id)
    if (!live) return
    // Pending timers belong to this child: left armed, the idle timer would later stop
    // whichever child is live then (the edit child, mid-tool-call).
    clearTimeout(live.idleTimer)
    clearTimeout(live.questionTimer)
    this.expireQuestions(id, live)
    live.stopped = true
    this.live.delete(id)
    live.client.close()
  }

  /**
   * The model for a chat's next turn (Codex and Claude Code both take `model` and `effort` on
   * turn/start), in every mode: the chat's pick, else the saved default, else the recommended
   * model, as its picker shows. A turn that sets its own thinking level (an Easy step) keeps
   * it; the others take the picked one.
   */
  private turnModel(id: string, params: QuietTurnOptions): { effort?: string; model?: string } {
    const session = this.getSession(id)
    const harness = session.harness ?? 'codex'
    const choice =
      session.mode === 'motion' && this.deps.chatModels.motionChoiceFor
        ? this.deps.chatModels.motionChoiceFor(harness, session.chatModel)
        : this.deps.chatModels.choiceFor(harness, session.chatModel)
    if (!choice) return {}
    return {
      ...(choice.effort && !params.effort ? { effort: choice.effort } : {}),
      model: choice.model,
    }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The cards ReelMakeEasy asked (`server`) that a session's events leave open: never answered,
 *  never expired. */
function openServerQuestionIds(events: AgentUiEvent[]): string[] {
  const open = new Set<string>()
  for (const event of events) {
    if (event.type === 'question' && event.server) open.add(event.questionId)
    else if (event.type === 'question_answered' || event.type === 'question_expired')
      open.delete(event.questionId)
  }
  return [...open]
}

/** The questions of a card the chat shows, from its `question` event. */
function questionsOf(events: AgentUiEvent[], questionId: string): AgentQuestion[] | null {
  const event = events.findLast((e) => e.type === 'question' && e.questionId === questionId)
  return event?.type === 'question' ? event.questions : null
}

/**
 * An Easy ranking's topic that may never have reached the agent: the topic card was answered,
 * but no turn has completed and no ranking was made (ReelMakeEasy stopped, or the agent failed
 * to start, in between). A turn that only started doesn't count: a Claude turn says it started
 * before its query runs, and can fail before the agent ever saw the message.
 */
function topicNotSent(session: AgentSession, events: AgentUiEvent[]): null | string {
  if (session.mode !== 'ranking_easy' || session.rankingId) return null
  if (events.some((e) => e.type === 'turn' && e.status === 'completed')) return null
  const answered = events.findLast(
    (e) => e.type === 'question_answered' && isRankingTopicQuestion(e.questionId),
  )
  const picked =
    answered?.type === 'question_answered'
      ? answered.answers[RANKING_TOPIC_ID]?.find((answer) => answer.trim())
      : undefined
  return picked ? splitRecommended(picked).text.trim() || null : null
}

/** An Easy ranking that never got its topic: no message, no answered topic card, no agent turn. */
function waitingOnTopic(session: AgentSession, events: AgentUiEvent[]): boolean {
  if (session.mode !== 'ranking_easy' || session.rankingId || session.threadId) return false
  return !events.some(
    (e) =>
      e.type === 'user_message' ||
      (e.type === 'question_answered' && isRankingTopicQuestion(e.questionId)),
  )
}

/** An Easy chat whose flow runs, hasn't started its video and wasn't stopped by the user:
 *  ReelMakeEasy stopping now cuts it off, and it can pick up where it left off. */
function easyFlowUnderWay(session: AgentSession): boolean {
  return (
    session.mode === 'autonomous' &&
    !!session.flowActive &&
    !session.editing &&
    !session.projectId &&
    !session.stoppedByUser
  )
}

/** The chat shows its flow was cut off by ReelMakeEasy stopping (its last stop was a shutdown or a
 *  restart), and never by the user or by its video starting. */
function cutOffByReelMakeEasy(events: AgentUiEvent[]): boolean {
  if (events.some((e) => e.type === 'flow_cancelled' || e.type === 'video_started')) return false
  const stop = events.findLast((e) => e.type === 'session' && e.status === 'stopped')
  const reason = stop?.type === 'session' ? stop.reason : undefined
  return reason === SHUTDOWN_REASON || reason === RESTARTED_REASON
}

const NOTHING_TO_RESUME = 'This chat has nothing to pick up. Start a new chat to make a video.'

/** Why `resumeFlow` can't pick this chat up, in plain words; null when it can. `events` is read
 *  only when the record alone can't say. */
function resumeRefusal(session: AgentSession, events: () => AgentUiEvent[]): null | string {
  if (session.mode !== 'autonomous') return 'Only an Easy chat can pick up where it left off.'
  if (session.projectId || session.editing) return "This chat's video was already started."
  if (session.stoppedByUser || events().some((e) => e.type === 'flow_cancelled'))
    return 'You stopped this chat. Start a new chat to make a video.'
  if (session.interrupted) return null
  return NOTHING_TO_RESUME
}

/** How a finished turn settles a quiet turn: its last agent message, or why there is none. */
function quietOutcome(
  event: Extract<AgentUiEvent, { type: 'turn' }>,
  text: null | string,
): Parameters<QuietTurn['settle']>[0] {
  if (event.status === 'interrupted') return { error: new AgentFlowCancelledError() }
  if (event.status === 'failed') return { error: new Error(event.error ?? 'Codex turn failed') }
  return text === null ? { error: new Error('Codex gave no answer') } : { text }
}

/** The well-formed questions of a `requestUserInput` request; malformed ones are dropped. */
function parseQuestions(raw: unknown): AgentQuestion[] {
  if (!Array.isArray(raw)) return []
  const questions: AgentQuestion[] = []
  for (const q of raw) {
    if (!isRecord(q)) continue
    const { header, id, question } = q
    if (typeof id !== 'string' || typeof header !== 'string' || typeof question !== 'string')
      continue
    const options = Array.isArray(q['options']) ? q['options'] : []
    questions.push({
      header,
      id,
      isOther: q['isOther'] === true,
      isSecret: q['isSecret'] === true,
      options: options
        .filter((o): o is Record<string, unknown> => isRecord(o) && typeof o['label'] === 'string')
        .map((o) => ({
          description: typeof o['description'] === 'string' ? o['description'] : '',
          label: o['label'] as string,
        })),
      question,
    })
  }
  return questions
}

/** One answer, trimmed; throws `InvalidAnswerError` if it isn't usable text. */
function trimAnswer(key: string, answer: unknown): string {
  if (typeof answer !== 'string') throw new InvalidAnswerError(`Answers to "${key}" must be text`)
  const text = answer.trim()
  if (!text) throw new InvalidAnswerError(`An answer to "${key}" is empty`)
  if (text.length > MAX_ANSWER_CHARS)
    throw new InvalidAnswerError(
      `An answer to "${key}" is longer than ${MAX_ANSWER_CHARS} characters`,
    )
  return text
}

/** Checks the answers cover exactly `questionIds`, each with 1 to `MAX_ANSWERS_PER_QUESTION`
 *  non-blank strings of at most `MAX_ANSWER_CHARS`; returns them trimmed. Throws `InvalidAnswerError` otherwise. */
function validateAnswers(answers: unknown, questionIds: string[]): AgentAnswers {
  if (!isRecord(answers)) throw new InvalidAnswerError('answers must be an object')
  for (const key of Object.keys(answers)) {
    if (!questionIds.includes(key)) throw new InvalidAnswerError(`No question "${key}" was asked`)
  }
  // `fromEntries` defines own properties, so even a question id like `__proto__` is safe.
  return Object.fromEntries(
    questionIds.map((key) => {
      const value = Object.hasOwn(answers, key) ? answers[key] : undefined
      if (!Array.isArray(value) || !value.length)
        throw new InvalidAnswerError(`Answer question "${key}"`)
      if (value.length > MAX_ANSWERS_PER_QUESTION)
        throw new InvalidAnswerError(`Give at most ${MAX_ANSWERS_PER_QUESTION} answers to "${key}"`)
      return [key, value.map((answer) => trimAnswer(key, answer))]
    }),
  )
}
