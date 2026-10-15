import {
  ATTENTION_HOOK_HEADER,
  CAMERA_STYLE_HEADER,
  LENGTH_HEADER,
  MUSIC_HEADER,
  splitRecommended,
} from '@reelmakeeasy/common/codex-agent/agent-storyboard'
import {
  initialTranscript,
  reduceTranscript,
  type TranscriptEntry,
  VIDEO_STARTED_MESSAGE,
} from '@reelmakeeasy/common/codex-agent/agent-transcript'
import { JobContext } from '@reelmakeeasy/common/job-context'
import { Logger } from '@reelmakeeasy/common/logger'
import {
  BEAT_CLIP_SECONDS,
  BEAT_LOOP_STYLE_PRESETS,
  lineTooLongIssue,
  narrationTarget,
  validateBeatLoopStoryboard,
} from '@reelmakeeasy/common/long-take/beat-loop-craft'
import {
  CAMERA_STYLE_INFO,
  CAMERA_STYLE_OPTIONS,
  type CameraStyle,
} from '@reelmakeeasy/common/long-take/camera-craft'
import {
  MUSIC_CHOICE_OPTIONS,
  MUSIC_CHOICES,
  MUSIC_INFO,
  MUSIC_LIBRARY_LABEL,
  MUSIC_MINE_LABEL,
  type MusicCatalog,
  type MusicRequest,
  musicRequestFromText,
  resolveMusicRequest,
} from '@reelmakeeasy/common/long-take/music-craft'
import { CAMERA_SAMPLES, type CameraSampleId } from '@reelmakeeasy/common/storage/camera-samples'
import { presetPackUri } from '@reelmakeeasy/common/storage/presets'
import { getStoryModeUserLimits } from '@reelmakeeasy/common/story-mode/user-limits'
import type { UserInfo } from '@reelmakeeasy/common/types/user'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  type AgentAnswers,
  type AgentAutonomousBrief,
  type AgentEasyProgress,
  type AgentHarnessName,
  type AgentOptionSample,
  type AgentQuestion,
  type AgentResumeAction,
  type AgentUiEvent,
  BEAT_LOOP_USE_CASE,
  type BeatLoopLength,
  type BeatLoopStoryboard,
} from '@shared/types/api/agent'
import type { ProjectCreateRequestBody } from '@shared/types/api/project'
import type { DebugSettings } from '@shared/types/project/debug-settings'
import type { ZodType } from 'zod'

import {
  type BeatLoopEstimate,
  beatLoopEstimate,
  type BeatLoopLinesCheck,
  type LoopVoice,
} from '../../long-take/beat-loop.service'
import type { LongTakeService } from '../../long-take/long-take.service'
import { buildLongTakeRequestUser } from '../../long-take/long-take-helpers.util'
import { generateLongTakeScriptPreview } from '../../long-take/long-take-script'
import type { MusicService } from '../../music/music.service'
import {
  AgentFlowCancelledError,
  type AgentSessionService,
  type AutonomousRunner,
  type QuietTurnOptions,
} from '../agent-session.service'
import type { AgentProjects } from '../codex-llm/codex-projects'
import { KEEP_LOOP_LABEL, MAKE_LOOP_LABEL } from '../craft/beat-loop-skill'
import { ATTENTION_HOOK_INFO } from '../craft/opening-craft'
import { projectFolder } from '../edit/project-folder'
import { failureReason, waitForWorkflow, wasStopped } from '../workflow-outcome'

import {
  type Brief,
  BRIEF_SCHEMA,
  BriefSchema,
  FIGURE_KINDS,
  FUN_FACT_TOPICS,
  type Idea,
  IDEA_SOURCES,
  IDEAS_PROMPT,
  IDEAS_SCHEMA,
  IdeasSchema,
  type IdeaVariety,
  MAX_AVOIDED_IDEAS,
  type Opening,
  OPENINGS_PROMPT,
  OPENINGS_SCHEMA,
  OpeningsSchema,
  type PastIdea,
  POLISH_PROMPT,
  SOURCE_TAGS,
  staleRecentNews,
  STORY_LENGTH_DESCRIPTIONS,
  STORY_LENGTH_INFO,
  STORY_LENGTHS,
} from './autonomous-prompts'
import {
  BEAT_LOOP_CAMERA_INFO,
  BEAT_LOOP_CAMERA_LABELS,
  BEAT_LOOP_CAMERA_OPTION,
  BEAT_LOOP_MUSIC_INFO,
  BEAT_LOOP_STORYBOARD_SCHEMA,
  beatLoopWriterPrompt,
  EASY_LOOP_LENGTHS,
  hookAsFirstLine,
  LOOP_LENGTH_DESCRIPTIONS,
  LOOP_LENGTH_INFO,
  LOOP_WRITE_ROUNDS,
} from './beat-loop-prompt'
import { findStoryStyle, type StoryStyle } from './story-styles'

/** Thrown by `chooseStyle` when the session isn't waiting for a style. */
export class StyleNotRequestedError extends Error {
  constructor(readonly sessionId: string) {
    super('This session is not waiting for a style')
    this.name = 'StyleNotRequestedError'
  }
}

/** Thrown by `chooseStyle` for a style id that isn't in the preset catalog. */
export class UnknownStyleError extends Error {
  constructor(readonly styleId: string) {
    super(`Unknown style ${JSON.stringify(styleId)}`)
    this.name = 'UnknownStyleError'
  }
}

/** What the flow needs from `AgentSessionService`. */
export interface AutonomousDeps {
  agentProjects: Pick<AgentProjects, 'add'>
  /** A loop of N clips on the model that will make it (default: `beatLoopEstimate`). */
  estimateLoop?: (clips: number) => BeatLoopEstimate
  findStyle?: (id: string) => null | StoryStyle
  /** `assertCanStart` refuses before a project or a script exists when nothing can make the
   *  video; `checkBeatLoopLines` says a loop's lines in its voice before its card. */
  longTake: Pick<
    LongTakeService,
    'assertCanStart' | 'checkBeatLoopLines' | 'createBgmVersion' | 'startBeatLoop' | 'startWorkflow'
  >
  /** The music library and the user's tracks for the music card (absent: presets only). */
  music?: Pick<MusicService, 'catalog'>
  now?: () => Date
  /** A preset pack file -> its address, served as a URL on the way out (default: `presetPackUri`). */
  presetPackUri?: (key: string) => string
  projects: {
    createProject: (
      body: ProjectCreateRequestBody,
      options?: { agentSessionId?: string },
    ) => Promise<{ id: string }>
  }
  /** Draws this search's fun-fact topic and kind of famous figure (default `Math.random`). */
  random?: () => number
  sessions: AutonomousSessions
  /** Who the video is made for (default: the request's user, as `POST /long-take-videos`). */
  user?: () => UserInfo
  /** Resolves when a loop's run finishes, rejects when it fails (default: the engine's handle). */
  waitForWorkflow?: (workflowId: string) => Promise<unknown>
  /** The brief -> the voice-over script, as the composer's script preview writes it. */
  writeScript?: (params: ScriptParams) => Promise<string>
}

export type AutonomousSessions = Pick<
  AgentSessionService,
  | 'askServerQuestion'
  | 'emitAutonomousEvent'
  | 'emitMessage'
  | 'emitNotice'
  | 'endAutonomousFlow'
  | 'events'
  | 'expireServerQuestion'
  | 'getSession'
  | 'isFlowCancelled'
  | 'linkProject'
  | 'notifyAgent'
  | 'pastQuestions'
  | 'recordAutonomous'
  | 'runQuietTurn'
  | 'setFlowWorking'
  | 'titleChat'
>

interface ScriptParams {
  brief: string
  durationSeconds: number
  /** The chosen opening hook: the script's exact first sentence. */
  opening?: string
  projectId: string
  userId: string
}

/** Per-session flow state (in memory: a restart ends every flow, as it does Codex's turns). */
interface Flow {
  /** The open "Make this loop?" card: what it asks and says, and its id (an older card is out
   *  of date). */
  loopCard?: { asks: string; questionId: string }
  /** The look an Easy loop was picked in (else the storyboard's own style). */
  loopStyle?: StoryStyle
  /** The voice a loop short's lines were said in (the run says them in it); else the brief's. */
  loopVoice?: string
  /** The project a video start created, reused when the start is tried again. */
  projectId?: string
  /** Picked up on a "Try again" card: it is asked again before its step runs again. */
  retryFirst?: boolean
  /** Numbers the flow's question ids, so each card is unique in the session. */
  seq: number
  /** `style_request` was emitted and no style has been chosen since. */
  styleRequested: boolean
}

/** Easy's cards, by the middle of their question id (`autonomous-<kind>-<n>`). */
type CardKind = 'camera' | 'idea' | 'length' | 'loop' | 'music' | 'opening' | 'retry' | 'track'
const EASY_CARD_ID = /^autonomous-(camera|idea|length|loop|music|opening|retry|track)-(\d+)$/

/** An Easy card the chat already shows: what it asked, and its answers once answered (an
 *  unanswered one was open when the flow was cut off). */
interface RecordedCard {
  answers?: AgentAnswers
  questions: AgentQuestion[]
}

/**
 * Where an interrupted Easy flow got to, read back from its chat (each card's answer, as the
 * storyboard panel reads them) and its session (what its steps made). A new flow has nothing.
 */
interface Recorded {
  /** The brief so far: written once the idea was picked, then each answer added to it. */
  brief?: AgentAutonomousBrief
  /** The latest card of each kind. */
  cards: Partial<Record<CardKind, RecordedCard>>
  /** What the idea and attention-hook cards offered (with what the cards don't show). */
  ideas?: Idea[]
  /** The highest loop card number (they number apart from the others). */
  loopCards: number
  openings?: Opening[]
  /** The project the video start made. */
  projectId?: string
  /** The flow stopped on a "Try again" card. */
  retryOpen: boolean
  /** The highest card number: new cards number on from it. */
  seq: number
  /** The style picked in the style picker, or `requested` while it was open. */
  style?: 'requested' | { id: string }
}

const NEW_FLOW: Recorded = { cards: {}, loopCards: 0, retryOpen: false, seq: 0 }

