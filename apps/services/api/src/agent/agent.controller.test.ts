import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  MessageEvent,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import type { AgentSession } from '@shared/types/api/agent'
import type { Response } from 'express'

import { StyleNotRequestedError, UnknownStyleError } from './autonomous/autonomous.service'
import { EditNotReadyError } from './edit/agent-edit.service'
import { AgentController } from './agent.controller'
import { MAX_ATTACHMENT_BYTES } from './agent-attachments'
import {
  AgentSessionBusyError,
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
import { LoopbackOnlyGuard } from './loopback-only.guard'
import { MotionSetupTakenError } from './motion-reel/motion-reel.service'
import { MotionSetupError } from './motion-reel/motion-setup'

jest.mock('./codex/codex-locator', () => ({
  getCodexStatus: jest.fn(async () => ({
    available: true,
    binary: '/codex',
    loggedIn: true,
    version: '1',
  })),
}))
jest.mock('./claude/claude-locator', () => ({
  getClaudeStatus: jest.fn(async () => ({
    available: false,
    binary: '/claude',
    loggedIn: false,
    reason: 'not-logged-in',
    version: '2',
  })),
}))

const S1 = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'

const SESSION: AgentSession = {
  createdAt: '2026-01-01T00:00:00.000Z',
  id: S1,
  projectId: null,
  status: 'idle',
  threadId: null,
  title: 'Untitled video',
}

/** The autonomous flow, for tests that never reach the style route. */
const NO_AUTONOMOUS = { chooseStyle: jest.fn() } as never
const NO_EDIT = { startEditing: jest.fn().mockResolvedValue(undefined) } as never

/** Plain stub implementing only what `AgentController` calls on the service. */
interface StubService {
  answerQuestion: jest.Mock
  attachmentsDir: jest.Mock
  findAttachment: jest.Mock
  chooseMode: jest.Mock
  createSession: jest.Mock
  deleteSession: jest.Mock
  getSession: jest.Mock
  interrupt: jest.Mock
  listSessions: jest.Mock
  sendMessage: jest.Mock
  sessionDir: jest.Mock
  subscribe: jest.Mock
}

function makeStubService(overrides: Partial<StubService> = {}): StubService {
  return {
    answerQuestion: jest.fn(),
    chooseMode: jest.fn().mockResolvedValue(undefined),
    createSession: jest.fn().mockResolvedValue(SESSION),
    deleteSession: jest.fn(),
    getSession: jest.fn().mockReturnValue(SESSION),
    interrupt: jest.fn().mockResolvedValue(undefined),
    listSessions: jest.fn().mockReturnValue([SESSION]),
    attachmentsDir: jest.fn().mockReturnValue('/data/agent/s1/attachments'),
    findAttachment: jest.fn().mockReturnValue(null),
    sendMessage: jest.fn().mockResolvedValue(undefined),
    sessionDir: jest.fn().mockReturnValue('/data/agent/s1'),
    subscribe: jest.fn().mockReturnValue(jest.fn()),
    ...overrides,
  }
}

/** `ChatModelService`, for tests that never pick a model. */
const NO_MODELS = { catalog: jest.fn().mockResolvedValue(null) } as never
const NO_RANKINGS = { coverOf: () => null } as never
/** `MotionReelService`, for tests that never touch a Motion Reel. */
const NO_MOTION = { options: jest.fn(), setup: jest.fn() } as never

/** `ProjectService`, for tests that never list or delete chats. */
const NO_PROJECTS = {
  clearAgentSession: jest.fn().mockResolvedValue(undefined),
  getProjectSummaries: jest.fn().mockResolvedValue([]),
} as never

/** Drains an Observable<MessageEvent> into an array of the events it emits synchronously. */
function collect(obs: {
  subscribe: (fn: (e: MessageEvent) => void) => { unsubscribe: () => void }
}) {
  const events: MessageEvent[] = []
  const sub = obs.subscribe((e) => events.push(e))
  return { events, sub }
}

describe('AgentController', () => {
  describe('events', () => {
    it('emits hello first, then agent events with id = String(event.id) and data = the event', () => {
      const stub = makeStubService({
        subscribe: jest.fn((_id, _after, fn) => {
          fn({ id: 3, text: 'hi', type: 'user_message' })
          return jest.fn()
        }),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      const { events } = collect(controller.events(S1))

      expect(events[0]).toEqual({ data: { sessionId: S1 }, id: '0', type: 'hello' })
      expect(events[1]).toEqual({
        data: { id: 3, text: 'hi', type: 'user_message' },
        id: '3',
        type: 'agent',
      })
    })

    it('checks the session exists before subscribing', () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      collect(controller.events(S1))

      expect(stub.getSession).toHaveBeenCalledWith(S1)
    })

    it('uses the `after` query to set the replay start when no header is given', () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      collect(controller.events(S1, '7'))

      expect(stub.subscribe).toHaveBeenCalledWith(S1, 7, expect.any(Function), expect.any(Function))
    })

    it('prefers the last-event-id header over the `after` query when both are given', () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      collect(controller.events(S1, '7', '12'))

      expect(stub.subscribe).toHaveBeenCalledWith(
        S1,
        12,
        expect.any(Function),
        expect.any(Function),
      )
    })

    it('calls the service unsubscribe when the Observable is unsubscribed', () => {
      const unsubscribe = jest.fn()
      const stub = makeStubService({ subscribe: jest.fn().mockReturnValue(unsubscribe) })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      const { sub } = collect(controller.events(S1))
      sub.unsubscribe()

      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })

    it('gives the hello event the replay start as its id', () => {
      const controller = new AgentController(
        makeStubService() as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      const { events } = collect(controller.events(S1, '7'))

      expect(events[0]).toMatchObject({ id: '7', type: 'hello' })
    })

    it('completes the stream when the service ends it (shutdown)', () => {
      let end: (() => void) | undefined
      const stub = makeStubService({
        subscribe: jest.fn((_id, _after, _fn, onEnd) => {
          end = onEnd
          return jest.fn()
        }),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      let completed = false

      controller.events(S1).subscribe({ complete: () => (completed = true) })
      end?.()

      expect(completed).toBe(true)
    })

    it('rejects a malformed session id with 400 before looking it up', () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      expect(() => controller.events('..%2F..%2Fetc')).toThrow(BadRequestException)
      expect(stub.getSession).not.toHaveBeenCalled()
    })
  })

  it('reports both harnesses, keeping the Codex fields at the top for older pages', async () => {
    const controller = new AgentController(
      makeStubService() as never,
      NO_AUTONOMOUS,
      NO_PROJECTS,
      NO_EDIT,
      NO_MODELS,
      NO_RANKINGS,
      NO_MOTION,
    )
    const body = await controller.status('1')
    expect(body).toMatchObject({
      available: true,
      claude: { available: false, reason: 'not-logged-in' },
      codex: { available: true, binary: '/codex' },
      defaultHarness: 'codex',
    })
  })

  it('is guarded by LoopbackOnlyGuard', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AgentController)).toEqual([LoopbackOnlyGuard])
  })

  describe('createSession', () => {
    it('creates the session, forwarding the title, without greeting', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.createSession({ title: 'Bees' })).resolves.toEqual(SESSION)
      expect(stub.createSession).toHaveBeenCalledWith({ title: 'Bees' })
    })

    it('creates the session on the picked agent, and refuses an unknown one', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      await controller.createSession({ harness: 'claude', title: 'Bees' })
      expect(stub.createSession).toHaveBeenCalledWith({ harness: 'claude', title: 'Bees' })
      expect(() => controller.createSession({ harness: 'gemini' })).toThrow(BadRequestException)
    })

    it('chooses a mode when asked, with what the user typed as its first message', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      await controller.createSession({ mode: 'ranking_easy', request: '  Funniest dog fails ' })
      expect(stub.chooseMode).toHaveBeenCalledWith(
        SESSION.id,
        'ranking_easy',
        undefined,
        'Funniest dog fails',
      )
      const rankingId = '11111111-2222-3333-4444-555555555555'
      await controller.createSession({ rankingId, request: 'add a boom on #2' })
      expect(stub.chooseMode).toHaveBeenLastCalledWith(
        SESSION.id,
        'ranking',
        undefined,
        'add a boom on #2',
      )
      expect(() => controller.createSession({ mode: 'guided' })).toThrow(BadRequestException)
      expect(() => controller.createSession({ request: 'x'.repeat(2001) })).toThrow(
        BadRequestException,
      )
    })

    it('creates the session with no title', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await controller.createSession({})
      expect(stub.createSession).toHaveBeenCalledWith({ title: undefined })
    })
  })

  describe('chooseMode', () => {
    it('passes the mode to the service and returns ok (201 by Nest default for @Post)', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.chooseMode(S1, { mode: 'free' })).resolves.toEqual({ ok: true })
      expect(stub.chooseMode).toHaveBeenCalledWith(S1, 'free')
    })

    it('refuses a Motion Reel (409, with the reason) when the account has neither Opus nor Astra', async () => {
      const stub = makeStubService()
      const models = { motionGate: jest.fn().mockResolvedValue('Motion Reel needs GPT Astra.') }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        models as never,
        NO_RANKINGS,
        NO_MOTION,
      )
      await expect(controller.chooseMode(S1, { harness: 'codex', mode: 'motion' })).rejects.toThrow(
        'Motion Reel needs GPT Astra.',
      )
      expect(models.motionGate).toHaveBeenCalledWith('codex')
      expect(stub.chooseMode).not.toHaveBeenCalled()
      models.motionGate.mockResolvedValue(null)
      await expect(
        controller.chooseMode(S1, { harness: 'codex', mode: 'motion' }),
      ).resolves.toEqual({
        ok: true,
      })
      expect(stub.chooseMode).toHaveBeenCalledWith(S1, 'motion', 'codex')
    })

    it('refuses an Advanced Motion Reel the same way, and pins its model too', async () => {
      const stub = makeStubService()
      const models = { motionGate: jest.fn().mockResolvedValue('Motion Reel needs Claude Opus.') }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        models as never,
        NO_RANKINGS,
        NO_MOTION,
      )
      await expect(
        controller.chooseMode(S1, { harness: 'claude', mode: 'motion_free' }),
      ).rejects.toThrow('Motion Reel needs Claude Opus.')
      expect(stub.chooseMode).not.toHaveBeenCalled()
    })

    it('opens a chat made for a Motion Reel on its welcome card when the model is missing', async () => {
      const stub = makeStubService()
      const models = {
        catalog: jest.fn().mockResolvedValue(null),
        motionGate: jest.fn().mockResolvedValue('Motion Reel needs GPT Astra.'),
      }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        models as never,
        NO_RANKINGS,
        NO_MOTION,
      )
      await expect(controller.createSession({ mode: 'motion_free' })).resolves.toEqual(SESSION)
      expect(stub.chooseMode).not.toHaveBeenCalled()
      models.motionGate.mockResolvedValue(null)
      await controller.createSession({ mode: 'motion' })
      expect(stub.chooseMode).toHaveBeenCalledWith(SESSION.id, 'motion', undefined, undefined)
    })

    it('answers a Motion Reel setup card: 400 for a bad card, 409 once it is taken', () => {
      const motion = { setup: jest.fn() }
      const controller = new AgentController(
        makeStubService() as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        motion as never,
      )
      expect(controller.setupMotionReel(S1, { subject: 'x' })).toEqual({ ok: true })
      motion.setup.mockImplementation(() => {
        throw new MotionSetupError('Pick a style.')
      })
      expect(() => controller.setupMotionReel(S1, {})).toThrow(BadRequestException)
      motion.setup.mockImplementation(() => {
        throw new MotionSetupTakenError()
      })
      expect(() => controller.setupMotionReel(S1, {})).toThrow(ConflictException)
    })

    it('starts Free chat for "guided", the removed mode, so an old page still works', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      await expect(controller.chooseMode(S1, { mode: 'guided' })).resolves.toEqual({ ok: true })
      await expect(
        controller.chooseMode(S1, { harness: 'claude', mode: 'guided' }),
      ).resolves.toEqual({ ok: true })
      expect(stub.chooseMode.mock.calls).toEqual([
        [S1, 'free'],
        [S1, 'free', 'claude'],
      ])
    })

    it('passes the harness, and refuses an unknown one', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      await expect(controller.chooseMode(S1, { harness: 'claude', mode: 'free' })).resolves.toEqual(
        { ok: true },
      )
      expect(stub.chooseMode).toHaveBeenCalledWith(S1, 'free', 'claude')
      await expect(
        controller.chooseMode(S1, { harness: 'gemini', mode: 'free' }),
      ).rejects.toBeInstanceOf(BadRequestException)
      expect(stub.chooseMode).toHaveBeenCalledTimes(1)
    })

    it('answers 409 when the harness is not ready', async () => {
      const stub = makeStubService({
        chooseMode: jest
          .fn()
          .mockRejectedValue(new HarnessNotReadyError('claude', 'not-logged-in')),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      await expect(
        controller.chooseMode(S1, { harness: 'claude', mode: 'free' }),
      ).rejects.toBeInstanceOf(ConflictException)
    })

    it('accepts every valid mode', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      for (const mode of ['free', 'autonomous'])
        await expect(controller.chooseMode(S1, { mode })).resolves.toEqual({ ok: true })
    })

    it('throws BadRequestException for an invalid or missing mode', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.chooseMode(S1, { mode: 'x' })).rejects.toBeInstanceOf(
        BadRequestException,
      )
      await expect(controller.chooseMode(S1, {})).rejects.toBeInstanceOf(BadRequestException)
      await expect(controller.chooseMode(S1, { mode: 123 })).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(stub.chooseMode).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for a malformed session id, before calling the service', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.chooseMode('../x', { mode: 'free' })).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(stub.chooseMode).not.toHaveBeenCalled()
    })

    it('propagates a 404 for an unknown session', async () => {
      const stub = makeStubService({
        chooseMode: jest.fn().mockRejectedValue(new NotFoundException()),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.chooseMode(S1, { mode: 'free' })).rejects.toBeInstanceOf(
        NotFoundException,
      )
    })

    it('maps EditNotReadyError on the edit route to ConflictException (409)', async () => {
      const edit = { startEditing: jest.fn().mockRejectedValue(new EditNotReadyError('not yet')) }
      const controller = new AgentController(
        makeStubService() as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        edit as never,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      await expect(controller.startEditing(S1)).rejects.toBeInstanceOf(ConflictException)
      await expect(controller.startEditing(S1)).rejects.toMatchObject({ message: 'not yet' })
      edit.startEditing.mockResolvedValue(undefined)
      await expect(controller.startEditing(S1)).resolves.toEqual({ ok: true })
    })

    it('maps ModeAlreadyChosenError to ConflictException (409)', async () => {
      const stub = makeStubService({
        chooseMode: jest.fn().mockRejectedValue(new ModeAlreadyChosenError(S1)),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.chooseMode(S1, { mode: 'free' })).rejects.toBeInstanceOf(
        ConflictException,
      )
    })

    it('still answers 201 when the kickoff/autonomous run the service detached fails later', async () => {
      // The service resolves `chooseMode` as soon as the mode is recorded; a later failure of
      // the detached kickoff/autonomous run (reported only through events, not a rejection)
      // must never turn into an HTTP error here - the controller never even sees it.
      const stub = makeStubService({ chooseMode: jest.fn().mockResolvedValue(undefined) })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.chooseMode(S1, { mode: 'autonomous' })).resolves.toEqual({
        ok: true,
      })
    })
  })

  describe('resume ("Pick up where you left off")', () => {
    it('hands the chat to the service and answers ok', () => {
      const resumeFlow = jest.fn()
      const stub = { ...makeStubService(), resumeFlow }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      expect(controller.resume(S1)).toEqual({ ok: true })
      expect(resumeFlow).toHaveBeenCalledWith(S1)
    })

    it('answers 409 with the plain reason when there is nothing to pick up, or the flow runs', () => {
      const resumeFlow = jest
        .fn()
        .mockImplementationOnce(() => {
          throw new NotResumableError(
            S1,
            'You stopped this chat. Start a new chat to make a video.',
          )
        })
        .mockImplementationOnce(() => {
          throw new FlowActiveError(S1)
        })
      const stub = { ...makeStubService(), resumeFlow }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      expect(() => controller.resume(S1)).toThrow(
        new ConflictException('You stopped this chat. Start a new chat to make a video.'),
      )
      expect(() => controller.resume(S1)).toThrow(
        new ConflictException('Your video is already being set up. Answer the cards above.'),
      )
    })

    it('answers 503, in plain words, while ReelMakeEasy shuts down', () => {
      const resumeFlow = jest.fn(() => {
        throw new ShuttingDownError(S1)
      })
      const stub = { ...makeStubService(), resumeFlow }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      expect(() => controller.resume(S1)).toThrow(
        new ServiceUnavailableException('ReelMakeEasy is restarting. Try again in a moment.'),
      )
    })

    it("the chat's view says what picking up does (GET /sessions/:id)", () => {
      const view: AgentSession = {
        ...SESSION,
        interrupted: true,
        mode: 'autonomous',
        resume: { costUsd: 1.2, kind: 'make_loop' },
        status: 'stopped',
      }
      const sessionView = jest.fn().mockReturnValue(view)
      const stub = { ...makeStubService(), sessionView }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      expect(controller.getSession(S1)).toBe(view)
      expect(sessionView).toHaveBeenCalledWith(S1)
    })

    it('answers 400 for a malformed id and 404 for a deleted chat', () => {
      const resumeFlow = jest.fn(() => {
        throw new NotFoundException('Unknown agent session')
      })
      const stub = { ...makeStubService(), resumeFlow }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      expect(() => controller.resume('../x')).toThrow(BadRequestException)
      expect(resumeFlow).not.toHaveBeenCalled()
      expect(() => controller.resume(S1)).toThrow(NotFoundException)
    })
  })

  describe('chooseStyle', () => {
    const makeAutonomous = (chooseStyle = jest.fn().mockResolvedValue(undefined)) => ({
      chooseStyle,
    })

    it('passes the style to the autonomous flow and returns ok (201)', async () => {
      const autonomous = makeAutonomous()
      const controller = new AgentController(
        makeStubService() as never,
        autonomous as never,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.chooseStyle(S1, { styleId: '3d-animation' })).resolves.toEqual({
        ok: true,
      })
      expect(autonomous.chooseStyle).toHaveBeenCalledWith(S1, '3d-animation')
    })

    it('answers 400 for a missing or malformed style id, before calling the flow', async () => {
      const autonomous = makeAutonomous()
      const controller = new AgentController(
        makeStubService() as never,
        autonomous as never,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const bodies = [
        {},
        { styleId: '' },
        { styleId: '  ' },
        { styleId: 3 },
        { styleId: 'x'.repeat(201) },
      ]

      for (const body of bodies)
        await expect(controller.chooseStyle(S1, body)).rejects.toBeInstanceOf(BadRequestException)
      await expect(controller.chooseStyle(S1, { styleId: 'x'.repeat(201) })).rejects.toThrow(
        'styleId is invalid',
      )
      await expect(controller.chooseStyle(S1, {})).rejects.toThrow('styleId is required')
      await expect(controller.chooseStyle('../x', { styleId: 'a' })).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(autonomous.chooseStyle).not.toHaveBeenCalled()
    })

    it('answers 400 for an unknown style', async () => {
      const autonomous = makeAutonomous(jest.fn().mockRejectedValue(new UnknownStyleError('nope')))
      const controller = new AgentController(
        makeStubService() as never,
        autonomous as never,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.chooseStyle(S1, { styleId: 'nope' })).rejects.toBeInstanceOf(
        BadRequestException,
      )
    })

    it('answers 404 for an unknown session', async () => {
      const autonomous = makeAutonomous()
      const stub = makeStubService({
        getSession: jest.fn(() => {
          throw new NotFoundException()
        }),
      })
      const controller = new AgentController(
        stub as never,
        autonomous as never,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.chooseStyle(S1, { styleId: 'a' })).rejects.toBeInstanceOf(
        NotFoundException,
      )
      expect(autonomous.chooseStyle).not.toHaveBeenCalled()
    })

    it('answers 409 when the session is not waiting for a style', async () => {
      const autonomous = makeAutonomous(jest.fn().mockRejectedValue(new StyleNotRequestedError(S1)))
      const controller = new AgentController(
        makeStubService() as never,
        autonomous as never,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.chooseStyle(S1, { styleId: 'a' })).rejects.toBeInstanceOf(
        ConflictException,
      )
    })
  })

  describe('attachments', () => {
    let dir: string
    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-attach-ctl-'))
    })
    afterEach(() => fs.rmSync(dir, { force: true, recursive: true }))

    const upload = (body: Buffer[], headers: Record<string, string> = {}) =>
      Object.assign(Readable.from(body), {
        headers: { 'content-type': 'application/octet-stream', ...headers },
        is: (type: string) => (headers['content-type'] ?? '').includes(type.split('/')[1] ?? type),
      }) as never

    it("saves an upload in the chat's attachments folder and says what to send", async () => {
      const stub = makeStubService({ attachmentsDir: jest.fn().mockReturnValue(dir) })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const saved = await controller.attach(S1, 'My Photo.png', upload([Buffer.from('png bytes')]))
      expect(saved).toMatchObject({ kind: 'image', size: 9 })
      expect(saved.name).toMatch(/^My-Photo-[0-9a-f]{6}\.png$/)
      expect(fs.readFileSync(path.join(dir, saved.name), 'utf8')).toBe('png bytes')
    })

    it('refuses a JSON body, a missing name and a file over the limit (nothing left behind)', async () => {
      const stub = makeStubService({ attachmentsDir: jest.fn().mockReturnValue(dir) })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      await expect(
        controller.attach(
          S1,
          'a.png',
          upload([Buffer.from('{}')], { 'content-type': 'application/json' }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(controller.attach(S1, undefined, upload([]))).rejects.toBeInstanceOf(
        BadRequestException,
      )
      await expect(
        controller.attach(
          S1,
          'big.mp4',
          upload([], { 'content-length': String(MAX_ATTACHMENT_BYTES + 1) }),
        ),
      ).rejects.toBeInstanceOf(PayloadTooLargeException)
      const chunk = Buffer.alloc(64 * 1024 * 1024)
      await expect(
        controller.attach(S1, 'big.mp4', upload([chunk, chunk, chunk, chunk])),
      ).rejects.toBeInstanceOf(PayloadTooLargeException)
      expect(fs.readdirSync(dir)).toEqual([])
    })

    it('serves an attached file: media inline, anything else as a sandboxed download', () => {
      const stub = makeStubService({
        findAttachment: jest.fn((_id: string, name: string) =>
          name === 'missing'
            ? null
            : {
                kind: name.endsWith('.mp3') ? 'audio' : 'file',
                name,
                path: `/w/attachments/${name}`,
                size: 3,
              },
        ),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const sendFile = jest.fn()
      controller.attachment(S1, 'um-a1.mp3', { sendFile } as never)
      expect(sendFile).toHaveBeenCalledWith(
        '/w/attachments/um-a1.mp3',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Disposition': 'inline; filename="um-a1.mp3"',
            'Content-Security-Policy': 'sandbox',
          }),
        }),
        expect.any(Function),
      )
      controller.attachment(S1, 'page-a1.html', { sendFile } as never)
      expect(sendFile.mock.calls[1][1].headers['Content-Disposition']).toBe(
        'attachment; filename="page-a1.html"',
      )
      expect(() => controller.attachment(S1, 'missing', { sendFile } as never)).toThrow(
        NotFoundException,
      )
    })

    it('sends attached file names with the message, and takes a message with only files', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      await controller.sendMessage(S1, { attachments: ['a-1.png'], text: '  look  ' })
      expect(stub.sendMessage).toHaveBeenCalledWith(S1, 'look', ['a-1.png'])
      await controller.sendMessage(S1, { attachments: ['a-1.png'] })
      expect(stub.sendMessage).toHaveBeenLastCalledWith(S1, '', ['a-1.png'])
    })

    it('refuses a bad attachments list and maps an unknown file to 400', async () => {
      const stub = makeStubService({
        sendMessage: jest.fn().mockRejectedValue(new UnknownAttachmentError('gone.png')),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      await expect(
        controller.sendMessage(S1, { attachments: 'a.png', text: 'hi' }),
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        controller.sendMessage(S1, { attachments: new Array(11).fill('a.png'), text: 'hi' }),
      ).rejects.toBeInstanceOf(BadRequestException)
      await expect(
        controller.sendMessage(S1, { attachments: ['gone.png'], text: 'hi' }),
      ).rejects.toThrow('No attached file named "gone.png"')
    })
  })

  describe('chat models', () => {
    const state = { current: { model: 'gpt-6-astra' }, source: 'recommended' }
    const models = () => ({
      offers: jest.fn(async (_h: string, c: { model: string }) => c.model !== 'gpt-4'),
      setDefault: jest.fn(),
      state: jest.fn().mockResolvedValue(state),
    })
    const withSession = (chatModel?: object) =>
      makeStubService({
        getSession: jest.fn().mockReturnValue({ ...SESSION, chatModel, harness: 'codex' }),
        setChatModel: jest.fn((_id: string, choice: object | null) => ({
          ...SESSION,
          chatModel: choice ?? undefined,
        })),
      } as never)

    it("reads the chat's model state, asking the harness again on refresh", async () => {
      const chatModels = models()
      const controller = new AgentController(
        withSession({ model: 'gpt-6-sol' }) as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        chatModels as never,
        NO_RANKINGS,
        NO_MOTION,
      )
      await expect(controller.chatModel(S1, '1')).resolves.toBe(state)
      expect(chatModels.state).toHaveBeenCalledWith(
        'codex',
        { model: 'gpt-6-sol' },
        { refresh: true },
      )
    })

    it('picks a model for the chat, refuses one the account lacks, and null goes back', async () => {
      const chatModels = models()
      const stub = withSession()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        chatModels as never,
        NO_RANKINGS,
        NO_MOTION,
      )
      await controller.setChatModel(S1, { effort: 'high', model: 'gpt-6-sol' })
      expect((stub as never as { setChatModel: jest.Mock }).setChatModel).toHaveBeenCalledWith(S1, {
        effort: 'high',
        model: 'gpt-6-sol',
      })
      await expect(controller.setChatModel(S1, { model: 'gpt-4' })).rejects.toBeInstanceOf(
        BadRequestException,
      )
      await expect(controller.setChatModel(S1, {})).rejects.toBeInstanceOf(BadRequestException)
      await controller.setChatModel(S1, { model: null })
      expect((stub as never as { setChatModel: jest.Mock }).setChatModel).toHaveBeenLastCalledWith(
        S1,
        null,
      )
    })

    it("saves or clears the default for the chat's harness", async () => {
      const chatModels = models()
      const controller = new AgentController(
        withSession() as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        chatModels as never,
        NO_RANKINGS,
        NO_MOTION,
      )
      await controller.setDefaultChatModel(S1, { model: 'gpt-6.1-sol' })
      expect(chatModels.setDefault).toHaveBeenCalledWith('codex', { model: 'gpt-6.1-sol' })
      await controller.setDefaultChatModel(S1, { model: null })
      expect(chatModels.setDefault).toHaveBeenLastCalledWith('codex', null)
    })
  })

  describe('sendMessage', () => {
    it('throws BadRequestException for empty text', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.sendMessage(S1, { text: '' })).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(stub.sendMessage).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for whitespace-only text', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.sendMessage(S1, { text: '   ' })).rejects.toBeInstanceOf(
        BadRequestException,
      )
      expect(stub.sendMessage).not.toHaveBeenCalled()
    })

    it('maps AgentSessionBusyError to ConflictException (409)', async () => {
      const stub = makeStubService({
        sendMessage: jest.fn().mockRejectedValue(new AgentSessionBusyError(S1)),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.sendMessage(S1, { text: 'hi' })).rejects.toBeInstanceOf(
        ConflictException,
      )
    })

    it('maps FlowActiveError to 409 with the autonomous message', async () => {
      const stub = makeStubService({
        sendMessage: jest.fn().mockRejectedValue(new FlowActiveError(S1)),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      const error = await controller.sendMessage(S1, { text: 'hi' }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ConflictException)
      expect((error as ConflictException).message).toBe(
        'Autonomous mode is making your video — answer the cards above.',
      )
    })

    it('maps ModeNotChattableError to 409 with the finished-session message', async () => {
      const stub = makeStubService({
        sendMessage: jest.fn().mockRejectedValue(new ModeNotChattableError(S1)),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      const error = await controller.sendMessage(S1, { text: 'hi' }).catch((e: unknown) => e)
      expect(error).toBeInstanceOf(ConflictException)
      expect((error as ConflictException).message).toBe(
        'This autonomous session is finished. Start a new session to chat.',
      )
    })

    it('sends the trimmed text and returns ok on success', async () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      await expect(controller.sendMessage(S1, { text: '  hi  ' })).resolves.toEqual({ ok: true })
      expect(stub.sendMessage).toHaveBeenCalledWith(S1, 'hi', [])
    })
  })

  describe('answerQuestion', () => {
    it('passes the answers to the service and returns ok', () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      expect(controller.answerQuestion(S1, 'q-turn-1', { answers: { tone: ['Serious'] } })).toEqual(
        { ok: true },
      )
      expect(stub.getSession).toHaveBeenCalledWith(S1)
      expect(stub.answerQuestion).toHaveBeenCalledWith(S1, 'q-turn-1', { tone: ['Serious'] })
    })

    it('rejects a bad session id, question id or body with 400', () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const ok = { answers: { tone: ['x'] } }

      expect(() => controller.answerQuestion('../x', 'q-1', ok)).toThrow(BadRequestException)
      expect(() => controller.answerQuestion(S1, 'a b', ok)).toThrow(BadRequestException)
      expect(() => controller.answerQuestion(S1, 'q'.repeat(201), ok)).toThrow(BadRequestException)
      for (const body of [{}, { answers: [] }, { answers: 'x' }, { answers: null }, undefined])
        expect(() => controller.answerQuestion(S1, 'q-1', body as never)).toThrow(
          BadRequestException,
        )
      expect(stub.answerQuestion).not.toHaveBeenCalled()
    })

    it('answers 404 for an unknown session', () => {
      const stub = makeStubService({
        getSession: jest.fn(() => {
          throw new NotFoundException()
        }),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      expect(() => controller.answerQuestion(S1, 'q-1', { answers: { tone: ['x'] } })).toThrow(
        NotFoundException,
      )
      expect(stub.answerQuestion).not.toHaveBeenCalled()
    })

    it('maps QuestionNotOpenError to 409 and InvalidAnswerError to 400', () => {
      const notOpen = makeStubService({
        answerQuestion: jest.fn(() => {
          throw new QuestionNotOpenError('q-1')
        }),
      })
      expect(() =>
        new AgentController(
          notOpen as never,
          NO_AUTONOMOUS,
          NO_PROJECTS,
          NO_EDIT,
          NO_MODELS,
          NO_RANKINGS,
          NO_MOTION,
        ).answerQuestion(S1, 'q-1', {
          answers: {},
        }),
      ).toThrow(ConflictException)

      const invalid = makeStubService({
        answerQuestion: jest.fn(() => {
          throw new InvalidAnswerError('Answer question "tone"')
        }),
      })
      expect(() =>
        new AgentController(
          invalid as never,
          NO_AUTONOMOUS,
          NO_PROJECTS,
          NO_EDIT,
          NO_MODELS,
          NO_RANKINGS,
          NO_MOTION,
        ).answerQuestion(S1, 'q-1', {
          answers: {},
        }),
      ).toThrow(new BadRequestException('Answer question "tone"'))
    })
  })

  describe('image', () => {
    let sessionDir: string
    let outsideDir: string

    beforeEach(() => {
      sessionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-controller-session-'))
      outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-controller-outside-'))
    })

    afterEach(() => {
      fs.rmSync(sessionDir, { force: true, recursive: true })
      fs.rmSync(outsideDir, { force: true, recursive: true })
    })

    it('throws ForbiddenException for a real image outside the allowed roots', () => {
      const stub = makeStubService({ sessionDir: jest.fn().mockReturnValue(sessionDir) })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const res = { sendFile: jest.fn() } as unknown as Response
      const outsideImage = path.join(outsideDir, 'a.png')
      fs.writeFileSync(outsideImage, '')

      expect(() => controller.image(S1, outsideImage, res)).toThrow(ForbiddenException)
      expect(res.sendFile).not.toHaveBeenCalled()
    })

    it('throws ForbiddenException when no path is given', () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const res = { sendFile: jest.fn() } as unknown as Response

      expect(() => controller.image(S1, '', res)).toThrow(ForbiddenException)
    })

    it('serves an image inside a hidden folder with dotfiles allowed', () => {
      const stub = makeStubService({ sessionDir: jest.fn().mockReturnValue(sessionDir) })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const res = { sendFile: jest.fn() } as unknown as Response
      const hiddenDir = path.join(sessionDir, '.hidden')
      fs.mkdirSync(hiddenDir)
      const hiddenImage = path.join(hiddenDir, 'pic.png')
      fs.writeFileSync(hiddenImage, '')

      controller.image(S1, hiddenImage, res)

      expect(res.sendFile).toHaveBeenCalledWith(
        fs.realpathSync(hiddenImage),
        expect.objectContaining({ dotfiles: 'allow' }),
        expect.any(Function),
      )
    })

    it('responds 404 without crashing if sendFile fails before sending headers', () => {
      const stub = makeStubService({ sessionDir: jest.fn().mockReturnValue(sessionDir) })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      let sendFileCallback: ((err?: Error) => void) | undefined
      const res = {
        end: jest.fn(),
        headersSent: false,
        sendFile: jest.fn((_path: string, _opts: unknown, cb: (err?: Error) => void) => {
          sendFileCallback = cb
        }),
        status: jest.fn().mockReturnThis(),
      } as unknown as Response
      const image = path.join(sessionDir, 'pic.png')
      fs.writeFileSync(image, '')

      controller.image(S1, image, res)
      sendFileCallback?.(new Error('file vanished'))

      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.end).toHaveBeenCalled()
    })

    it('does not touch the response if sendFile fails after headers were already sent', () => {
      const stub = makeStubService({ sessionDir: jest.fn().mockReturnValue(sessionDir) })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      let sendFileCallback: ((err?: Error) => void) | undefined
      const res = {
        end: jest.fn(),
        headersSent: true,
        sendFile: jest.fn((_path: string, _opts: unknown, cb: (err?: Error) => void) => {
          sendFileCallback = cb
        }),
        status: jest.fn().mockReturnThis(),
      } as unknown as Response
      const image = path.join(sessionDir, 'pic.png')
      fs.writeFileSync(image, '')

      controller.image(S1, image, res)
      sendFileCallback?.(new Error('stream errored mid-flight'))

      expect(res.status).not.toHaveBeenCalled()
      expect(res.end).not.toHaveBeenCalled()
    })

    it('rejects an encoded ../ session id with 400 and never builds a session folder', () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const res = { sendFile: jest.fn() } as unknown as Response
      const image = path.join(outsideDir, 'a.png')
      fs.writeFileSync(image, '')

      for (const id of ['..%2F..%2F..', '../..', path.relative('/data/agent', outsideDir)])
        expect(() => controller.image(id, image, res)).toThrow(BadRequestException)
      expect(stub.sessionDir).not.toHaveBeenCalled()
      expect(res.sendFile).not.toHaveBeenCalled()
    })

    it('rejects Object.prototype keys like `constructor` as session ids', () => {
      const stub = makeStubService()
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const res = { sendFile: jest.fn() } as unknown as Response

      expect(() => controller.image('constructor', '/x/a.png', res)).toThrow(BadRequestException)
      expect(() => controller.getSession('__proto__')).toThrow(BadRequestException)
    })

    it('answers 404 for an unknown session id before touching the path', () => {
      const stub = makeStubService({
        getSession: jest.fn(() => {
          throw new NotFoundException()
        }),
      })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const res = { sendFile: jest.fn() } as unknown as Response

      expect(() => controller.image(S1, path.join(sessionDir, 'a.png'), res)).toThrow(
        NotFoundException,
      )
      expect(stub.sessionDir).not.toHaveBeenCalled()
    })

    it('serves the resolved (realpath) path, not the one it was given', () => {
      const stub = makeStubService({ sessionDir: jest.fn().mockReturnValue(sessionDir) })
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const res = { sendFile: jest.fn() } as unknown as Response
      const target = path.join(sessionDir, 'real.png')
      fs.writeFileSync(target, '')
      const link = path.join(sessionDir, 'link.png')
      fs.symlinkSync(target, link)

      controller.image(S1, link, res)

      expect(res.sendFile).toHaveBeenCalledWith(
        fs.realpathSync(target),
        expect.anything(),
        expect.any(Function),
      )
    })
  })

  describe('chat list and delete', () => {
    it('lists chats with their projects', async () => {
      const stub = makeStubService({
        listSessions: jest.fn().mockReturnValue([{ ...SESSION, projectId: 'p1' }]),
      })
      const projects = {
        clearAgentSession: jest.fn(),
        getProjectSummaries: jest.fn().mockResolvedValue([
          {
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            id: 'p1',
            isDeleted: false,
            name: 'Comet',
            previewThumbnail: null,
            resultVideo: null,
            resultVideoThumbnail: null,
            stage: 'STORYBOARD',
            styleThumbnailUrl: null,
          },
        ]),
      }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        projects as never,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      const list = await controller.listSessions()
      expect(projects.getProjectSummaries).toHaveBeenCalledWith(['p1'])
      expect(list).toEqual([
        expect.objectContaining({
          id: S1,
          project: expect.objectContaining({ id: 'p1' }),
          title: 'Comet',
        }),
      ])
    })

    it('still lists chats, each with project: null, when getProjectSummaries throws', async () => {
      const stub = makeStubService({
        listSessions: jest.fn().mockReturnValue([
          { ...SESSION, id: 'a', projectId: 'p1' },
          { ...SESSION, id: 'b', projectId: null },
        ]),
      })
      const projects = {
        clearAgentSession: jest.fn(),
        getProjectSummaries: jest.fn().mockRejectedValue(new Error('db down')),
      }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        projects as never,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )

      const list = await controller.listSessions()

      expect(list).toHaveLength(2)
      expect(list.every((i) => i.project === null)).toBe(true)
    })

    it('deletes a chat and clears its project link', async () => {
      const stub = makeStubService()
      const projects = { clearAgentSession: jest.fn().mockResolvedValue(undefined) }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        projects as never,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      await controller.deleteSession(S1)
      expect(stub.deleteSession).toHaveBeenCalledWith(S1)
      expect(projects.clearAgentSession).toHaveBeenCalledWith(S1)
    })

    it('still deletes (and resolves) when clearing the project link fails: the chat is already gone', async () => {
      const stub = makeStubService()
      const projects = { clearAgentSession: jest.fn().mockRejectedValue(new Error('db down')) }
      const controller = new AgentController(
        stub as never,
        NO_AUTONOMOUS,
        projects as never,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      await expect(controller.deleteSession(S1)).resolves.toBeUndefined()
      expect(stub.deleteSession).toHaveBeenCalledWith(S1)
    })

    it('answers 409 for a busy chat or an active flow, and 400 for a bad id', async () => {
      for (const error of [new AgentSessionBusyError(S1), new FlowActiveError(S1)]) {
        const stub = makeStubService({
          deleteSession: jest.fn(() => {
            throw error
          }),
        })
        const controller = new AgentController(
          stub as never,
          NO_AUTONOMOUS,
          NO_PROJECTS,
          NO_EDIT,
          NO_MODELS,
          NO_RANKINGS,
          NO_MOTION,
        )
        await expect(controller.deleteSession(S1)).rejects.toBeInstanceOf(ConflictException)
      }
      const controller = new AgentController(
        makeStubService() as never,
        NO_AUTONOMOUS,
        NO_PROJECTS,
        NO_EDIT,
        NO_MODELS,
        NO_RANKINGS,
        NO_MOTION,
      )
      // `checkSessionId` (the controller's existing id check) throws BadRequestException for a
      // malformed id, not NotFoundException: keep that existing contract here.
      await expect(controller.deleteSession('../x')).rejects.toBeInstanceOf(BadRequestException)
    })
  })
})
