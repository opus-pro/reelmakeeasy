import fs from 'node:fs'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  MessageEvent,
  NotFoundException,
  Param,
  PayloadTooLargeException,
  Post,
  Put,
  Query,
  Req,
  Res,
  ServiceUnavailableException,
  Sse,
  UseGuards,
} from '@nestjs/common'
import {
  AGENT_HARNESSES,
  type AgentAnswers,
  type AgentAttachment,
  type AgentHarnessName,
  type AgentMode,
  type AgentSession,
  type AgentSessionListItem,
  type AgentStatusResponse,
  type ChatModelChoice,
  type ChatModelState,
} from '@shared/types/api/agent'
import type { Request, Response } from 'express'
import { Observable } from 'rxjs'

import { ProjectService } from '../projects/projects.service'

import {
  AutonomousService,
  StyleNotRequestedError,
  UnknownStyleError,
} from './autonomous/autonomous.service'
import { defaultHarness } from './claude/claude-config'
import { getClaudeStatus } from './claude/claude-locator'
import { getCodexStatus } from './codex/codex-locator'
import { AgentEditService, EditNotReadyError } from './edit/agent-edit.service'
import {
  attachmentFileName,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  resolveAttachment,
} from './agent-attachments'
import { resolveAllowedImagePath } from './agent-files'
import {
  AgentSessionBusyError,
  AgentSessionService,
  FlowActiveError,
  HarnessNotReadyError,
  InvalidAnswerError,
  ModeAlreadyChosenError,
  ModeNotChattableError,
  NotResumableError,
  QuestionNotOpenError,
  ShuttingDownError,
  UnknownAttachmentError,
} from './agent-session.service'
import { isAgentSessionId } from './agent-session.store'
import { buildAgentSessionList } from './agent-session-list'
import { ChatModelService } from './chat-model.service'
import { parseChoice } from './chat-models'
import { LoopbackOnlyGuard } from './loopback-only.guard'

/** A Codex item id, or a stringified JSON-RPC request id. */
const QUESTION_ID = /^[\w.:-]{1,200}$/
const AGENT_MODES: AgentMode[] = ['autonomous', 'free', 'ranking', 'ranking_easy']
/** Guided mode was removed. A page still offering it (open since before the update) starts Free
 *  chat instead of failing. */
const LEGACY_GUIDED_MODE = 'guided'
const MAX_STYLE_ID_CHARS = 200

/** 400 for anything that is not a session id, before it can reach a path or a lookup. */
function checkSessionId(id: string): string {
  if (!isAgentSessionId(id)) throw new BadRequestException('Invalid agent session id')
  return id
}

const TOO_BIG = `That file is too big: attach files up to ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB.`

@Controller('agent')
// Agent routes drive the user's own Codex; only this computer may call them (see the guard).
@UseGuards(LoopbackOnlyGuard)
export class AgentController {
  private readonly logger = new Logger(AgentController.name)

  constructor(
    private readonly sessions: AgentSessionService,
    private readonly autonomous: AutonomousService,
    private readonly projects: ProjectService,
    private readonly edit: AgentEditService,
    private readonly chatModels: ChatModelService,
  ) {}

  @Post('sessions/:id/questions/:questionId/answer')
  answerQuestion(
    @Param('id') id: string,
    @Param('questionId') questionId: string,
    @Body() body: { answers?: unknown },
  ): { ok: true } {
    this.sessions.getSession(checkSessionId(id))
    if (!QUESTION_ID.test(questionId)) throw new BadRequestException('Invalid question id')
    const answers = body?.answers
    if (!answers || typeof answers !== 'object' || Array.isArray(answers))
      throw new BadRequestException('answers must be an object')
    try {
      this.sessions.answerQuestion(id, questionId, answers as AgentAnswers)
    } catch (error) {
      if (error instanceof QuestionNotOpenError)
        throw new ConflictException('This question is no longer open')
      if (error instanceof InvalidAnswerError) throw new BadRequestException(error.message)
      throw error
    }
    return { ok: true }
  }