export const IDEAS_INTRO = "Let's find you an idea. I'm checking today's news and some fun facts…"
/** Said when an interrupted Easy flow carries on ("Pick up where you left off"). */
export const RESUME_MESSAGE = 'Picking up where you left off.'
/** What `make_beat_loop` tells the agent the user does next, by the card's real buttons (an
 *  agent left to guess says "click Confirm", and there is no such button). */
const LOOP_CARD_NEXT = `A card in the chat now shows the user the length and the cost, with two buttons: "${MAKE_LOOP_LABEL}" and "${KEEP_LOOP_LABEL}". Nothing is made or spent until the user clicks "${MAKE_LOOP_LABEL}" there (typing "${MAKE_LOOP_LABEL}" in the chat does the same). Tell them that, in those words; the card has no other button.`
const LOOP_STYLE_NEXT =
  "ReelMakeEasy's style picker is open in the chat: the loop starts as soon as the user picks a look there, with no other card."
const LOOP_CARD_UPDATED = 'The storyboard was updated; the card is still open.'
/** Easy's notice (after "Couldn't write the loop: ") when the voice can't say the lines. */
const EASY_LINES_UNSAID =
  "the voice couldn't read its lines aloud to check they fit. Try again in a moment, or check your keys on the Setup page."
const STYLE_CARD_UPDATED = 'The storyboard was updated; the style card is still open.'
const RATIO = '9:16'
/** Marks the project's runs as made by an agent harness (a record of intent: `AgentProjects`
 *  does the routing). `LLMModelSettings` is typed as a model-switch map, which this isn't. */
const agentDebugSettings = (harness: AgentHarnessName): DebugSettings =>
  ({ llm: { chatProvider: harness } }) as unknown as DebugSettings

/**
 * Autonomous mode: ReelMakeEasy, not Codex, drives the steps.
 * 1. ideas (a quiet web-search turn) -> 2. the user picks one (a server question card) ->
 * 3. a polished brief (a quiet turn) -> 4. `style_request`; the flow then waits for
 * 5. `chooseStyle` (`POST /api/agent/sessions/:id/style`), which starts the long-take video on
 * Codex. A failed step offers "Try again"; the user stopping the session ends the flow quietly.
 */
export class AutonomousService implements AutonomousRunner {
  private readonly flows = new Map<string, Flow>()
  private readonly logger = new Logger(AutonomousService.name)
  /** "Make this loop?" cards asked per session, so each gets an id of its own. */
  private readonly loopCards = new Map<string, number>()

  constructor(private readonly deps: AutonomousDeps) {}

  /** Stop (via `AgentSessionService.interrupt`): a flow only waiting for its style ends now.
   *  Work in flight stops at its next step instead (`isFlowCancelled`). */
  cancel(sessionId: string): void {
    const flow = this.flows.get(sessionId)
    if (!flow?.styleRequested) return
    flow.styleRequested = false
    this.endCancelled(sessionId, true)
  }

  /** Takes the session's pending style request (throws `StyleNotRequestedError` /
   *  `UnknownStyleError`), shows the choice, then starts the video detached: the route answers at
   *  once, and a start failure is offered again through a "Try again" card. */
  async chooseStyle(sessionId: string, styleId: string): Promise<void> {
    const flow = this.flows.get(sessionId)
    if (!flow?.styleRequested) throw new StyleNotRequestedError(sessionId)
    const style = (this.deps.findStyle ?? findStoryStyle)(styleId)
    if (!style) throw new UnknownStyleError(styleId)
    // Read in the request (its context names the user), before anything is detached - and
    // before the request is used up, so a failure here leaves the picker usable.
    const user = (this.deps.user ?? buildLongTakeRequestUser)()
    // Easy's loop: priced now (a failure leaves the picker usable), asked before it is made.
    const loop = this.easyLoopBrief(sessionId)
    const estimate = loop
      ? (this.deps.estimateLoop ?? beatLoopEstimate)(loop.storyboard.clips.length)
      : undefined
    flow.styleRequested = false
    this.deps.sessions.emitAutonomousEvent(sessionId, {
      styleId: style.id,
      styleName: style.label,
      ...(style.thumbnailUrl ? { thumbnailUrl: style.thumbnailUrl } : {}),
      type: 'style_chosen',
    })
    if (loop && estimate) {
      this.askToMakeLoop(sessionId, loop, estimate, loop.voice, user, style)
      return
    }
    void this.makeVideo(sessionId, flow, style, user).catch((error: unknown) => {
      this.logger.error(`Autonomous video for ${sessionId} failed: ${ensureError(error).message}`)
      this.finish(sessionId)
    })
  }

  /**
   * `make_beat_loop` (Free chat): checks the storyboard (every issue at once), then says
   * every narration line in the loop's voice (the one named, else a free local voice when one
   * is installed) and measures it: a line too long for its clip even at 1.3x comes back as an
   * issue, with how long it took, the speed it would need and what to aim for, and nothing is
   * asked. The run reuses those lines. Then it records the storyboard as the brief
   * (`format: 'beat_loop'`) and asks before anything is spent on clips: a storyboard with a
   * style gets a "Make this 24-second loop? About $1.20" card naming the voice; one without
   * opens the preset style picker. Either answer starts the loop through the same video start
   * as Easy, with its "Try again" card, in the voice the lines were said in.
   */
  async makeBeatLoop(
    sessionId: string,
    args: { storyboard: unknown; title?: string; voice?: string },
  ): Promise<MakeBeatLoopResult> {
    const result = validateBeatLoopStoryboard(args.storyboard)
    if (!result.ok) {
      return {
        format: 'beat_loop',
        issues: result.issues,
        status: 'invalid',
        warnings: result.warnings,
      }
    }
    // Read now, while the tool call's context names the user: the card's answer comes later.
    const user = (this.deps.user ?? buildLongTakeRequestUser)()
    const title = args.title?.trim() || result.storyboard.title
    const storyboard: BeatLoopStoryboard = { ...result.storyboard, title }
    const estimate = (this.deps.estimateLoop ?? beatLoopEstimate)(storyboard.clips.length)
    // Nothing can make the video: say so before any line is said (a paid voice costs).
    this.deps.longTake.assertCanStart()
    const check = await this.sayLoopLines(
      sessionId,
      storyboard,
      user,
      args.voice?.trim() || undefined,
    )
    const tooLong = check.lines.filter((line) => !line.fits)
    if (tooLong.length) {
      return {
        format: 'beat_loop',
        issues: tooLong.map((line) =>
          lineTooLongIssue({
            clipId: line.clipId,
            clipIndex: line.clipIndex,
            narration: line.narration,
            seconds: line.seconds,
            voice: check.voice.name,
          }),
        ),
        status: 'invalid',
        tooLong: tooLong.map((line) => ({
          clipId: line.clipId,
          narration: line.narration,
          speedNeeded: Math.round(line.tempo * 100) / 100,
          spokenSeconds: Math.round(line.seconds * 10) / 10,
          target: narrationTarget(line.narration, line.seconds),
        })),
        voice: check.voice,
        warnings: result.warnings,
      }
    }
    const brief: AgentAutonomousBrief = {
      brief: title,
      durationSeconds: storyboard.duration_s,
      format: 'beat_loop',
      storyboard,
      title,
    }
    const { voice } = check
    this.showBrief(sessionId, brief)
    const answer = {
      clipUsd: estimate.clipUsd,
      clips: storyboard.clips.length,
      durationSeconds: storyboard.duration_s,
      estimatedCostUsd: estimate.totalUsd,
      ...(estimate.fallback
        ? {
            fallback: {
              clipUsd: estimate.fallback.clipUsd,
              model: estimate.fallback.modelLabel,
            },
          }
        : {}),
      format: 'beat_loop' as const,
      model: estimate.modelLabel,
      voice,
      warnings: result.warnings,
    }
    if (!storyboard.style?.trim()) {
      const replaced = this.requestStyle(sessionId, brief)
      const flow = this.flows.get(sessionId)
      if (flow) flow.loopVoice = voice.id
      return {
        ...answer,
        next: LOOP_STYLE_NEXT,
        ...(replaced ? { note: STYLE_CARD_UPDATED } : {}),
        status: 'waiting_for_style',
      }
    }
    const kept = this.askToMakeLoop(sessionId, brief, estimate, voice, user)
    return {
      ...answer,
      card: {
        buttons: [MAKE_LOOP_LABEL, KEEP_LOOP_LABEL],
        question: loopCardQuestion(brief.durationSeconds, estimate, voice).question,
      },
      next: LOOP_CARD_NEXT,
      ...(kept ? { note: LOOP_CARD_UPDATED } : {}),
      status: 'waiting_for_make_it',
    }
  }

  /** `make_video` (Free chat): records the brief and opens the style picker; the pick runs
   *  the same video start as Easy. While a card is open, a new brief replaces the recorded
   *  one (the user changed the script) and the card stays; returns true in that case. */
  requestStyle(sessionId: string, brief: AgentAutonomousBrief): boolean {
    const existing = this.flows.get(sessionId)
    this.deps.sessions.recordAutonomous(sessionId, { autonomous: brief })
    // make_beat_loop has shown its own; a story video's replaces a loop's lines.
    if (brief.format !== 'beat_loop') this.showBrief(sessionId, brief)
    if (existing?.styleRequested) return true
    this.flows.set(sessionId, { seq: existing?.seq ?? 0, styleRequested: true })
    // The picker replaces an open "Make this loop?" card: it expires.
    if (existing?.loopCard) {
      this.deps.sessions.expireServerQuestion(sessionId, existing.loopCard.questionId)
    }
    this.deps.sessions.emitAutonomousEvent(sessionId, { type: 'style_request' })
    return false
  }

  /**
   * "Pick up where you left off": carries on an Easy flow a restart cut off from its first
   * unanswered step, as if it had never stopped. Every answer its chat shows is kept and
   * nothing it made is made again: no new idea search once ideas were offered, and the same
   * brief, openers, loop lines and voice, script and project. The card that was open (or its
   * "Try again" card) is asked again, fresh. A style already picked carries on to the video
   * start, except that a loop's "Make this loop?" card is shown again until the user answers
   * "Make it". `AgentSessionService.resumeFlow` has claimed the flow and shows the working
   * state, which ends here. Resolves like `start`.
   */
  async resume(sessionId: string): Promise<void> {
    const recorded = this.recorded(sessionId)
    this.deps.sessions.setFlowWorking(sessionId, false)
    await this.run(sessionId, recorded)
  }

  /**
   * What `resume` will do for this chat, read the way `resume` reads where the flow got to,
   * so its "Pick up where you left off" button can say so before the click. It starts a run at
   * once only with the style picked and no "Try again" card open: a story video's start
   * (`start_video`), or a loop whose card was answered "Make it" (`make_loop`, at the price that
   * card showed: never priced again). Anything else asks a card first (`carry_on`).
   */
  resumeAction(sessionId: string): AgentResumeAction {
    const recorded = this.recorded(sessionId)
    if (recorded.retryOpen || !this.pickedStyle(recorded)) return { kind: 'carry_on' }
    if (!this.easyLoopBrief(sessionId)) return { kind: 'start_video' }
    const card = recorded.cards.loop
    if (!card || !saidMakeIt(card)) return { kind: 'carry_on' }
    const costUsd = loopCardPrice(card.questions)
    return { kind: 'make_loop', ...(costUsd === null ? {} : { costUsd }) }
  }

  /** Runs steps 1-4. Resolves once the style is requested (or the user stopped the flow). */
  async start(sessionId: string): Promise<void> {
    await this.run(sessionId, NEW_FLOW)
  }

  /**
   * The music picked for an Easy loop, once its run has delivered it: a bed made (or a track
   * fitted) and mixed under the loop's own sound, as `set_music` does, then the chat plays the
   * new file. A failure only says so: the loop itself is done.
   */
  private async addLoopMusic(
    sessionId: string,
    projectId: string,
    music: ReturnType<typeof resolveMusicRequest>,
    user: UserInfo,
  ): Promise<void> {
    const { longTake, sessions } = this.deps
    try {
      const body =
        music.bgmTrackId && music.bgmSource && music.bgmSource !== 'generated'
          ? { track: { id: music.bgmTrackId, source: music.bgmSource } }
          : { note: music.bgmNote }
      const { workflowId } = await longTake.createBgmVersion(projectId, body, user)
      await (this.deps.waitForWorkflow ?? waitForWorkflow)(workflowId)
      sessions.emitAutonomousEvent(sessionId, { projectId, type: 'video_rendered' })
    } catch (error) {
      this.logger.warn(`Music for the loop of ${sessionId} failed: ${failureReason(error)}`)
      sessions.emitNotice(
        sessionId,
        "Your loop is ready, but its music couldn't be added. Ask for music in the chat to try again.",
      )
    }
  }

  /** A card's answers: the user's, on the card asked now as `autonomous-<kind>-<n>`; or, for a
   *  flow picked up after a restart, the answers its chat already shows for `card`. */
  private async answersTo(
    sessionId: string,
    flow: Flow,
    kind: CardKind,
    questions: AgentQuestion[],
    card: RecordedCard | undefined,
  ): Promise<AgentAnswers> {
    if (card?.answers) return card.answers
    return this.deps.sessions.askServerQuestion(
      sessionId,
      `autonomous-${kind}-${++flow.seq}`,
      questions,
    )
  }

  /** Asks "Try again?" after a failed step; resolves when the user says so. */
  private async askRetry(sessionId: string, flow: Flow): Promise<void> {
    const question: AgentQuestion = {
      header: 'Try again',
      id: 'retry',
      isOther: false,
      isSecret: false,
      options: [{ description: '', label: 'Try again' }],
      question: 'Want to try that again?',
    }
    await this.deps.sessions.askServerQuestion(sessionId, `autonomous-retry-${++flow.seq}`, [
      question,
    ])
  }

  /**
   * Shows the "Make this loop?" card for a storyboard that has its own style. While a card is
   * open, a new storyboard replaces the recorded one: the card stays when it would ask and say
   * the same (returns true), else a new card replaces it and the old one is out of date. The
   * card closes an open style picker. Easy asks it after its style pick (`style`): the loop
   * is made in that look. No `voice`: a loop from before its voice was kept, which the run
   * says in the loop's own voice, as its lines were said.
   */
  private askToMakeLoop(
    sessionId: string,
    brief: AgentAutonomousBrief,
    estimate: BeatLoopEstimate,
    voice: LoopVoice | undefined,
    user: UserInfo,
    style?: StoryStyle,
  ): boolean {
    const question = loopCardQuestion(
      brief.durationSeconds,
      estimate,
      voice,
      style ? { styleLabel: style.label } : undefined,
    )
    const asks = cardText(question)
    const existing = this.flows.get(sessionId)
    this.deps.sessions.recordAutonomous(sessionId, { autonomous: brief })
    if (existing?.loopCard?.asks === asks) {
      existing.loopVoice = voice?.id
      return true
    }
    const flow: Flow = {
      ...(style ? { loopStyle: style } : {}),
      ...(voice ? { loopVoice: voice.id } : {}),
      seq: existing?.seq ?? 0,
      styleRequested: false,
    }
    // Numbered per session, past the end of any flow, so a new card never takes an old id.
    const count = (this.loopCards.get(sessionId) ?? 0) + 1
    this.loopCards.set(sessionId, count)
    const questionId = `autonomous-loop-${count}`
    flow.loopCard = { asks, questionId }
    this.flows.set(sessionId, flow)
    // The card it replaces is out of date: it expires, and answering it does nothing.
    if (existing?.loopCard) {
      this.deps.sessions.expireServerQuestion(sessionId, existing.loopCard.questionId)
    }
    void this.deps.sessions.askServerQuestion(sessionId, questionId, [question]).then(
      (answers) => this.onLoopAnswer(sessionId, questionId, answers, user),
      (error: unknown) => {
        if (this.flows.get(sessionId)?.loopCard?.questionId !== questionId) return
        if (error instanceof AgentFlowCancelledError) return this.endCancelled(sessionId)
        this.logger.error(`Loop card for ${sessionId} failed: ${ensureError(error).message}`)
        this.finish(sessionId)
      },
    )
    return false
  }

  /** The sample clip and poster the camera card shows on an option, from the preset pack. The
   *  card is kept in the chat's transcript, so it holds the files' addresses: their URLs are
   *  built as it is sent to the browser. */
  private cameraSample(id: CameraSampleId): AgentOptionSample {
    const uri = this.deps.presetPackUri ?? presetPackUri
    return {
      posterUrl: uri(CAMERA_SAMPLES[id].poster),
      videoUrl: uri(CAMERA_SAMPLES[id].video),
    }
  }

  /**
   * Picking up after the style was picked: the video start carries on (asking its "Try again"
   * card first when that was open). A loop's "Make this loop?" card is shown again instead,
   * unless the chat shows it answered "Make it": nothing is spent until the user says so.
   */
  private carryOnWithStyle(
    sessionId: string,
    flow: Flow,
    style: StoryStyle,
    loopCard: RecordedCard | undefined,
  ): void {
    const user = (this.deps.user ?? buildLongTakeRequestUser)()
    const loop = this.easyLoopBrief(sessionId)
    if (loop) {
      if (!saidMakeIt(loopCard)) {
        const estimate = (this.deps.estimateLoop ?? beatLoopEstimate)(loop.storyboard.clips.length)
        this.askToMakeLoop(sessionId, loop, estimate, loop.voice, user, style)
        return
      }
      flow.loopStyle = style
    }
    void this.makeVideo(sessionId, flow, style, user).catch((error: unknown) => {
      this.logger.error(`Autonomous video for ${sessionId} failed: ${ensureError(error).message}`)
      this.finish(sessionId)
    })
  }

  /** The attention-hook card's three openers (a quiet turn), kept with the session. */
  private async draftOpenings(
    sessionId: string,
    flow: Flow,
    brief: Pick<Brief, 'brief' | 'title'>,
  ): Promise<Opening[]> {
    const { openings } = await this.step(sessionId, flow, 'draft openings', () =>
      this.quietJson(sessionId, OPENINGS_PROMPT(brief), OpeningsSchema, {
        effort: 'medium',
        outputSchema: OPENINGS_SCHEMA,
      }),
    )
    this.recordProgress(sessionId, { openings })
    return openings
  }

  /** Easy's loop short: the one written (and said) before a restart, kept as it is, with its
   *  voice (none for a loop from before the voice was kept: nothing is said again just to
   *  name it); else written now (`writeEasyLoop`). */
  private async easyLoop(
    sessionId: string,
    flow: Flow,
    kept: AgentAutonomousBrief | undefined,
    input: Brief & { opening: string; seconds: BeatLoopLength },
  ): Promise<AgentAutonomousBrief> {
    if (kept?.format === 'beat_loop' && kept.storyboard) return kept
    return this.writeEasyLoop(sessionId, flow, input, input.opening, input.seconds)
  }

  /**
   * Easy's own loop short (its brief is a loop, in an Easy chat that isn't editing; not a loop
   * a chat's agent asked for): nothing is made until its "Make this loop?" card says "Make it".
   * Read from the brief, not from the camera card's answer, so a loop picked up after a
   * restart, whatever its card called the option, is asked too.
   */
  private easyLoopBrief(
    sessionId: string,
  ): (AgentAutonomousBrief & { storyboard: BeatLoopStoryboard }) | undefined {
    const session = this.deps.sessions.getSession(sessionId)
    const brief = session.autonomous
    if (session.mode !== 'autonomous' || session.editing) return undefined
    if (brief?.format !== 'beat_loop' || !brief.storyboard) return undefined
    return { ...brief, storyboard: brief.storyboard }
  }

  /** The flow ended by cancellation. When the user stopped it (`byUser`, by default whether
   *  the session says so; a shutdown is not the user), says so once with `flow_cancelled`,
   *  which expires an open style card; then ends it. Every cancel path comes here exactly once:
   *  `cancel` only acts while the style is requested, when no step is in flight, and the flow
   *  is forgotten as it ends. */
  private endCancelled(
    sessionId: string,
    byUser = this.deps.sessions.isFlowCancelled(sessionId),
  ): void {
    if (byUser && this.flows.has(sessionId))
      this.deps.sessions.emitAutonomousEvent(sessionId, { type: 'flow_cancelled' })
    this.finish(sessionId)
  }