  @Post('sessions/:id/attachments')
  async attach(
    @Param('id') id: string,
    @Query('name') name: unknown,
    @Req() req: Request,
  ): Promise<AgentAttachment> {
    this.sessions.getSession(checkSessionId(id))
    if (typeof name !== 'string' || !name.trim()) throw new BadRequestException('name is required')
    if (req.is('application/json'))
      throw new BadRequestException('Send the file itself, e.g. as application/octet-stream')
    const declared = Number(req.headers['content-length'])
    if (declared > MAX_ATTACHMENT_BYTES) throw new PayloadTooLargeException(TOO_BIG)
    const dir = this.sessions.attachmentsDir(id)
    await fs.promises.mkdir(dir, { recursive: true })
    const file = path.join(dir, attachmentFileName(name))
    let size = 0
    const limit = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length
        callback(size > MAX_ATTACHMENT_BYTES ? new PayloadTooLargeException(TOO_BIG) : null, chunk)
      },
    })
    try {
      await pipeline(req, limit, fs.createWriteStream(file, { flags: 'wx' }))
    } catch (error) {
      await fs.promises.rm(file, { force: true })
      throw error instanceof PayloadTooLargeException ? error : ensureError(error)
    }
    const saved = resolveAttachment(dir, path.basename(file))
    if (!saved) throw new BadRequestException("Couldn't save that file")
    return saved
  }

  /**
   * `POST /api/agent/sessions/:id/attachments?name=<file name>`: the request body is the file's
   * bytes (any type but JSON, e.g. `application/octet-stream`). Saves it in the chat's
   * `attachments/` folder under a safe, unique name and answers what to send with the message.
   * 413 past `MAX_ATTACHMENT_BYTES`.
   */
  /**
   * `GET /api/agent/sessions/:id/attachments/:name`: a file attached to the chat, for its
   * viewer. Pictures, sound and video play inline (with seeking); any other file downloads,
   * sandboxed, so an attached page or SVG never runs on the API's origin.
   */
  @Get('sessions/:id/attachments/:name')
  attachment(@Param('id') id: string, @Param('name') name: string, @Res() res: Response): void {
    this.sessions.getSession(checkSessionId(id))
    const found = this.sessions.findAttachment(id, name)
    if (!found) throw new NotFoundException('No such attached file')
    const media = found.kind !== 'file'
    res.sendFile(
      found.path,
      {
        dotfiles: 'allow',
        headers: {
          'Content-Disposition': `${media ? 'inline' : 'attachment'}; filename="${found.name}"`,
          'Content-Security-Policy': 'sandbox',
          'X-Content-Type-Options': 'nosniff',
        },
      },
      (err) => {
        if (err && !res.headersSent) res.status(404).end()
      },
    )
  }

  /**
   * `GET /api/agent/sessions/:id/model[?refresh=1]`: the model this chat runs on, where that
   * comes from (picked for it, the saved default, recommended), and every model its harness
   * offers this account. `refresh` asks the harness again (after a plan change).
   */
  @Get('sessions/:id/model')
  chatModel(@Param('id') id: string, @Query('refresh') refresh?: string): Promise<ChatModelState> {
    const session = this.sessions.getSession(checkSessionId(id))
    return this.chatModels.state(session.harness ?? 'codex', session.chatModel, {
      refresh: refresh === '1' || refresh === 'true',
    })
  }

  @Post('sessions/:id/mode')
  async chooseMode(
    @Param('id') id: string,
    @Body() body: { harness?: unknown; mode?: unknown },
  ): Promise<{ ok: true }> {
    checkSessionId(id)
    const mode = body?.mode === LEGACY_GUIDED_MODE ? 'free' : body?.mode
    if (!AGENT_MODES.includes(mode as AgentMode))
      throw new BadRequestException('mode must be "free" or "autonomous"')
    const harness = body?.harness
    if (harness !== undefined && !AGENT_HARNESSES.includes(harness as AgentHarnessName))
      throw new BadRequestException('harness must be "codex" or "claude"')
    try {
      await (harness === undefined
        ? this.sessions.chooseMode(id, mode as AgentMode)
        : this.sessions.chooseMode(id, mode as AgentMode, harness as AgentHarnessName))
    } catch (error) {
      if (error instanceof ModeAlreadyChosenError) throw new ConflictException(error.message)
      if (error instanceof HarnessNotReadyError) throw new ConflictException(error.message)
      throw error
    }
    return { ok: true }
  }

  /** Autonomous mode: the style the user picked in the inline style picker. Answers once the
   *  choice is recorded; the video then starts in the background (`video_started` event). */
  @Post('sessions/:id/style')
  async chooseStyle(
    @Param('id') id: string,
    @Body() body: { styleId?: unknown },
  ): Promise<{ ok: true }> {
    this.sessions.getSession(checkSessionId(id))
    const styleId = body?.styleId
    if (typeof styleId !== 'string' || !styleId.trim())
      throw new BadRequestException('styleId is required')
    if (styleId.length > MAX_STYLE_ID_CHARS) throw new BadRequestException('styleId is invalid')
    try {
      await this.autonomous.chooseStyle(id, styleId)
    } catch (error) {
      if (error instanceof StyleNotRequestedError) throw new ConflictException(error.message)
      if (error instanceof UnknownStyleError) throw new BadRequestException(error.message)
      throw error
    }
    return { ok: true }
  }

  /**
   * A new chat, on the agent picked in the Agent dialog when `harness` is given. With
   * `rankingId` (the studio's "Open in chat"), a Ranking chat on that ranking, its mode chosen.
   */
  @Post('sessions')
  createSession(
    @Body() body: { harness?: unknown; rankingId?: unknown; title?: string },
  ): Promise<AgentSession> {
    // Checked before anything starts, so a bad request throws here (400) rather than later.
    const harness = body?.harness
    if (harness !== undefined && !AGENT_HARNESSES.includes(harness as AgentHarnessName))
      throw new BadRequestException('harness must be "codex" or "claude"')
    const rankingId = body?.rankingId
    if (rankingId !== undefined && (typeof rankingId !== 'string' || !/^[\da-f-]{36}$/.test(rankingId)))
      throw new BadRequestException('rankingId must be a ranking id')
    const opts =
      harness === undefined
        ? { title: body?.title }
        : { harness: harness as AgentHarnessName, title: body?.title }
    return this.sessions.createSession(rankingId ? { ...opts, rankingId } : opts).then(async (session) => {
      // Lists the harness's models now, so the chat's first message already runs on the right one.
      void this.chatModels.catalog(session.harness ?? 'codex')
      if (!rankingId) return session
      try {
        await this.sessions.chooseMode(session.id, 'ranking')
      } catch (error) {
        // Not ready (not signed in): the chat opens on its welcome card, which says why.
        if (error instanceof HarnessNotReadyError) return session
        throw error
      }
      return this.sessions.getSession(session.id)
    })
  }

  /** Deletes a chat. Its project stays (with its Agent tag) and only forgets the chat. */
  @Delete('sessions/:id')
  @HttpCode(204)
  async deleteSession(@Param('id') id: string): Promise<void> {
    checkSessionId(id)
    try {
      this.sessions.deleteSession(id)
    } catch (error) {
      if (error instanceof FlowActiveError)
        throw new ConflictException('The video is still being set up. Stop it first.')
      if (error instanceof AgentSessionBusyError)
        throw new ConflictException('Codex is still working. Stop the chat first.')
      throw error
    }
    // The chat is already gone (irreversible): a failure here must not turn into a 500, or
    // show up as a hung delete. A stale link only makes the project's "Open chat" land on the
    // chat-not-found page.
    try {
      await this.projects.clearAgentSession(id)
    } catch (error) {
      this.logger.warn(
        `Couldn't unlink project from deleted chat ${id}: ${ensureError(error).message}`,
      )
    }
  }

  @Sse('sessions/:id/events')
  events(
    @Param('id') id: string,
    @Query('after') after?: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    this.sessions.getSession(checkSessionId(id))
    const afterId = Number(lastEventId ?? after ?? 0) || 0
    return new Observable<MessageEvent>((subscriber) => {
      // Carries the replay start as its id, so a client that reconnects before any agent
      // event arrived resumes from the same place instead of skipping event 1.
      subscriber.next({ data: { sessionId: id }, id: String(afterId), type: 'hello' })
      const unsubscribe = this.sessions.subscribe(
        id,
        afterId,
        (event) => subscriber.next({ data: event, id: String(event.id), type: 'agent' }),
        // The service ends every open stream on shutdown so the HTTP server can close.
        () => subscriber.complete(),
      )
      return unsubscribe
    })
  }

  /** The chat; one that can pick up where it left off also says what picking up does
   *  (`resume`), for its button. */
  @Get('sessions/:id')
  getSession(@Param('id') id: string): AgentSession {
    return this.sessions.sessionView(checkSessionId(id))
  }

  @Get('sessions/:id/image')
  image(@Param('id') id: string, @Query('path') p: string, @Res() res: Response): void {
    // Only an existing session has a folder worth allowing (404 otherwise).
    this.sessions.getSession(checkSessionId(id))
    // A repeated `?path=` arrives as an array: only a single string is a path.
    const resolved =
      typeof p === 'string' && p ? resolveAllowedImagePath(p, this.sessions.sessionDir(id)) : null
    if (!resolved) throw new ForbiddenException('Path not allowed')
    // Serve the realpath that was checked, not `p`, so a symlink swapped in after the check is
    // never followed. It lies inside an allow-listed root, so it's safe to override `send`'s default
    // `dotfiles: 'ignore'` -- otherwise a path through a dot-segment like `~/.codex/...` 404s even
    // though it's allowed. If the file vanished in between, answer 404 instead of crashing.
    res.sendFile(resolved, { dotfiles: 'allow' }, (err) => {
      if (err && !res.headersSent) res.status(404).end()
    })
  }

  @Post('sessions/:id/interrupt')
  async interrupt(@Param('id') id: string): Promise<{ ok: true }> {
    await this.sessions.interrupt(checkSessionId(id))
    return { ok: true }
  }

  /** Every chat, newest activity first, with the project it made (name, stage, thumbnail).
   *  If the project lookup fails, the chats still list -- each with `project: null` until the
   *  next refresh -- rather than failing the whole list over a DB hiccup. */
  @Get('sessions')
  async listSessions(): Promise<AgentSessionListItem[]> {
    const sessions = this.sessions.listSessions()
    const ids = [...new Set(sessions.flatMap((s) => (s.projectId ? [s.projectId] : [])))]
    let summaries: Awaited<ReturnType<typeof this.projects.getProjectSummaries>> | null = null
    try {
      summaries = await this.projects.getProjectSummaries(ids)
    } catch (error) {
      this.logger.warn(
        `Couldn't load project summaries for the agent chat list: ${ensureError(error).message}`,
      )
    }
    return buildAgentSessionList(sessions, summaries)
  }

  /** "Pick up where you left off": carries on an Easy flow a restart cut off, from its first
   *  unanswered card. Answers at once (the flow goes on in the background, shown by its
   *  events); 409, with a plain reason, when there is nothing to pick up or it already runs;
   *  503 while ReelMakeEasy shuts down. */
  @Post('sessions/:id/resume')
  resume(@Param('id') id: string): { ok: true } {
    checkSessionId(id)
    try {
      this.sessions.resumeFlow(id)
    } catch (error) {
      if (error instanceof ShuttingDownError) throw new ServiceUnavailableException(error.message)
      if (error instanceof NotResumableError) throw new ConflictException(error.message)
      if (error instanceof FlowActiveError)
        throw new ConflictException('Your video is already being set up. Answer the cards above.')
      throw error
    }
    return { ok: true }
  }

  @Post('sessions/:id/messages')
  async sendMessage(
    @Param('id') id: string,
    @Body() body: { attachments?: unknown; text?: string },
  ): Promise<{ ok: true }> {
    checkSessionId(id)
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    const attachments = body?.attachments ?? []
    if (!Array.isArray(attachments)) throw new BadRequestException('attachments must be a list')
    if (attachments.length > MAX_ATTACHMENTS)
      throw new BadRequestException(`Attach up to ${MAX_ATTACHMENTS} files per message`)
    if (!text && !attachments.length) throw new BadRequestException('text is required')
    try {
      await this.sessions.sendMessage(id, text, attachments)
    } catch (error) {
      if (error instanceof UnknownAttachmentError) throw new BadRequestException(error.message)
      if (error instanceof AgentSessionBusyError) throw new ConflictException(error.message)
      // FlowActiveError's message asks the user to answer the autonomous cards instead.
      if (error instanceof FlowActiveError) throw new ConflictException(error.message)
      // A finished autonomous session: its message says to start a new session.
      if (error instanceof ModeNotChattableError) throw new ConflictException(error.message)
      throw error
    }
    return { ok: true }
  }

  /** `PUT /api/agent/sessions/:id/model { model, effort? }`: picks the chat's model for its next
   *  messages; `{ model: null }` goes back to the default. 400 for a model the harness lacks. */
  @Put('sessions/:id/model')
  async setChatModel(@Param('id') id: string, @Body() body: unknown): Promise<ChatModelState> {
    const session = this.sessions.getSession(checkSessionId(id))
    const harness = session.harness ?? 'codex'
    const choice = await this.choiceFrom(harness, body)
    const updated = this.sessions.setChatModel(id, choice)
    return this.chatModels.state(harness, updated.chatModel)
  }

  /** `PUT /api/agent/sessions/:id/model/default { model, effort? }`: saves the model as the
   *  default for every chat on this chat's harness; `{ model: null }` clears it (back to the
   *  recommended one). */
  @Put('sessions/:id/model/default')
  async setDefaultChatModel(
    @Param('id') id: string,
    @Body() body: unknown,
  ): Promise<ChatModelState> {
    const session = this.sessions.getSession(checkSessionId(id))
    const harness = session.harness ?? 'codex'
    this.chatModels.setDefault(harness, await this.choiceFrom(harness, body))
    return this.chatModels.state(harness, session.chatModel)
  }

  /** Opens a finished video's chat for editing (the Edit card). 409 while it cannot. */
  @Post('sessions/:id/edit')
  async startEditing(@Param('id') id: string): Promise<{ ok: true }> {
    checkSessionId(id)
    try {
      await this.edit.startEditing(id)
    } catch (error) {
      if (error instanceof EditNotReadyError) throw new ConflictException(error.message)
      throw error
    }
    return { ok: true }
  }

  @Get('status')
  async status(@Query('refresh') refresh?: string): Promise<AgentStatusResponse> {
    const opts = { refresh: refresh === '1' || refresh === 'true' }
    const [codex, claude] = await Promise.all([getCodexStatus(opts), getClaudeStatus(opts)])
    return { ...codex, claude, codex, defaultHarness: defaultHarness() }
  }

  /** A body's model choice for `harness`: null for `{ model: null }`, 400 for anything else
   *  that isn't a model (and thinking level) the harness offers. */
  private async choiceFrom(
    harness: AgentHarnessName,
    body: unknown,
  ): Promise<ChatModelChoice | null> {
    if (body && typeof body === 'object' && (body as { model?: unknown }).model === null)
      return null
    const choice = parseChoice(body)
    if (!choice) throw new BadRequestException('model is required')
    if (!(await this.chatModels.offers(harness, choice)))
      throw new BadRequestException(`${choice.model} isn't available for this account`)
    return choice
  }
}