  /** Step 1: three ideas (a quiet web-search turn), kept with the session so a flow picked up
   *  after a restart offers the same ones without searching again. */
  private async findIdeas(sessionId: string, flow: Flow): Promise<Idea[]> {
    const today = (this.deps.now ?? (() => new Date()))().toISOString().slice(0, 10)
    const { ideas } = await this.step(sessionId, flow, 'find ideas', () =>
      this.quietJson(sessionId, IDEAS_PROMPT(today, this.ideaVariety()), IdeasSchema, {
        effort: 'medium',
        outputSchema: IDEAS_SCHEMA,
      }).then((result) => {
        // Old findings re-shared as news get a retry, not a card.
        const stale = staleRecentNews(result.ideas, today)
        if (stale) throw new Error(stale)
        return result
      }),
    )
    this.recordProgress(sessionId, { ideas })
    return ideas
  }

  /** The flow is over (video started, or stopped): forget it and lift the chat lock. */
  private finish(sessionId: string): void {
    this.flows.delete(sessionId)
    this.deps.sessions.endAutonomousFlow(sessionId)
  }

  /** This search's variety: the ideas earlier chats offered (to avoid), and a random
   *  fun-fact topic and kind of famous figure, so searches don't settle on the same picks. */
  private ideaVariety(): IdeaVariety {
    const random = this.deps.random ?? Math.random
    const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length) % list.length]
    return {
      avoid: pastIdeas(this.deps.sessions.pastQuestions('Idea')),
      figureKind: pick(FIGURE_KINDS),
      funFactTopic: pick(FUN_FACT_TOPICS),
    }
  }

  /** What a clip made again costs (for the failure note); null when the registry can't say. */
  private loopClipUsd(): null | number {
    try {
      return (this.deps.estimateLoop ?? beatLoopEstimate)(1).clipUsd
    } catch {
      return null
    }
  }

  /** The video start (step 5), with a "Try again" card after a failure, until it starts or the
   *  user stops the session. A flow picked up on that card asks it again first. */
  private async makeVideo(
    sessionId: string,
    flow: Flow,
    style: StoryStyle,
    user: UserInfo,
  ): Promise<void> {
    const { sessions } = this.deps
    try {
      await this.retryFirst(sessionId, flow)
    } catch (error) {
      if (error instanceof AgentFlowCancelledError) return this.endCancelled(sessionId)
      throw error
    }
    for (;;) {
      // Writing the script and starting the video take 10-30 s outside any Codex turn.
      sessions.setFlowWorking(sessionId, true)
      try {
        const projectId = await this.startVideo(sessionId, flow, style, user)
        sessions.emitAutonomousEvent(sessionId, { projectId, type: 'video_started' })
        sessions.emitMessage(sessionId, VIDEO_STARTED_MESSAGE)
        sessions.recordAutonomous(sessionId, { projectId })
        // Edit mode reads the finished video's files through this link.
        sessions.linkProject(sessionId, projectFolder(projectId))
        sessions.setFlowWorking(sessionId, false)
        return this.finish(sessionId)
      } catch (error) {
        sessions.setFlowWorking(sessionId, false)
        if (error instanceof AgentFlowCancelledError) return this.endCancelled(sessionId)
        sessions.emitNotice(sessionId, `Couldn't start the video: ${ensureError(error).message}`)
      }
      try {
        await this.askRetry(sessionId, flow)
      } catch (error) {
        if (error instanceof AgentFlowCancelledError) return this.endCancelled(sessionId)
        throw error
      }
    }
  }

  /** The library and the user's tracks for the cards; none when the session has no music service. */
  private async musicCatalog(): Promise<MusicCatalog> {
    if (!this.deps.music) return { library: [], mine: [] }
    try {
      return await this.deps.music.catalog((this.deps.user ?? buildLongTakeRequestUser)().userId)
    } catch {
      return { library: [], mine: [] }
    }
  }

  /** The "Make this loop?" card's answer: "Make it" starts the loop in the storyboard's style
   *  (detached, with a "Try again" card after a failure); anything else makes nothing. An
   *  answer to a card a newer storyboard replaced makes nothing either. */
  private onLoopAnswer(
    sessionId: string,
    questionId: string,
    answers: Record<string, string[]>,
    user: UserInfo,
  ): void {
    const flow = this.flows.get(sessionId)
    if (flow?.loopCard?.questionId !== questionId) {
      this.deps.sessions.emitNotice(sessionId, 'That card is out of date: answer the newest one.')
      return
    }
    flow.loopCard = undefined
    if ((answers['make'] ?? [])[0]?.trim() !== MAKE_LOOP_LABEL) {
      this.deps.sessions.emitNotice(sessionId, 'The loop was not made.')
      return this.finish(sessionId)
    }
    const style =
      flow.loopStyle ??
      storyboardStyle(this.deps.sessions.getSession(sessionId).autonomous?.storyboard)
    void this.makeVideo(sessionId, flow, style, user).catch((error: unknown) => {
      this.logger.error(`Loop short for ${sessionId} failed: ${ensureError(error).message}`)
      this.finish(sessionId)
    })
  }

  /** The camera style card: Dynamic or Calm, with no recommendation, then a beat loop (a loop
   *  short instead of a story video). `card`: the one the chat shows (picking up). */
  private async pickCamera(
    sessionId: string,
    flow: Flow,
    card?: RecordedCard,
  ): Promise<'beat_loop' | CameraStyle> {
    const styles: CameraStyle[] = ['dynamic', 'calm']
    const answers = await this.answersTo(
      sessionId,
      flow,
      'camera',
      [
        {
          header: CAMERA_STYLE_HEADER,
          id: 'camera',
          info: `${CAMERA_STYLE_INFO} ${BEAT_LOOP_CAMERA_INFO}`,
          isOther: false,
          isSecret: false,
          options: [
            ...styles.map((s) => ({
              description: CAMERA_STYLE_OPTIONS[s].description,
              label: CAMERA_STYLE_OPTIONS[s].label,
              sample: this.cameraSample(s),
            })),
            { ...BEAT_LOOP_CAMERA_OPTION, sample: this.cameraSample('beat-loop') },
          ],
          question: 'How should the camera move?',
        },
      ],
      card,
    )
    const answer = (answers['camera'] ?? [])[0]?.trim() ?? ''
    if (BEAT_LOOP_CAMERA_LABELS.includes(answer)) return 'beat_loop'
    return styles.find((s) => CAMERA_STYLE_OPTIONS[s].label === answer) ?? 'calm'
  }

  /** The style an interrupted flow's picker was answered with (null while it was open, or for
   *  a style no longer offered: the picker opens again). */
  private pickedStyle(recorded: Recorded): null | StoryStyle {
    if (!recorded.style || recorded.style === 'requested') return null
    return (this.deps.findStyle ?? findStoryStyle)(recorded.style.id)
  }

  /** Shows the ideas as a choice card (or takes the answer the chat shows for `card`); returns
   *  the idea to polish: the full idea for a picked option, or the user's own text. */
  private async pickIdea(
    sessionId: string,
    flow: Flow,
    ideas: Idea[],
    card?: RecordedCard,
  ): Promise<string> {
    // The card the chat showed, as it was (its options are these ideas, in order).
    const questions = card?.questions ?? [
      {
        header: 'Idea',
        id: 'idea',
        isOther: true,
        isSecret: false,
        options: ideas.map((idea, i) => ({
          // The date (`when`) stays out of the card: it is for the fact check, not the viewer.
          description: plainText(idea.hook),
          label: `${SOURCE_TAGS[idea.source]}: ${plainText(idea.title)}${i === 0 ? ' (Recommended)' : ''}`,
        })),
        question: 'Which idea should we make?',
      },
    ]
    const options = questions[0]?.options ?? []
    const answers = await this.answersTo(sessionId, flow, 'idea', questions, card)
    const picked = (answers['idea'] ?? [])
      .map((answer) => {
        const i = options.findIndex((o) => o.label === answer)
        const idea = ideas[i]
        if (i === -1 || !idea) return answer
        const label = splitRecommended(options[i].label).text
        // An idea read back from an older chat's card has no date or source.
        const when = idea.when ? ` (When: ${plainText(idea.when)})` : ''
        const url = idea.sourceUrl ? ` (Source: ${idea.sourceUrl})` : ''
        return `${label}. ${plainText(idea.hook)}${when}${url}`
      })
      .join('\n')
    const first = (answers['idea'] ?? [])[0]?.trim()
    if (first) {
      const i = options.findIndex((o) => o.label === first)
      const idea = ideas[i]
      this.deps.sessions.titleChat(sessionId, idea ? plainText(idea.title) : first)
    }
    return picked
  }

  /** The length card, right after the camera card: a story video's lengths (30, 45, 60 s) or
   *  a loop's (24, 28, 32 s), the first recommended. Returns the length picked (the first when
   *  the answer is none of them). */
  private async pickLength<L extends number>(
    sessionId: string,
    flow: Flow,
    spec: { descriptions: Record<L, string>; info: string; lengths: readonly L[] },
    card?: RecordedCard,
  ): Promise<L> {
    const { descriptions, info, lengths } = spec
    const label = (seconds: number) => `${seconds} seconds`
    const answers = await this.answersTo(
      sessionId,
      flow,
      'length',
      [
        {
          header: LENGTH_HEADER,
          id: 'length',
          info,
          isOther: false,
          isSecret: false,
          options: lengths.map((seconds, i) => ({
            description: descriptions[seconds],
            label: `${label(seconds)}${i === 0 ? ' (Recommended)' : ''}`,
          })),
          question: 'How long should the video be?',
        },
      ],
      card,
    )
    const answer = splitRecommended((answers['length'] ?? [])[0]?.trim() ?? '').text
    return lengths.find((seconds) => label(seconds) === answer) ?? lengths[0]
  }

  /**
   * The music card: a preset mood (Pick for me recommended), the library, the user's own
   * tracks (when they have any), no music, or their own words. The library and "My music"
   * ask a second card with the tracks; a title typed on either card picks that track. A
   * loop's card leads with No music (recommended): its clips carry their own sound. `cards`:
   * the music and track cards the chat shows (picking up).
   */
  private async pickMusic(
    sessionId: string,
    flow: Flow,
    opts: { loop?: boolean } = {},
    cards: Pick<Recorded['cards'], 'music' | 'track'> = {},
  ): Promise<MusicRequest> {
    const catalog = await this.musicCatalog()
    const presets = MUSIC_CHOICES.filter((c) => c !== 'off').map((choice, i) => ({
      description: MUSIC_CHOICE_OPTIONS[choice].description,
      label: `${MUSIC_CHOICE_OPTIONS[choice].label}${i === 0 && !opts.loop ? ' (Recommended)' : ''}`,
    }))
    const off = {
      description: MUSIC_CHOICE_OPTIONS.off.description,
      label: `${MUSIC_CHOICE_OPTIONS.off.label}${opts.loop ? ' (Recommended)' : ''}`,
    }
    const answers = await this.answersTo(
      sessionId,
      flow,
      'music',
      [
        {
          header: MUSIC_HEADER,
          id: 'music',
          info: opts.loop ? `${BEAT_LOOP_MUSIC_INFO} ${MUSIC_INFO}` : MUSIC_INFO,
          isOther: true,
          isSecret: false,
          options: [
            ...(opts.loop ? [off] : []),
            ...presets,
            ...(catalog.library.length > 0
              ? [
                  {
                    description: 'Pre-made tracks by mood, fitted to the video. No generation.',
                    label: MUSIC_LIBRARY_LABEL,
                  },
                ]
              : []),
            ...(catalog.mine.length > 0
              ? [
                  {
                    description: 'Your uploads and the music made for your videos.',
                    label: MUSIC_MINE_LABEL,
                  },
                ]
              : []),
            ...(opts.loop ? [] : [off]),
          ],
          question: 'Background music?',
        },
      ],
      cards.music,
    )
    const picked = ((answers['music'] ?? [])[0] ?? '').trim()
    const list =
      picked === MUSIC_LIBRARY_LABEL ? 'library' : picked === MUSIC_MINE_LABEL ? 'mine' : null
    // A label, a refusal ("no music"), a track title, or the user's own description.
    if (!list) return musicRequestFromText(picked, catalog)
    this.throwIfCancelled(sessionId)
    const options =
      list === 'library'
        ? catalog.library.map((t) => ({
            description: [t.mood, t.description].filter(Boolean).join(' · '),
            label: t.title,
          }))
        : catalog.mine.map((t) => ({ description: trackDescription(t), label: t.name }))
    const track = await this.answersTo(
      sessionId,
      flow,
      'track',
      [
        {
          header: MUSIC_HEADER,
          id: 'track',
          info: 'The track is trimmed to the video with a fade; nothing is generated.',
          isOther: true,
          isSecret: false,
          options,
          question: list === 'library' ? 'Which track?' : 'Which of your tracks?',
        },
      ],
      cards.track,
    )
    return musicRequestFromText(((track['track'] ?? [])[0] ?? '').trim(), catalog)
  }

  /** Drafts three openings for the brief (a quiet Codex turn, kept with the session) and asks
   *  which one the video starts with; returns the chosen first sentence, or the user's own.
   *  Picking up: the card the chat shows (`card`), answered or asked again, with the openings
   *  it offered (`kept`). */
  private async pickOpening(
    sessionId: string,
    flow: Flow,
    brief: Pick<Brief, 'brief' | 'title'>,
    card?: RecordedCard,
    kept?: Opening[],
  ): Promise<string> {
    const openings = card
      ? (kept ?? openingsFromCard(card.questions))
      : await this.draftOpenings(sessionId, flow, brief)
    this.throwIfCancelled(sessionId)
    const questions = card?.questions ?? [
      {
        header: ATTENTION_HOOK_HEADER,
        id: 'opening',
        info: ATTENTION_HOOK_INFO,
        isOther: true,
        isSecret: false,
        options: openings.map((opening: Opening, i) => ({
          description: plainText(opening.why),
          label: `${plainText(opening.style)}: ${plainText(opening.line)}${i === 0 ? ' (Recommended)' : ''}`,
        })),
        question: 'Pick a video opener for the attention hook',
      },
    ]
    const options = questions[0]?.options ?? []
    const answers = await this.answersTo(sessionId, flow, 'opening', questions, card)
    const answer = (answers['opening'] ?? [])[0]?.trim() ?? ''
    const opening = openings[options.findIndex((o) => o.label === answer)]
    if (opening) return plainText(opening.line)
    // The user's own first line, without quotes around it.
    return answer.replace(/^["'\u201C\u2018]+|["'\u201D\u2019]+$/g, '').trim()
  }

  /** One quiet turn whose answer must be JSON matching `schema`. */
  private async quietJson<T>(
    sessionId: string,
    prompt: string,
    schema: ZodType<T>,
    opts: QuietTurnOptions,
  ): Promise<T> {
    const text = await this.deps.sessions.runQuietTurn(sessionId, prompt, opts)
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error('Codex did not answer with JSON')
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success)
      throw new Error(parsed.error.issues[0]?.message ?? 'Codex gave an unexpected answer')
    return parsed.data
  }

  /** Adds to the Easy flow's brief, keeping what it already has (a flow picked up after a
   *  restart records its answers again: the script and loop recorded later stay). */
  private recordBrief(sessionId: string, fields: Partial<AgentAutonomousBrief>): void {
    const brief = this.deps.sessions.getSession(sessionId).autonomous
    if (!brief) throw new Error('The brief is missing')
    this.deps.sessions.recordAutonomous(sessionId, { autonomous: { ...brief, ...fields } })
  }

  /** Where an interrupted Easy flow got to: the cards its chat shows (the latest of each kind,
   *  answered or open when it was cut off) and its style step, with what the session kept. */
  private recorded(sessionId: string): Recorded {
    const { sessions } = this.deps
    const session = sessions.getSession(sessionId)
    const { entries } = sessions.events(sessionId).reduce(reduceTranscript, initialTranscript)
    const style = entries.findLast((e) => e.kind === 'style')
    const progress = session.easyProgress
    return {
      ...(session.autonomous ? { brief: session.autonomous } : {}),
      ...easyCards(entries),
      ...(progress?.ideas ? { ideas: progress.ideas } : {}),
      ...(progress?.openings ? { openings: progress.openings } : {}),
      ...(progress?.projectId ? { projectId: progress.projectId } : {}),
      ...(style?.kind === 'style'
        ? {
            style:
              style.state === 'chosen' && style.styleId
                ? { id: style.styleId }
                : ('requested' as const),
          }
        : {}),
    }
  }

  /** Keeps what the Easy flow made that its cards don't show (`easyProgress`), so a flow picked
   *  up after a restart makes none of it again. A chat that isn't Easy's flow keeps none. */
  private recordProgress(sessionId: string, fields: AgentEasyProgress): void {
    const session = this.deps.sessions.getSession(sessionId)
    if (session.mode !== 'autonomous' || session.editing) return
    this.deps.sessions.recordAutonomous(sessionId, {
      easyProgress: { ...session.easyProgress, ...fields },
    })
  }

  /** A flow picked up on a "Try again" card asks it again before its step runs again. */
  private async retryFirst(sessionId: string, flow: Flow): Promise<void> {
    if (!flow.retryFirst) return
    flow.retryFirst = false
    await this.askRetry(sessionId, flow)
  }

  /**
   * The Easy flow, from wherever `recorded` says it got to (`NEW_FLOW`: the beginning). A step
   * whose card was answered takes that answer instead of asking; its events (messages, the
   * brief) were shown then, and only a step that runs now shows them.
   */
  private async run(sessionId: string, recorded: Recorded): Promise<void> {
    const flow: Flow = {
      ...(recorded.projectId ? { projectId: recorded.projectId } : {}),
      ...(recorded.retryOpen ? { retryFirst: true } : {}),
      seq: recorded.seq,
      styleRequested: false,
    }
    this.flows.set(sessionId, flow)
    // A new loop card numbers on from any the chat already shows.
    this.loopCards.set(sessionId, Math.max(this.loopCards.get(sessionId) ?? 0, recorded.loopCards))
    const { sessions } = this.deps
    const { cards } = recorded
    try {
      sessions.emitMessage(sessionId, recorded === NEW_FLOW ? IDEAS_INTRO : RESUME_MESSAGE)
      const brief = recorded.brief
        ? { brief: recorded.brief.brief, title: recorded.brief.title }
        : await this.writeBrief(sessionId, flow, recorded)
      this.throwIfCancelled(sessionId)
      const opening = await this.pickOpening(
        sessionId,
        flow,
        brief,
        cards.opening,
        recorded.openings,
      )
      this.recordBrief(sessionId, { opening })
      this.throwIfCancelled(sessionId)
      const camera = await this.pickCamera(sessionId, flow, cards.camera)
      this.throwIfCancelled(sessionId)
      // A loop already written is a loop, whatever its camera card called the option.
      if (camera === 'beat_loop' || recorded.brief?.format === 'beat_loop') {
        const seconds = await this.pickLength(
          sessionId,
          flow,
          {
            descriptions: LOOP_LENGTH_DESCRIPTIONS,
            info: LOOP_LENGTH_INFO,
            lengths: EASY_LOOP_LENGTHS,
          },
          cards.length,
        )
        this.throwIfCancelled(sessionId)
        // A loop short instead: its lines written and said before music, look and its card.
        await this.easyLoop(sessionId, flow, recorded.brief, { ...brief, opening, seconds })
        this.throwIfCancelled(sessionId)
        const music = await this.pickMusic(sessionId, flow, { loop: true }, cards)
        this.recordBrief(sessionId, { music })
        this.throwIfCancelled(sessionId)
      } else {
        const durationSeconds = await this.pickLength(
          sessionId,
          flow,
          {
            descriptions: STORY_LENGTH_DESCRIPTIONS,
            info: STORY_LENGTH_INFO,
            lengths: STORY_LENGTHS,
          },
          cards.length,
        )
        this.throwIfCancelled(sessionId)
        this.recordBrief(sessionId, { cameraStyle: camera, durationSeconds, opening })
        // The plan's brief again, now at its length (a flow picked up after it showed it already).
        if (!cards.length?.answers) {
          sessions.emitAutonomousEvent(sessionId, {
            brief: brief.brief,
            durationSeconds,
            title: brief.title,
            type: 'brief',
          })
        }
        const music = await this.pickMusic(sessionId, flow, {}, cards)
        this.recordBrief(sessionId, { music })
        this.throwIfCancelled(sessionId)
      }
      const style = this.pickedStyle(recorded)
      if (style) return this.carryOnWithStyle(sessionId, flow, style, cards.loop)
      flow.styleRequested = true
      sessions.emitAutonomousEvent(sessionId, { type: 'style_request' })
    } catch (error) {
      // Stopped: end quietly. Anything else: `chooseMode` ends the flow and stops the session.
      if (error instanceof AgentFlowCancelledError) return this.endCancelled(sessionId)
      this.flows.delete(sessionId)
      throw error
    }
  }

  /** `sayLoopLines` for Easy, whose user can't pick a voice: a voice that can't say the lines
   *  is said in plain words (the reason goes to the log). */
  private async sayEasyLoopLines(
    sessionId: string,
    storyboard: BeatLoopStoryboard,
    user: UserInfo,
  ): Promise<BeatLoopLinesCheck> {
    try {
      return await this.sayLoopLines(sessionId, storyboard, user, undefined)
    } catch (error) {
      if (error instanceof AgentFlowCancelledError) throw error
      this.logger.warn(`Easy loop of ${sessionId}: ${ensureError(error).message}`)
      throw new Error(EASY_LINES_UNSAID)
    }
  }

  /** The loop's lines said in its voice and measured; a voice that can't say them is an error
   *  that says why (the tool's reply), and no card is shown. Saying them takes seconds, so a
   *  Stop meanwhile ends it: no line is said after it, and no card follows. */
  private async sayLoopLines(
    sessionId: string,
    storyboard: BeatLoopStoryboard,
    user: UserInfo,
    voice: string | undefined,
  ): Promise<BeatLoopLinesCheck> {
    let check: BeatLoopLinesCheck
    try {
      check = await this.deps.longTake.checkBeatLoopLines({
        shouldStop: () => this.deps.sessions.isFlowCancelled(sessionId),
        storyboard,
        user,
        ...(voice ? { voice } : {}),
      })
    } catch (error) {
      this.throwIfCancelled(sessionId)
      throw new Error(
        `Couldn't say the narration lines to check they fit their clips: ${ensureError(error).message}. No card was shown: try again, or pass another voice.`,
      )
    }
    this.throwIfCancelled(sessionId)
    return check
  }

  /**
   * The storyboard panel's brief for a video a chat asked for (make_video, make_beat_loop) while
   * its card waits: the title and length, and a loop's lines, each with its stamp. A newer brief
   * replaces it.
   */
  private showBrief(sessionId: string, brief: AgentAutonomousBrief): void {
    const { storyboard } = brief
    this.deps.sessions.emitAutonomousEvent(
      sessionId,
      storyboard
        ? { ...loopBriefEvent(storyboard), title: brief.title }
        : {
            // make_video's brief is its title, unless it had none.
            brief: brief.brief === brief.title ? '' : brief.brief,
            durationSeconds: brief.durationSeconds,
            title: brief.title,
            type: 'brief',
          },
    )
  }

  /**
   * A loop short's start: the project is made for it (a loop: 9:16, captions on, music off,
   * the loop's style) and registered for the chat's agent, then `startBeatLoop` stores the
   * storyboard and starts BeatLoopWorkflow. A start tried again reuses the project.
   */
  private async startLoop(
    sessionId: string,
    flow: Flow,
    brief: AgentAutonomousBrief,
    style: StoryStyle,
    user: UserInfo,
  ): Promise<string> {
    const { agentProjects, longTake, projects, sessions } = this.deps
    const { storyboard } = brief
    if (!storyboard) throw new Error('The storyboard is missing')
    // Nothing can make the video: refuse now, not after a project.
    longTake.assertCanStart()
    const look = style.styleText.trim() || style.label
    if (!flow.projectId) {
      flow.projectId = (
        await projects.createProject(
          {
            // Loop shorts start without music (their clips carry their own sound under the
            // narration); the user can add it later, mixed beside that sound.
            bgmEnabled: false,
            createUseCase: BEAT_LOOP_USE_CASE,
            enableCaption: true,
            // The project, and so the chat's row, is named after this (as make_video's is
            // after its title); the narration becomes the project's script when the loop starts.
            initialText: brief.title,
            isLongTake: true,
            longTakeInput: 'transcript',
            longTakeRatio: RATIO,
            styleName: style.label,
            styleText: look,
            ...(style.thumbnailUrl ? { styleThumbnailUrl: style.thumbnailUrl } : {}),
          },
          { agentSessionId: sessionId },
        )
      ).id
      // A start picked up after a restart makes its video in this same project.
      this.recordProgress(sessionId, { projectId: flow.projectId })
    }
    const { projectId } = flow
    const harness = sessions.getSession(sessionId).harness ?? 'codex'
    agentProjects.add(projectId, harness)
    const voice = flow.loopVoice ?? brief.voice?.id
    // The last point Stop can prevent the video: once started, it runs to the end.
    this.throwIfCancelled(sessionId)
    const { workflowId } = await longTake.startBeatLoop({
      debugSettings: agentDebugSettings(harness),
      projectId,
      storyboard,
      style: look,
      styleName: style.label,
      user,
      // The voice its lines were said in; none (a loop from before it was kept): the loop's
      // own, as they were said.
      ...(voice ? { voice } : {}),
    })
    // Easy's music choice goes under the finished loop's own sound (a loop run makes no bed).
    // None unless the user asked for some: the loop is already fast. Asked-for "Pick for me"
    // gets the dynamic track, which fits a loop's pace.
    const music = resolveMusicRequest(brief.music ?? { choice: 'off' }, { cameraStyle: 'dynamic' })
    this.watchLoop(
      sessionId,
      brief.title,
      workflowId,
      music.bgmEnabled ? () => this.addLoopMusic(sessionId, projectId, music, user) : undefined,
    )
    return projectId
  }

  /** The video start: pre-creates the project and registers it for Codex BEFORE anything can
   *  make an LLM call for it (the script, then every workflow activity), writes the voice-over
   *  script from the brief as the composer's script preview does, then starts the long-take
   *  workflow exactly like `POST /long-take-videos`, in that project. */
  private async startVideo(
    sessionId: string,
    flow: Flow,
    style: StoryStyle,
    user: UserInfo,
  ): Promise<string> {
    const { agentProjects, longTake, projects, sessions } = this.deps
    const brief: AgentAutonomousBrief | undefined = sessions.getSession(sessionId).autonomous
    if (!brief) throw new Error('The brief is missing')
    this.throwIfCancelled(sessionId)
    if (brief.format === 'beat_loop') return this.startLoop(sessionId, flow, brief, style, user)
    // Nothing can make the video: refuse now, not after a project and a Codex/Claude script.
    longTake.assertCanStart()
    // The music choice: off, a track (by default the library's track for the video's style),
    // or a bed made from the user's typed wish.
    const music = resolveMusicRequest(brief.music ?? {}, { cameraStyle: brief.cameraStyle })
    // The same body `resolveLongTakeProjectId` would create the project with.
    if (!flow.projectId) {
      flow.projectId = (
        await projects.createProject(
          {
            // Captions are on by default, as in the composer ("Caption is on"): the first
            // render burns them in, and the agent page's "Captions in video" switch starts on.
            enableCaption: true,
            ...(brief.cameraStyle ? { cameraStyle: brief.cameraStyle } : {}),
            bgmEnabled: music.bgmEnabled,
            ...(music.bgmNote ? { bgmNote: music.bgmNote } : {}),
            ...(music.bgmSource ? { bgmSource: music.bgmSource } : {}),
            ...(music.bgmTrackId ? { bgmTrackId: music.bgmTrackId } : {}),
            initialText: brief.brief,
            isLongTake: true,
            longTakeInput: 'transcript',
            longTakeRatio: RATIO,
            ...(style.styleText ? { styleText: style.styleText } : {}),
            styleName: style.label,
            ...(style.thumbnailUrl ? { styleThumbnailUrl: style.thumbnailUrl } : {}),
          },
          // Marks the project as made in agent mode, linked to this chat.
          { agentSessionId: sessionId },
        )
      ).id
      // A start picked up after a restart makes its video in this same project.
      this.recordProgress(sessionId, { projectId: flow.projectId })
    }
    const { projectId } = flow
    const harness = sessions.getSession(sessionId).harness ?? 'codex'
    agentProjects.add(projectId, harness)
    this.throwIfCancelled(sessionId)
    // A script given word for word (make_video) is used as is; Easy's brief becomes one, kept
    // with the brief, so a start tried again (or picked up after a restart) reads the same.
    let script = brief.script?.trim()
    if (!script) {
      script = await (this.deps.writeScript ?? writeScriptOnCodex)({
        brief: brief.brief,
        durationSeconds: brief.durationSeconds,
        opening: brief.opening,
        projectId,
        userId: user.userId || user.sub,
      })
      sessions.recordAutonomous(sessionId, { autonomous: { ...brief, script } })
    }
    // The last point Stop can prevent the video: once started, it runs to the end.
    this.throwIfCancelled(sessionId)
    // Same argument order as `LongTakeController.startLongTake`.
    await longTake.startWorkflow(
      user,
      brief.brief, // userPrompt
      script, // script
      script, // prompt
      undefined, // initPrompt (unused)
      style.styleText,
      false, // customStyle: a preset
      RATIO,
      undefined, // voiceId: the default voice
      undefined, // perfectLoop
      undefined, // visualScriptTemperature
      undefined, // audioUri
      projectId,
      style.label, // styleName
      style.thumbnailUrl,
      false, // isSavedStyle
      agentDebugSettings(harness),
      undefined, // remixProjectId
      undefined, // isStyleCopy
      undefined, // transitionVideoModel
      undefined, // v4Category
      undefined, // v4Track
      undefined, // v4PreviewContextId
      undefined, // scriptGeneratorPath
      undefined, // keyframeImageModel
      brief.durationSeconds, // targetDurationSeconds
      undefined, // generationResolution
      undefined, // createUseCase
      'web', // source: the source type has no agent channel
    )
    return projectId
  }

  /** Runs a Codex step; a failure is retried once at once, then shown as a notice with a
   *  "Try again" card that runs the step again. Cancellation passes straight through. A flow
   *  picked up on that card asks it again first. */
  private async step<T>(
    sessionId: string,
    flow: Flow,
    what: string,
    run: () => Promise<T>,
  ): Promise<T> {
    await this.retryFirst(sessionId, flow)
    for (;;) {
      let failure: Error | undefined
      for (let attempt = 0; attempt < 2; attempt++) {
        this.throwIfCancelled(sessionId)
        try {
          return await run()
        } catch (error) {
          if (error instanceof AgentFlowCancelledError) throw error
          failure = ensureError(error)
          this.logger.warn(`Autonomous mode: couldn't ${what} for ${sessionId}: ${failure.message}`)
        }
      }
      this.deps.sessions.emitNotice(sessionId, `Couldn't ${what}: ${failure?.message ?? 'unknown'}`)
      await this.askRetry(sessionId, flow)
    }
  }

  /** Throws `AgentFlowCancelledError` once the user has stopped the flow. */
  private throwIfCancelled(sessionId: string): void {
    if (this.deps.sessions.isFlowCancelled(sessionId)) throw new AgentFlowCancelledError()
  }

  /**
   * The chat's agent ended its turn when the card went up, long before the loop's run ends: when
   * the run fails, the agent hears why in a turn of its own (`notifyAgent`) and offers a fix. A
   * run that finishes, or that was stopped, says nothing here: the chat plays the video and says
   * it is ready (naming any clip its checks still flag) as for a story video, or the user stopped
   * it.
   */
  private watchLoop(
    sessionId: string,
    title: string,
    workflowId: string,
    onDone?: () => Promise<void>,
  ): void {
    void (this.deps.waitForWorkflow ?? waitForWorkflow)(workflowId).then(
      () => onDone?.(),
      (error: unknown) => {
        if (wasStopped(error)) return
        const reason = failureReason(error)
        this.logger.warn(`Loop short for ${sessionId} failed: ${reason}`)
        try {
          this.deps.sessions.notifyAgent(
            sessionId,
            loopFailedNote(title, reason, this.loopClipUsd()),
          )
        } catch (notifyError) {
          this.logger.warn(
            `Telling the agent of ${sessionId} failed: ${ensureError(notifyError).message}`,
          )
        }
      },
    )
  }

  /** Steps 1-3: ideas (searched for, unless the chat's idea card already offered them), the
   *  user's pick, and the brief for it. */
  private async writeBrief(sessionId: string, flow: Flow, recorded: Recorded): Promise<Brief> {
    const { sessions } = this.deps
    const card = recorded.cards.idea
    const ideas = card
      ? (recorded.ideas ?? ideasFromCard(card.questions))
      : await this.findIdeas(sessionId, flow)
    this.throwIfCancelled(sessionId)
    const choice = await this.pickIdea(sessionId, flow, ideas, card)
    this.throwIfCancelled(sessionId)
    const brief = await this.step(sessionId, flow, 'write the brief', () =>
      this.quietJson(sessionId, POLISH_PROMPT(choice), BriefSchema, {
        effort: 'low',
        outputSchema: BRIEF_SCHEMA,
      }),
    )
    // No length yet: the user picks it after the camera.
    sessions.emitMessage(sessionId, `**${brief.title}**\n\n${brief.brief}`)
    // The same brief, structured, for the storyboard panel.
    sessions.emitAutonomousEvent(sessionId, {
      brief: brief.brief,
      title: brief.title,
      type: 'brief',
    })
    // Kept for the start at the recommended length until the length card is answered.
    sessions.recordAutonomous(sessionId, {
      autonomous: { ...brief, durationSeconds: STORY_LENGTHS[0] },
    })
    return brief
  }

  /**
   * Easy's loop short: the writer (a quiet turn) turns the brief into a storyboard of the
   * picked length (`seconds`) with the hook as its first line; ReelMakeEasy checks it and says
   * every line in the loop's voice (a free local one when installed). Every problem, a line
   * too long for its clip included,
   * goes back to the writer, up to `LOOP_WRITE_ROUNDS` times; then the step fails with a
   * "Try again" card. Nothing is spent on clips here. Shows the lines at that length and
   * returns the loop's brief.
   */
  private async writeEasyLoop(
    sessionId: string,
    flow: Flow,
    brief: Brief,
    opening: string,
    seconds: BeatLoopLength,
  ): Promise<AgentAutonomousBrief> {
    const { sessions } = this.deps
    // Read while the flow's request still names the user.
    const user = (this.deps.user ?? buildLongTakeRequestUser)()
    sessions.emitMessage(
      sessionId,
      `Writing your ${seconds}-second loop: ${seconds / BEAT_CLIP_SECONDS} short lines, each with a fact on screen…`,
    )
    // Once the first line took too long to say, the writer may shorten the hook: on every
    // later round, try and "Try again" too (put back word for word, it would fail each time).
    let openingTooLong = false
    const { storyboard, voice } = await this.step(sessionId, flow, 'write the loop', async () => {
      // Nothing can make the video: say so before any line is said (a paid voice costs).
      this.deps.longTake.assertCanStart()
      let problems: string[] = []
      let previous: string | undefined
      for (let round = 0; round < LOOP_WRITE_ROUNDS; round++) {
        this.throwIfCancelled(sessionId)
        const text = await sessions.runQuietTurn(
          sessionId,
          beatLoopWriterPrompt({ ...brief, opening, openingTooLong, previous, problems, seconds }),
          { effort: 'medium', outputSchema: BEAT_LOOP_STORYBOARD_SCHEMA },
        )
        previous = text
        const hook = openingTooLong ? null : hookAsFirstLine(opening)
        const draft = easyLoopDraft(text, brief.title, hook, seconds)
        const result = validateBeatLoopStoryboard(draft)
        if (!result.ok) {
          problems = result.issues
          continue
        }
        const check = await this.sayEasyLoopLines(sessionId, result.storyboard, user)
        const tooLong = check.lines.filter((line) => !line.fits)
        if (!tooLong.length) return { storyboard: result.storyboard, voice: check.voice }
        if (tooLong.some((line) => line.clipIndex === 0)) openingTooLong = true
        problems = tooLong.map((line) =>
          lineTooLongIssue({
            clipId: line.clipId,
            clipIndex: line.clipIndex,
            narration: line.narration,
            seconds: line.seconds,
          }),
        )
      }
      throw new Error("the loop's lines still didn't fit their clips")
    })
    flow.loopVoice = voice.id
    const loop: AgentAutonomousBrief = {
      brief: brief.brief,
      durationSeconds: storyboard.duration_s,
      format: 'beat_loop',
      opening,
      storyboard,
      title: brief.title,
      // Kept, so a flow picked up after a restart makes the loop in the voice its card names.
      voice,
    }
    sessions.recordAutonomous(sessionId, { autonomous: loop })
    sessions.emitMessage(sessionId, loopLinesMessage(storyboard))
    this.showBrief(sessionId, loop)
    return loop
  }
}

/** What `make_beat_loop` answers: the checked loop's length, clips, estimate and voice while a
 *  card waits for the user, or every issue to fix (a line too long for its clip among them). */
export type MakeBeatLoopResult =
  | {
      /** The card the user now sees: its question and its buttons, by their labels. */
      card?: { buttons: string[]; question: string }
      clips: number
      /** One 4 s clip: a re-roll, or each clip after a redone one. */
      clipUsd: number
      durationSeconds: number
      estimatedCostUsd: number
      /** The other provider's model: it makes a clip only when `model`'s call fails on it, at
       *  its own price a clip. */
      fallback?: { clipUsd: number; model: string }
      format: 'beat_loop'
      /** The model every clip tries first, which the estimate is priced on. */
      model: string
      /** What the user does next to start the loop, in the words the chat shows. */
      next: string
      note?: string
      /** What the loop waits for: the card's "Make it" button, or a pick in the style picker. */
      status: 'waiting_for_make_it' | 'waiting_for_style'
      /** The voice every line was said in, and will be in the video. */
      voice: LoopVoice
      warnings: string[]
    }
  | {
      format: 'beat_loop'
      issues: string[]
      status: 'invalid'
      /** The lines too long for their clip, said in `voice`: each as the voice said it. */
      tooLong?: {
        clipId: string
        narration: string
        /** The speed-up it would need (at most 1.3 fits). */
        speedNeeded: number
        spokenSeconds: number
        /** What to aim for ("about 8 short words, no quotes or colons"). */
        target: string
      }[]
      voice?: LoopVoice
      warnings: string[]
    }

/** Emphasis markers around a whole word or phrase (`**bold**`, `_it_`), never inside a word
 *  (`snake_case`, `2*3*4`). */
const EMPHASIS = [
  /(^|[\s(])\*{1,3}(\S(?:[^*]*?\S)?)\*{1,3}(?=$|[\s.,;:!?)])/g,
  /(^|[\s(])_{1,3}(\S(?:[^_]*?\S)?)_{1,3}(?=$|[\s.,;:!?)])/g,
  /(^|[\s(])`([^`]+)`(?=$|[\s.,;:!?)])/g,
]

/** A line Codex wrote, as plain text: markdown links become their text, and emphasis markers
 *  around whole words go. Other `*`, `_` and backticks stay. */
export function plainText(text: string): string {
  let out = text.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  for (const re of EMPHASIS) out = out.replace(re, '$1$2')
  return out.replace(/\s+/g, ' ').trim()
}

const SOURCE_TAG_PREFIX = new RegExp(`^(${Object.values(SOURCE_TAGS).join('|')}): `)

/** The ideas earlier idea cards offered, newest first, once each (by title): each option's
 *  label without its source tag and "(Recommended)", and its hook. */
export function pastIdeas(questions: readonly AgentQuestion[]): PastIdea[] {
  const seen = new Set<string>()
  const ideas: PastIdea[] = []
  for (const option of questions.flatMap((q) => q.options)) {
    const title = splitRecommended(option.label).text.replace(SOURCE_TAG_PREFIX, '').trim()
    const key = title.toLowerCase()
    if (!title || seen.has(key)) continue
    seen.add(key)
    ideas.push({ hook: option.description.trim(), title })
    if (ideas.length === MAX_AVOIDED_IDEAS) break
  }
  return ideas
}

/** The composer's script preview, run for the (Codex-registered) project so its LLM calls go to
 *  Codex. A fallback script (the brief itself, normalized) would be read aloud as the
 *  voice-over, so anything but a generated script is a failure. */
export async function writeScriptOnCodex(params: ScriptParams): Promise<string> {
  const preview = await JobContext.run({ projectId: params.projectId }, () =>
    generateLongTakeScriptPreview({
      contextId: params.projectId,
      effectiveMaxScriptWords: getStoryModeUserLimits().absoluteMaxScriptWords,
      openingLine: params.opening,
      rawInput: params.brief,
      targetDurationSeconds: params.durationSeconds,
      userId: params.userId,
    }),
  )
  if (preview.finalScriptSource !== 'generated' || !preview.script.trim())
    throw new Error('Codex could not write the voice-over script')
  return preview.script
}

/**
 * The Storyboard panel's brief for a loop short: its title and length, and each line with its
 * stamp. Shown when make_beat_loop's card goes up, and again when a redo changes the lines.
 */
export function loopBriefEvent(
  storyboard: Pick<BeatLoopStoryboard, 'clips' | 'duration_s' | 'title'>,
): Extract<AgentUiEvent, { type: 'brief' }> {
  return {
    brief: `${storyboard.clips.length} clips of ${BEAT_CLIP_SECONDS} s, replaying as a loop`,
    durationSeconds: storyboard.duration_s,
    lines: storyboard.clips.map((clip) => ({ narration: clip.narration, stamp: clip.stamp })),
    title: storyboard.title,
    type: 'brief',
  }
}

/**
 * The note a chat's agent gets when its loop short's run failed (`watchLoop`): ReelMakeEasy's
 * reason word for word (for lines too long: which ones, and by how much), and how this chat
 * fixes it. The user sees only the agent's answer.
 */
export function loopFailedNote(title: string, reason: string, clipUsd: null | number): string {
  const price = clipUsd === null ? '' : ` (about $${clipUsd.toFixed(2)} for each clip it makes)`
  return [
    `ReelMakeEasy note, not shown to the user: the loop short "${title}" stopped before it was finished, so there is no video yet. ReelMakeEasy's reason: ${reason}`,
    'Tell the user in one or two plain sentences what went wrong (no file paths, tool names or notes to yourself) and offer a fix. For a line that is too long, offer a shorter rewrite of just that line with the same facts: fewer and shorter words, and no quotes, colons or dashes (they add pauses). Ask before making anything.',
    `When the user agrees, call regenerate_clip on each clip to fix, one after another, with changes such as {"narration": "..."}; changing only its narration, caption or stamp keeps every clip already made. make_beat_loop can't start this loop again. Each call runs the loop again from where it stopped and makes the clips still missing${price}. While another line is still too long, the run stops again at the voice-over, before any clip is paid for.`,
  ].join('\n\n')
}

/** What a card asks and says: two cards with the same are the same card. */
function cardText(question: AgentQuestion): string {
  return [question.question, ...question.options.map((option) => option.description)].join('\n')
}

/** Whether a "Make this loop?" card the chat shows was answered "Make it". */
function saidMakeIt(card: RecordedCard | undefined): boolean {
  return (card?.answers?.['make'] ?? [])[0]?.trim() === MAKE_LOOP_LABEL
}

/** The "Make this loop?" card's question: its length and the estimate's total. */
const loopCardTitle = (durationSeconds: number, totalUsd: number) =>
  `Make this ${durationSeconds}-second loop? About $${totalUsd.toFixed(2)}`
const LOOP_CARD_PRICE = /\? About \$(\d+(?:\.\d+)?)$/

/** The price a "Make this loop?" card showed (`loopCardTitle`), read back from the card itself:
 *  what the user said "Make it" to. Null when it doesn't say. */
function loopCardPrice(questions: readonly AgentQuestion[]): null | number {
  const match = LOOP_CARD_PRICE.exec(questions[0]?.question ?? '')
  return match ? Number(match[1]) : null
}

/** The "Make this loop?" card: its length, estimate and voice, then Make it or Not now. */
function loopCardQuestion(
  durationSeconds: number,
  estimate: BeatLoopEstimate,
  /** None for an Easy loop from before its voice was kept: the card leaves it out. */
  voice: LoopVoice | undefined,
  /** Easy's card: the look picked in its style picker (else the storyboard's own). Easy takes
   *  no messages there, so "Not now" doesn't offer to change the storyboard. */
  easy?: { styleLabel: string },
): AgentQuestion {
  const look = easy ? `in the ${easy.styleLabel} style` : "in the storyboard's style"
  return {
    header: 'Loop short',
    id: 'make',
    isOther: false,
    isSecret: false,
    options: [
      {
        description: [
          `${estimate.clipCount} clips of 4 s on ${estimate.modelLabel}, ${look}. A clip made again costs about $${estimate.clipUsd.toFixed(2)}.`,
          ...(estimate.fallback
            ? [
                `A clip ${estimate.modelLabel} fails to make is made with ${estimate.fallback.modelLabel} instead, at about $${estimate.fallback.clipUsd.toFixed(2)}.`,
              ]
            : []),
          ...(voice
            ? [
                voice.free
                  ? `Voice: ${voice.name}, free on this computer.`
                  : `Voice: ${voice.name}.`,
              ]
            : []),
        ].join(' '),
        label: MAKE_LOOP_LABEL,
      },
      {
        description: easy
          ? 'Nothing is made or spent.'
          : 'Nothing is spent. Change the storyboard first.',
        label: KEEP_LOOP_LABEL,
      },
    ],
    question: loopCardTitle(durationSeconds, estimate.totalUsd),
  }
}

/** A storyboard's own style, as the start takes a style: named after the skill's preset it is. */
function storyboardStyle(storyboard: BeatLoopStoryboard | undefined): StoryStyle {
  const styleText = storyboard?.style?.trim() ?? ''
  const preset = BEAT_LOOP_STYLE_PRESETS.find((p) => p.style === styleText)
  return { id: 'storyboard', label: preset?.name ?? 'Storyboard style', styleText }
}

/** Easy's cards in a chat's transcript: the latest of each kind (answered, or open when the flow
 *  was cut off), the highest card numbers, and whether it stopped on a "Try again" card. */
function easyCards(
  entries: readonly TranscriptEntry[],
): Pick<Recorded, 'cards' | 'loopCards' | 'retryOpen' | 'seq'> {
  const cards: Recorded['cards'] = {}
  let seq = 0
  let loopCards = 0
  let last: undefined | { answered: boolean; kind: CardKind }
  for (const entry of entries) {
    const match = entry.kind === 'question' ? EASY_CARD_ID.exec(entry.id) : null
    if (entry.kind !== 'question' || !match) continue
    const kind = match[1] as CardKind
    const n = Number(match[2])
    if (kind === 'loop') loopCards = Math.max(loopCards, n)
    else seq = Math.max(seq, n)
    const answers = entry.state === 'answered' ? entry.answers : undefined
    cards[kind] = { questions: entry.questions, ...(answers ? { answers } : {}) }
    last = { answered: !!answers, kind }
  }
  return { cards, loopCards, retryOpen: last?.kind === 'retry' && !last.answered, seq }
}

/** The ideas an idea card offered, read back from the card itself (a chat from before the
 *  ideas were kept): each option's source and title, and its hook; no date or source link. */
function ideasFromCard(questions: readonly AgentQuestion[]): Idea[] {
  return (questions[0]?.options ?? []).map((option) => {
    const text = splitRecommended(option.label).text
    const source = IDEA_SOURCES.find((s) => text.startsWith(`${SOURCE_TAGS[s]}: `))
    return {
      hook: option.description,
      source: source ?? 'fun_fact',
      sourceUrl: '',
      title: source ? text.slice(SOURCE_TAGS[source].length + 2) : text,
      when: '',
    }
  })
}

/** The openers an attention-hook card offered, read back from the card itself (a chat from
 *  before they were kept): `<style>: <line>`, and why. */
function openingsFromCard(questions: readonly AgentQuestion[]): Opening[] {
  return (questions[0]?.options ?? []).map((option) => {
    const text = splitRecommended(option.label).text
    const colon = text.indexOf(': ')
    return colon === -1
      ? { line: text, style: '', why: option.description }
      : { line: text.slice(colon + 2), style: text.slice(0, colon), why: option.description }
  })
}

/** A track card line for one of the user's tracks: its length, marked when AI made it. */
function trackDescription(track: { aiGenerated?: boolean; durationSec?: number }): string {
  const total = Math.max(0, Math.round(track.durationSec ?? 0))
  const length = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
  return track.aiGenerated ? `AI generated · ${length}` : length
}

/**
 * The writer's answer as Easy's loop: its title, the picked length, no style (Easy's style
 * picker gives the look) and no voice, and the hook as line 1 when the hook is a line as it
 * is. Not JSON: as is, for the check to say so.
 */
function easyLoopDraft(
  text: string,
  title: string,
  hook: null | string,
  seconds: BeatLoopLength,
): unknown {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return text
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw
  const { style: _style, voice: _voice, ...rest } = raw as Record<string, unknown>
  const clips = Array.isArray(rest.clips) ? [...(rest.clips as unknown[])] : rest.clips
  if (hook && Array.isArray(clips) && typeof clips[0] === 'object' && clips[0] !== null) {
    clips[0] = { ...(clips[0] as Record<string, unknown>), narration: hook }
  }
  return { ...rest, clips, duration_s: seconds, title }
}

/** The chat's look at an Easy loop's lines: its title and length, then each line with its
 *  stamp. */
function loopLinesMessage(storyboard: BeatLoopStoryboard): string {
  const lines = storyboard.clips.map((clip, i) => {
    const stamp = clip.stamp ? ` *(${clip.stamp})*` : ''
    return `${i + 1}. ${clip.narration}${stamp}`
  })
  return [`**${storyboard.title}** · ${storyboard.duration_s}s`, '', ...lines].join('\n')
}
