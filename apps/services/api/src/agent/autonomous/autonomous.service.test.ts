import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { EXPLAINER_COLLAGE_STYLE } from '@reelmakeeasy/common/long-take/beat-loop-craft'
import type { UserInfo } from '@reelmakeeasy/common/types/user'
import { GENERATION_NOT_SET_UP_MESSAGE } from '@reelmakeeasy/llm/registry'
import {
  ActivityFailure,
  ApplicationFailure,
  CancelledFailure,
  WorkflowFailedError,
} from '@reelmakeeasy/workflow-engine/common'
import { ConflictException } from '@nestjs/common'
import type {
  AgentAnswers,
  AgentQuestion,
  AgentSession,
  AgentUiEvent,
  BeatLoopClip,
  BeatLoopStoryboard,
} from '@shared/types/api/agent'

import type { BeatLoopEstimate } from '../../long-take/beat-loop.service'
import {
  AgentFlowCancelledError,
  AgentSessionService,
  FlowActiveError,
  ModeNotChattableError,
  NotResumableError,
} from '../agent-session.service'
import { CodexRpcClient } from '../codex/codex-rpc'
import { ATTENTION_HOOK_INFO } from '../craft/opening-craft'

import {
  AutonomousService,
  pastIdeas,
  plainText,
  StyleNotRequestedError,
  UnknownStyleError,
} from './autonomous.service'
import {
  BRIEF_SCHEMA,
  FIGURE_KINDS,
  FUN_FACT_TOPICS,
  IDEAS_PROMPT,
  IDEAS_SCHEMA,
  OPENINGS_PROMPT,
  OPENINGS_SCHEMA,
  POLISH_PROMPT,
} from './autonomous-prompts'
import type { StoryStyle } from './story-styles'

const S = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'
const TODAY = new Date('2026-10-01T09:30:00Z')

const IDEAS = {
  ideas: [
    {
      hook: 'An octopus has three hearts, and two stop when it swims.',
      source: 'fun_fact',
      sourceUrl: '',
      title: 'Octopus hearts',
      when: '19th century',
    },
    {
      hook: 'A comet [visible tonight](https://news.example/comet) without a telescope.',
      source: 'recent_news',
      sourceUrl: 'https://news.example/comet',
      title: 'A comet you can see',
      when: '2026-09-28',
    },
    {
      hook: 'Einstein failed his first entrance exam.',
      source: 'famous_figure',
      sourceUrl: '',
      title: 'Einstein the dropout',
      when: '1895',
    },
  ],
}
const BRIEF = {
  brief:
    'A bright comet is visible tonight. Show where to look, why it glows, and when it returns.',
  durationSeconds: 30 as const,
  title: 'Catch the comet tonight',
}
const OPENINGS = {
  openings: [
    { line: 'Is that comet visible tonight?', style: 'Question', why: 'Everyone looks up.' },
    { line: 'Ten thousand years for one fly-by.', style: 'Shock number', why: 'A huge number.' },
    {
      line: 'Comets are dirty snowballs. Not quite.',
      style: 'Myth-bust',
      why: 'Corrects a belief.',
    },
  ],
}
/** The opening card's recommended option, as the card labels it. */
const FIRST_OPENING = 'Question: Is that comet visible tonight? (Recommended)'
const STYLE: StoryStyle = {
  id: '3d-animation',
  label: 'Animation',
  styleText: 'Stylize the image with modern 3D',
  thumbnailUrl: 'preset://v001/story-mode/styles/3d-animation.webp',
}
const USER = {
  email: 'you@reelmakeeasy.local',
  orgId: 'local-org',
  sub: 'local-user',
  userId: 'u',
} as unknown as UserInfo

/** The stand-in loop estimate: $0.16 a clip, $0.20 with its keyframe. */
const LOOP_ESTIMATE: BeatLoopEstimate = {
  clipCount: 4,
  clipUsd: 0.16,
  keyframesUsd: 0.16,
  model: 'minimax-h3-max-turbo',
  modelLabel: 'MiniMax Hailuo 3',
  provider: 'fal',
  resolution: '768p',
  totalUsd: 0.8,
  usdPerSecond: 0.04,
  videoUsd: 0.64,
}
const LOOP_CLIPS: BeatLoopClip[] = [
  {
    caption: null,
    cut: 'The camera dives fast into a single drop until its golden surface fills the whole frame.',
    cut_camera: 'Zoom in',
    freeze: 'The drips freeze mid-air, glossy and still.',
    hit: 'The honey jar cutout slams onto the page as golden drips burst out from its rim.',
    hit_camera: 'Push in',
    id: 'c1',
    narration: 'Honey found in ancient tombs was still good to eat.',
    stamp: 'c. 1325 BC',
  },
  {
    caption: null,
    cut: 'The camera pulls out fast to show a hive cutout on torn paper.',
    cut_camera: 'Pull out',
    freeze: 'The bees hang in a ring, wings blurred.',
    hit: 'Bees swarm out of the drop in a fast spiral as a red marker circle scribbles around them.',
    hit_camera: 'Shake',
    id: 'c2',
    narration: 'Bees fan the nectar with their wings to dry it.',
    stamp: null,
  },
  {
    caption: null,
    cut: 'The camera tilts down fast to a clay pot cutout at the bottom of the page.',
    cut_camera: 'Tilt down',
    freeze: 'The comb holds still, every cell full and shining.',
    hit: 'The hive cutout cracks open and honeycomb cells snap into place one after another.',
    hit_camera: 'Zoom in',
    id: 'c3',
    narration: 'That leaves too little water for any germ to grow.',
    stamp: null,
  },
  {
    caption: null,
    cut: 'The camera whip-pans fast to the right, back to the honey jar cutout on the page.',
    cut_camera: 'Pan right',
    freeze: 'The lid hangs in the air above the pot.',
    hit: 'The clay pot lid flies off and a yellow highlighter stroke swipes across the pot.',
    hit_camera: 'Push in',
    id: 'c4',
    narration: 'So a jar of honey can outlast all of us.',
    stamp: null,
  },
  {
    caption: null,
    cut: 'The camera whip-pans fast to the left, back to the honey jar cutout on the page.',
    cut_camera: 'Pan left',
    freeze: 'The spoon hangs above the jar, honey trailing from it.',
    hit: 'A wooden spoon plunges into the jar and a thick golden ribbon whips up and out.',
    hit_camera: 'Shake',
    id: 'c5',
    narration: 'Seal the lid and it keeps for thousands of years.',
    stamp: null,
  },
]

/** A loop short that passes every storyboard check: 16 s (4 clips) or 20 s (5 clips). */
function loopStoryboard(opts: { clips?: 4 | 5; style?: string } = {}): BeatLoopStoryboard {
  const clips = LOOP_CLIPS.slice(0, opts.clips ?? 4)
  return {
    accent: '#FFE500',
    clips,
    duration_s: clips.length === 5 ? 20 : 16,
    keyframes: [
      ...clips.map((clip, i) => ({ id: `f${i}`, prompt: `The scene of ${clip.id}.` })),
      { id: `f${clips.length}`, same_as: 'f0' },
    ],
    sources: 'Smithsonian Magazine',
    ...(opts.style ? { style: opts.style } : {}),
    title: 'Honey never spoils',
  }
}

/** Kokoro Heart on this computer: what a loop says its lines in when no voice is named. */
const FREE_VOICE = { free: true, id: 'kokoro-af_heart', name: 'Kokoro Heart' }

/** A stand-in for `LongTakeService.checkBeatLoopLines`: every line said in the voice named
 *  (paid), else in Kokoro Heart; `seconds` by clip id (default 3 s, which fits). */
function saidLines(seconds: Record<string, number> = {}) {
  return async (input: { storyboard: BeatLoopStoryboard; voice?: string }) => ({
    lines: input.storyboard.clips.map((clip, clipIndex) => {
      const said = seconds[clip.id] ?? 3
      return {
        clipId: clip.id,
        clipIndex,
        fits: said <= 3.45 * 1.3,
        narration: clip.narration,
        seconds: said,
        tempo: Math.max(1, said / 3.45),
      }
    }),
    voice: input.voice ? { free: false, id: input.voice, name: input.voice } : FREE_VOICE,
  })
}

const flush = () => new Promise((r) => setImmediate(r))
const cancelledEvents = (events: AgentUiEvent[]) =>
  events.filter((e) => e.type === 'flow_cancelled')
const waitFor = async (fn: () => boolean, ms = 2000) => {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out')
    await flush()
  }
}

/** A stand-in for `AgentSessionService`: records events and open questions in memory. */
function makeService(
  replies: (Error | string)[],
  over: {
    /** Stands in for `LongTakeService.assertCanStart` (default: lets every start through). */
    assertCanStart?: jest.Mock
    /** Stands in for `LongTakeService.checkBeatLoopLines` (default: every line fits, said in
     *  the voice named, else in Kokoro Heart, free). */
    checkBeatLoopLines?: jest.Mock
    /** Stands in for `LongTakeService.createBgmVersion` (default: starts a music run). */
    createBgmVersion?: jest.Mock
    /** The music catalog the cards offer (default: none, so the card has the presets only). */
    music?: { catalog: jest.Mock }
    pastQuestions?: AgentQuestion[]
    random?: () => number
    /** Stands in for `LongTakeService.startBeatLoop` (default: starts every loop). */
    startBeatLoop?: jest.Mock
    startWorkflow?: jest.Mock
    user?: () => UserInfo
    /** Stands in for the engine's wait on a run (default: the run never ends). */
    waitForWorkflow?: jest.Mock
  } = {},
) {
  const fake = makeSessions(replies, over.pastQuestions ?? [])
  const agentProjects = { add: jest.fn() }
  const projects = { createProject: jest.fn().mockResolvedValue({ id: 'p1' }) }
  const longTake = {
    assertCanStart: over.assertCanStart ?? jest.fn(),
    checkBeatLoopLines: over.checkBeatLoopLines ?? jest.fn(saidLines()),
    createBgmVersion: over.createBgmVersion ?? jest.fn().mockResolvedValue({ workflowId: 'bgm1' }),
    startBeatLoop:
      over.startBeatLoop ?? jest.fn().mockResolvedValue({ projectId: 'p1', workflowId: 'w1' }),
    startWorkflow:
      over.startWorkflow ?? jest.fn().mockResolvedValue({ projectId: 'p1', workflowId: 'w1' }),
  }
  const writeScript = jest.fn().mockResolvedValue('Look up tonight. A comet is passing by.')
  const findStyle = jest.fn((id: string) => (id === STYLE.id ? STYLE : null))
  const waitForWorkflow = over.waitForWorkflow ?? jest.fn(() => new Promise<never>(() => undefined))
  const estimateLoop = jest.fn((clips: number) => ({
    ...LOOP_ESTIMATE,
    clipCount: clips,
    totalUsd: Number((clips * 0.2).toFixed(2)),
  }))
  /** A flow service on these stand-ins: a second one plays the next process after a restart. */
  const build = () =>
    new AutonomousService({
      agentProjects,
      estimateLoop,
      findStyle,
      longTake: longTake as never,
      ...(over.music ? { music: over.music as never } : {}),
      now: () => TODAY,
      presetPackUri: (key: string) => `preset://v9/${key}`,
      projects,
      random: over.random ?? (() => 0),
      sessions: fake.sessions as never,
      user: over.user ?? (() => USER),
      waitForWorkflow,
      writeScript,
    })
  const svc = build()
  return {
    ...fake,
    agentProjects,
    build,
    estimateLoop,
    longTake,
    projects,
    svc,
    waitForWorkflow,
    writeScript,
  }
}

function makeSessions(replies: (Error | string)[], past: AgentQuestion[] = []) {
  /** What the flow emitted. */
  const events: AgentUiEvent[] = []
  /** The chat's whole transcript as the session stores it: the flow's events, the answers. */
  const transcript: AgentUiEvent[] = []
  const emit = (event: AgentUiEvent) => {
    events.push(event)
    transcript.push(event)
  }
  const open = new Map<
    string,
    { questions: AgentQuestion[]; reject: (e: Error) => void; resolve: (a: AgentAnswers) => void }
  >()
  const cancelled = { value: false }
  const session: AgentSession = {
    createdAt: '2026-10-01T00:00:00.000Z',
    flowActive: true,
    id: S,
    mode: 'autonomous',
    projectId: null,
    status: 'idle',
    threadId: null,
    title: 'Untitled video',
  }
  const sessions = {
    askServerQuestion: jest.fn(
      (_id: string, questionId: string, questions: AgentQuestion[]) =>
        new Promise<AgentAnswers>((resolve, reject) => {
          open.set(questionId, { questions, reject, resolve })
          emit({ questionId, questions, type: 'question' })
        }),
    ),
    emitAutonomousEvent: jest.fn((_id: string, e: AgentUiEvent) => emit(e)),
    emitMessage: jest.fn((_id: string, text: string) =>
      emit({ itemId: 'ly', text, type: 'message' }),
    ),
    emitNotice: jest.fn((_id: string, text: string) => emit({ text, type: 'notice' })),
    endAutonomousFlow: jest.fn(() => {
      session.flowActive = false
    }),
    /** The chat's transcript (an interrupted flow reads its answers there). */
    events: jest.fn(() => [...transcript]),
    expireServerQuestion: jest.fn((_id: string, questionId: string) => {
      const q = open.get(questionId)
      if (!q) return
      open.delete(questionId)
      q.reject(new Error(`Question ${questionId} was replaced by a newer one`))
      emit({ questionId, type: 'question_expired' })
    }),
    getSession: jest.fn(() => session),
    /** Idea cards from earlier chats. */
    pastQuestions: jest.fn(() => past),
    /** Flip `cancelled.value` to play the user pressing Stop. */
    isFlowCancelled: jest.fn(() => cancelled.value),
    linkProject: jest.fn(),
    /** A hidden turn for the chat's agent (a loop's run failed). */
    notifyAgent: jest.fn(),
    recordAutonomous: jest.fn((_id: string, patch: Partial<AgentSession>) =>
      Object.assign(session, patch),
    ),
    setFlowWorking: jest.fn((_id: string, working: boolean) => {
      session.status = working ? 'running' : 'idle'
      emit({ status: session.status, type: 'session' })
    }),
    runQuietTurn: jest.fn(async (_id: string, _text: string, _opts?: unknown) => {
      const next = replies.shift()
      if (next === undefined) throw new Error('no reply scripted')
      if (next instanceof Error) throw next
      return next
    }),
    titleChat: jest.fn(),
  }
  /** Answers the open question whose id starts with `prefix` with `text`. */
  const answer = (prefix: string, text: string) => {
    const [questionId, q] = [...open].find(([id]) => id.startsWith(prefix)) ?? []
    if (!questionId || !q) throw new Error(`no open question ${prefix}`)
    open.delete(questionId)
    const answers = { [q.questions[0].id]: [text] }
    transcript.push({ answers, questionId, type: 'question_answered' })
    q.resolve(answers)
  }
  const isOpen = (prefix: string) => [...open.keys()].some((id) => id.startsWith(prefix))
  /** ReelMakeEasy shuts down, as `AgentSessionService.onModuleDestroy` does: every open card
   *  expires (its asker hears of the shutdown), and the chat stops, marked interrupted. */
  const shutDown = () => {
    for (const [questionId, q] of open) {
      open.delete(questionId)
      q.reject(new AgentFlowCancelledError('ReelMakeEasy is shutting down'))
      transcript.push({ questionId, type: 'question_expired' })
    }
    transcript.push({ reason: 'ReelMakeEasy is shutting down', status: 'stopped', type: 'session' })
    Object.assign(session, { flowActive: false, interrupted: true, status: 'stopped' })
  }
  return { answer, cancelled, events, isOpen, open, session, sessions, shutDown, transcript }
}

/** Answers the opening card, once it is open, with `pick` (default: the recommended one). */
async function answerOpening(t: ReturnType<typeof makeService>, pick = FIRST_OPENING) {
  await waitFor(() => t.isOpen('autonomous-opening-'))
  t.answer('autonomous-opening-', pick)
}

/** Runs `start` up to the style request, picking `pick` for the idea and `opening` for the
 *  opening. */
/** The length card's recommended option: a story video's, and a loop's. */
const STORY_LENGTH = '30 seconds (Recommended)'
const LOOP_LENGTH = '24 seconds (Recommended)'
/** Answers the length card, once it is open. */
async function answerLength(t: ReturnType<typeof makeService>, pick = STORY_LENGTH) {
  await waitFor(() => t.isOpen('autonomous-length-'))
  t.answer('autonomous-length-', pick)
}
/** Answers the camera style card, once it is open, then the length card that follows it
 *  (`length`, by default the recommended one). */
async function answerCamera(t: ReturnType<typeof makeService>, pick = 'Dynamic', length?: string) {
  await waitFor(() => t.isOpen('autonomous-camera-'))
  t.answer('autonomous-camera-', pick)
  await answerLength(t, length ?? (pick.startsWith('Beat loop') ? LOOP_LENGTH : STORY_LENGTH))
}
/** The music card's recommended option, as the card labels it. */
const AUTO_MUSIC = 'Pick for me (Recommended)'
/** Answers the music card, once it is open. */
async function answerMusic(t: ReturnType<typeof makeService>, pick = AUTO_MUSIC) {
  await waitFor(() => t.isOpen('autonomous-music-'))
  t.answer('autonomous-music-', pick)
}

async function toStyleRequest(
  t: ReturnType<typeof makeService>,
  pick: string,
  opening = FIRST_OPENING,
) {
  const run = t.svc.start(S)
  await waitFor(() => t.isOpen('autonomous-idea-'))
  t.answer('autonomous-idea-', pick)
  await answerOpening(t, opening)
  await answerCamera(t)
  await answerMusic(t)
  await run
}

describe('AutonomousService', () => {
  it('finds ideas, polishes the pick, asks for a style, then starts the video on Codex', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))

    expect(t.events[0]).toEqual({
      itemId: 'ly',
      text: "Let's find you an idea. I'm checking today's news and some fun facts…",
      type: 'message',
    })
    expect(t.sessions.runQuietTurn).toHaveBeenCalledWith(
      S,
      IDEAS_PROMPT('2026-10-01', {
        avoid: [],
        figureKind: FIGURE_KINDS[0],
        funFactTopic: FUN_FACT_TOPICS[0],
      }),
      {
        effort: 'medium',
        outputSchema: IDEAS_SCHEMA,
      },
    )
    const question = t.events.find((e) => e.type === 'question')
    expect(question).toEqual({
      questionId: 'autonomous-idea-1',
      questions: [
        {
          header: 'Idea',
          id: 'idea',
          isOther: true,
          isSecret: false,
          options: [
            {
              description: 'An octopus has three hearts, and two stop when it swims.',
              label: 'Fun fact: Octopus hearts (Recommended)',
            },
            {
              description: 'A comet visible tonight without a telescope.',
              label: 'Recent news: A comet you can see',
            },
            {
              description: 'Einstein failed his first entrance exam.',
              label: 'Famous figure: Einstein the dropout',
            },
          ],
          question: 'Which idea should we make?',
        },
      ],
      type: 'question',
    })

    t.answer('autonomous-idea-', 'Recent news: A comet you can see')
    await answerOpening(t)
    await answerCamera(t)
    await answerMusic(t)
    await run

    const [, polishText, polishOpts] = t.sessions.runQuietTurn.mock.calls[1]
    expect(polishOpts).toEqual({ effort: 'low', outputSchema: BRIEF_SCHEMA })
    expect(polishText).toBe(
      POLISH_PROMPT(
        'Recent news: A comet you can see. A comet visible tonight without a telescope. (When: 2026-09-28) (Source: https://news.example/comet)',
      ),
    )
    expect(t.events).toContainEqual({
      itemId: 'ly',
      text: `**Catch the comet tonight**\n\n${BRIEF.brief}`,
      type: 'message',
    })
    expect(t.session.autonomous).toEqual({
      ...BRIEF,
      cameraStyle: 'dynamic',
      music: { choice: 'auto' },
      opening: OPENINGS.openings[0].line,
    })
    expect(t.events.at(-1)).toEqual({ type: 'style_request' })

    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))

    expect(t.events).toContainEqual({
      styleId: '3d-animation',
      styleName: 'Animation',
      thumbnailUrl: STYLE.thumbnailUrl,
      type: 'style_chosen',
    })
    expect(t.projects.createProject).toHaveBeenCalledWith(
      {
        // Music on by default ("Pick for me"): the library's track for a dynamic video.
        bgmEnabled: true,
        bgmSource: 'library',
        bgmTrackId: 'groovy-lofi',
        cameraStyle: 'dynamic',
        // Captions on by default, like the composer: the first render burns them in.
        enableCaption: true,
        initialText: BRIEF.brief,
        isLongTake: true,
        longTakeInput: 'transcript',
        longTakeRatio: '9:16',
        styleName: 'Animation',
        styleText: STYLE.styleText,
        // The project keeps the preset's address, not its URL with a host and port.
        styleThumbnailUrl: 'preset://v001/story-mode/styles/3d-animation.webp',
      },
      { agentSessionId: S },
    )
    // Registered for Codex before anything can make an LLM call for the project.
    expect(t.agentProjects.add).toHaveBeenCalledWith('p1', 'codex')
    const order = (m: jest.Mock) => m.mock.invocationCallOrder[0]
    expect(order(t.agentProjects.add)).toBeLessThan(order(t.writeScript))
    expect(order(t.agentProjects.add)).toBeLessThan(order(t.longTake.startWorkflow))
    expect(t.writeScript).toHaveBeenCalledWith({
      brief: BRIEF.brief,
      durationSeconds: 30,
      opening: OPENINGS.openings[0].line,
      projectId: 'p1',
      userId: 'u',
    })
    const args = t.longTake.startWorkflow.mock.calls[0]
    expect(args).toHaveLength(29)
    expect(args[0]).toEqual(USER)
    expect(args[1]).toBe(BRIEF.brief) // userPrompt
    expect(args[2]).toBe('Look up tonight. A comet is passing by.') // script
    expect(args[3]).toBe('Look up tonight. A comet is passing by.') // prompt
    expect(args[5]).toBe(STYLE.styleText)
    expect(args[6]).toBe(false) // customStyle
    expect(args[7]).toBe('9:16')
    expect(args[12]).toBe('p1')
    expect(args[13]).toBe('Animation')
    expect(args[14]).toBe(STYLE.thumbnailUrl)
    expect((args[16] as { llm: { chatProvider: string } }).llm.chatProvider).toBe('codex')
    expect(args[25]).toBe(30)
    expect(args[28]).toBe('web')

    const styleChosen = t.events.findIndex((e) => e.type === 'style_chosen')
    expect(t.events.slice(styleChosen + 1)).toEqual([
      // The working state shows while the script is written and the video starts.
      { status: 'running', type: 'session' },
      { projectId: 'p1', type: 'video_started' },
      {
        itemId: 'ly',
        text: "Your video is being made. It will play right here when it's ready.",
        type: 'message',
      },
      { status: 'idle', type: 'session' },
    ])
    expect(t.session).toMatchObject({ flowActive: false, projectId: 'p1', status: 'idle' })
    expect(t.sessions.endAutonomousFlow).toHaveBeenCalledWith(S)
    // The style request is used up.
    await expect(t.svc.chooseStyle(S, '3d-animation')).rejects.toBeInstanceOf(
      StyleNotRequestedError,
    )
  })

  it('asks for fresh ideas: avoids the ideas earlier chats offered, varies topic and figure', async () => {
    const past: AgentQuestion[] = [
      {
        header: 'Idea',
        id: 'idea',
        isOther: true,
        isSecret: false,
        options: [
          {
            description: 'Wombats poop cubes.',
            label: 'Fun fact: Why Wombats Poop Cubes (Recommended)',
          },
          { description: 'Lincoln patented a boat lift.', label: "Famous figure: Lincoln's Boat" },
        ],
        question: 'Which idea should we make?',
      },
    ]
    const t = makeService(
      [JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)],
      {
        pastQuestions: past,
        random: () => 0.99,
      },
    )
    await toStyleRequest(t, 'my own idea')

    expect(t.sessions.pastQuestions).toHaveBeenCalledWith('Idea')
    expect(t.sessions.runQuietTurn.mock.calls[0][1]).toBe(
      IDEAS_PROMPT('2026-10-01', {
        avoid: [
          { hook: 'Wombats poop cubes.', title: 'Why Wombats Poop Cubes' },
          { hook: 'Lincoln patented a boat lift.', title: "Lincoln's Boat" },
        ],
        figureKind: FIGURE_KINDS.at(-1)!,
        funFactTopic: FUN_FACT_TOPICS.at(-1)!,
      }),
    )
  })

  it('asks how the video should start after the brief, before the style request', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await waitFor(() => t.isOpen('autonomous-opening-'))

    expect(t.sessions.runQuietTurn.mock.calls[2]).toEqual([
      S,
      OPENINGS_PROMPT(BRIEF),
      { effort: 'medium', outputSchema: OPENINGS_SCHEMA },
    ])
    const card = t.events.findLast((e) => e.type === 'question')
    expect(card).toMatchObject({
      questions: [
        {
          header: 'Attention hook',
          id: 'opening',
          info: ATTENTION_HOOK_INFO,
          isOther: true,
          options: [
            { description: 'Everyone looks up.', label: FIRST_OPENING },
            {
              description: 'A huge number.',
              label: 'Shock number: Ten thousand years for one fly-by.',
            },
            {
              description: 'Corrects a belief.',
              label: 'Myth-bust: Comets are dirty snowballs. Not quite.',
            },
          ],
          question: 'Pick a video opener for the attention hook',
        },
      ],
    })
    expect(t.events.some((e) => e.type === 'style_request')).toBe(false)

    t.answer('autonomous-opening-', 'Shock number: Ten thousand years for one fly-by.')
    await answerCamera(t)
    await answerMusic(t)
    await run
    expect(t.events.at(-1)).toEqual({ type: 'style_request' })
    expect(t.session.autonomous?.opening).toBe('Ten thousand years for one fly-by.')
  })

  it('uses a typed opening as written, trimmed and unquoted, for the script', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    await toStyleRequest(t, 'my own idea', '  "Look up tonight."  ')
    expect(t.session.autonomous?.opening).toBe('Look up tonight.')

    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.writeScript).toHaveBeenCalledWith(
      expect.objectContaining({ opening: 'Look up tonight.' }),
    )
  })

  it('asks for the camera style after the attention hook and before the style', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await waitFor(() => t.isOpen('autonomous-camera-'))
    expect(t.events.some((e) => e.type === 'style_request')).toBe(false)
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-camera-'))!
    expect(card.questions[0]).toMatchObject({
      header: 'Camera style',
      id: 'camera',
      isOther: false,
    })
    expect(card.questions[0].options?.map((o) => o.label)).toEqual(['Dynamic', 'Calm', 'Beat loop'])
    expect(card.questions[0].info).toBeTruthy()
    // Each option carries its sample clip and poster from the preset pack, as addresses: the
    // card is kept in the transcript, and its URLs are built as it is sent to the browser.
    expect(card.questions[0].options?.map((o) => o.sample)).toEqual(
      ['dynamic', 'calm', 'beat-loop'].map((id) => ({
        posterUrl: `preset://v9/camera-samples/${id}.jpg`,
        videoUrl: `preset://v9/camera-samples/${id}.mp4`,
      })),
    )
    t.answer('autonomous-camera-', 'Calm')
    await answerLength(t)
    await answerMusic(t)
    await run
    expect(t.session.autonomous?.cameraStyle).toBe('calm')
    expect(t.events.some((e) => e.type === 'style_request')).toBe(true)
  })

  it('asks how long the video should be right after the camera card: 30 s first and recommended', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await waitFor(() => t.isOpen('autonomous-camera-'))
    t.answer('autonomous-camera-', 'Calm')
    await waitFor(() => t.isOpen('autonomous-length-'))
    // The length card comes before the music card, and the music card waits for it.
    expect(t.isOpen('autonomous-music-')).toBe(false)
    const card = t.events.findLast((e) => e.type === 'question')
    expect(card).toMatchObject({ questionId: 'autonomous-length-4' })
    const [question] = (card as Extract<AgentUiEvent, { type: 'question' }>).questions
    expect(question).toMatchObject({
      header: 'Length',
      id: 'length',
      isOther: false,
      isSecret: false,
      question: 'How long should the video be?',
    })
    expect(question.info).toBeTruthy()
    expect(question.options.map((o) => o.label)).toEqual([
      '30 seconds (Recommended)',
      '45 seconds',
      '60 seconds',
    ])
    for (const option of question.options) expect(option.description).toBeTruthy()
    expect(question.options.map((o) => o.description).join(' ')).not.toMatch(/clip|loop/i)

    await answerLength(t, '45 seconds')
    await answerMusic(t)
    await run
    expect(t.session.autonomous).toMatchObject({ cameraStyle: 'calm', durationSeconds: 45 })
  })

  it('makes the video at the length picked: the plan, the script and the run all say 60 s, never 30 s', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await answerCamera(t, 'Dynamic', '60 seconds')
    await answerMusic(t)
    await run

    // The plan's header (the storyboard panel's brief) reads 60 s once the length is picked;
    // before it, the brief shows no length at all.
    const briefs = t.events.filter(
      (e): e is Extract<AgentUiEvent, { type: 'brief' }> => e.type === 'brief',
    )
    expect(briefs.map((b) => b.durationSeconds)).toEqual([undefined, 60])
    expect(briefs.at(-1)).toEqual({
      brief: BRIEF.brief,
      durationSeconds: 60,
      title: BRIEF.title,
      type: 'brief',
    })
    const shown = t.events
      .flatMap((e) => (e.type === 'message' || e.type === 'notice' ? [e.text] : []))
      .join('\n')
    expect(shown).not.toMatch(/\b30 ?s\b|30-second/)
    expect(t.session.autonomous).toMatchObject({ cameraStyle: 'dynamic', durationSeconds: 60 })

    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.writeScript).toHaveBeenCalledWith(expect.objectContaining({ durationSeconds: 60 }))
    expect(t.longTake.startWorkflow.mock.calls[0][25]).toBe(60) // targetDurationSeconds
  })

  it('Stop with the length card open ends the flow with one flow_cancelled, before music', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await waitFor(() => t.isOpen('autonomous-camera-'))
    t.answer('autonomous-camera-', 'Dynamic')
    await waitFor(() => t.isOpen('autonomous-length-'))

    t.cancelled.value = true
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-length-'))!
    card.reject(new AgentFlowCancelledError())
    await run

    expect(cancelledEvents(t.events)).toHaveLength(1)
    expect(t.isOpen('autonomous-music-')).toBe(false)
    expect(t.events.some((e) => e.type === 'style_request')).toBe(false)
  })

  it('creates the project with the picked camera style', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    await toStyleRequest(t, 'my own idea') // answers the camera card with 'Dynamic'
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.projects.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ cameraStyle: 'dynamic', enableCaption: true }),
      expect.anything(),
    )
  })

  it('asks for music after the camera style and before the style', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await answerCamera(t, 'Calm')
    await waitFor(() => t.isOpen('autonomous-music-'))
    expect(t.events.some((e) => e.type === 'style_request')).toBe(false)
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-music-'))!
    expect(card.questions[0]).toMatchObject({ header: 'Music', id: 'music', isOther: true })
    expect(card.questions[0].options?.map((o) => o.label)).toEqual([
      AUTO_MUSIC,
      'Upbeat',
      'Calm',
      'No music',
    ])
    // Only the camera card shows sample clips.
    expect(card.questions[0].options?.some((o) => 'sample' in o)).toBe(false)
    expect(card.questions[0].info).toBeTruthy()
    t.answer('autonomous-music-', 'Upbeat')
    await run
    expect(t.session.autonomous?.music).toEqual({ choice: 'upbeat' })
    expect(t.events.some((e) => e.type === 'style_request')).toBe(true)
  })

  it.each([
    ['Upbeat', { bgmEnabled: true, bgmSource: 'library', bgmTrackId: 'groovy-lofi' }],
    ['No music', { bgmEnabled: false }],
    ['lo-fi hip hop', { bgmEnabled: true, bgmNote: 'lo-fi hip hop' }],
  ])('creates the project with the music choice %s', async (pick, expected) => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await answerCamera(t)
    await answerMusic(t, pick)
    await run
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    const body = t.projects.createProject.mock.calls[0][0]
    expect(body).toMatchObject(expected)
    // No music means no wish is stored either.
    expect('bgmNote' in body).toBe('bgmNote' in expected)
  })

  it('Stop with the music card open ends the flow with one flow_cancelled', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await answerCamera(t)
    await waitFor(() => t.isOpen('autonomous-music-'))

    t.cancelled.value = true
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-music-'))!
    card.reject(new AgentFlowCancelledError())
    await run

    expect(cancelledEvents(t.events)).toHaveLength(1)
    expect(t.events.some((e) => e.type === 'style_request')).toBe(false)
  })

  it('a typed refusal on the music card means no music', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await answerCamera(t)
    await answerMusic(t, 'no music please')
    await run
    expect(t.session.autonomous?.music).toEqual({ choice: 'off' })
  })

  it('Stop with the camera card open ends the flow with one flow_cancelled', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await waitFor(() => t.isOpen('autonomous-camera-'))

    t.cancelled.value = true
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-camera-'))!
    card.reject(new AgentFlowCancelledError())
    await run

    expect(cancelledEvents(t.events)).toHaveLength(1)
    expect(t.events.some((e) => e.type === 'style_request')).toBe(false)
  })

  it('Stop with the opening card open ends the flow with one flow_cancelled', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await waitFor(() => t.isOpen('autonomous-opening-'))

    t.cancelled.value = true
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-opening-'))!
    card.reject(new AgentFlowCancelledError())
    await run

    expect(cancelledEvents(t.events)).toHaveLength(1)
    expect(t.events.some((e) => e.type === 'style_request')).toBe(false)
  })

  it('passes a free-text idea to the polish prompt as typed', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    await toStyleRequest(t, 'my own idea')

    expect(t.sessions.runQuietTurn.mock.calls[1][1]).toBe(POLISH_PROMPT('my own idea'))
  })

  it('names the chat after the picked idea', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    await toStyleRequest(t, 'Fun fact: Octopus hearts (Recommended)')
    expect(t.sessions.titleChat).toHaveBeenCalledWith(S, 'Octopus hearts')
  })

  it("names the chat after the user's own idea", async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    await toStyleRequest(t, 'A song about my cat')
    expect(t.sessions.titleChat).toHaveBeenCalledWith(S, 'A song about my cat')
  })

  it('retries a failed ideas step once, then offers "Try again", which re-runs it', async () => {
    const t = makeService([
      new Error('Codex turn failed'),
      'not json',
      JSON.stringify(IDEAS),
      JSON.stringify(BRIEF),
      JSON.stringify(OPENINGS),
    ])
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-retry-'))

    expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(2)
    expect(t.events.filter((e) => e.type === 'notice')).toEqual([
      { text: expect.stringMatching(/^Couldn't find ideas: /), type: 'notice' },
    ])
    const retry = t.events.find((e) => e.type === 'question')
    expect(retry).toMatchObject({
      questions: [{ isOther: false, options: [{ label: 'Try again' }] }],
    })

    t.answer('autonomous-retry-', 'Try again')
    await waitFor(() => t.isOpen('autonomous-idea-'))
    expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(3)
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await answerCamera(t)
    await answerMusic(t)
    await run
    expect(t.events.at(-1)).toEqual({ type: 'style_request' })
  })

  it('rejects a recent-news idea whose finding is older than the news window, then retries', async () => {
    const stale = {
      ideas: [IDEAS.ideas[0], { ...IDEAS.ideas[1], when: '2006-03-01' }, IDEAS.ideas[2]],
    }
    const t = makeService([
      JSON.stringify(stale),
      JSON.stringify(IDEAS),
      JSON.stringify(BRIEF),
      JSON.stringify(OPENINGS),
    ])
    await toStyleRequest(t, 'my own idea')
    expect(
      t.sessions.runQuietTurn.mock.calls.filter(([, text]) => text.startsWith('Find three')),
    ).toHaveLength(2)
    expect(t.events.some((e) => e.type === 'notice')).toBe(false)
  })

  it('rejects a recent-news idea without a real date', async () => {
    const undated = {
      ideas: [IDEAS.ideas[0], { ...IDEAS.ideas[1], when: 'recently' }, IDEAS.ideas[2]],
    }
    const t = makeService([JSON.stringify(undated), JSON.stringify(undated)])
    void t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-retry-'))
    expect(t.events.filter((e) => e.type === 'notice')).toEqual([
      { text: expect.stringMatching(/2026-09-17/), type: 'notice' },
    ])
  })

  it('rejects ideas that are not one per source', async () => {
    const twoFacts = {
      ideas: [IDEAS.ideas[0], { ...IDEAS.ideas[1], source: 'fun_fact' }, IDEAS.ideas[2]],
    }
    const t = makeService([
      JSON.stringify(twoFacts),
      JSON.stringify({ ideas: IDEAS.ideas.slice(1) }),
    ])
    void t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-retry-'))
    expect(t.events.filter((e) => e.type === 'notice')).toHaveLength(1)
  })

  it('emits the brief as a structured event right after its message, before the style request', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    await toStyleRequest(t, 'my own idea')

    const types = t.events.map((e) => e.type)
    const briefAt = types.indexOf('brief')
    // No length yet: the user picks it after the camera.
    expect(t.events[briefAt]).toEqual({ brief: BRIEF.brief, title: BRIEF.title, type: 'brief' })
    // The formatted message stays, just before it; the style request follows.
    expect(t.events[briefAt - 1]).toEqual({
      itemId: 'ly',
      text: `**${BRIEF.title}**\n\n${BRIEF.brief}`,
      type: 'message',
    })
    // Then the opening, camera and length cards, the brief at its length, the music card, then
    // the style request.
    expect(types.slice(briefAt + 1)).toEqual([
      'question',
      'question',
      'question',
      'brief',
      'question',
      'style_request',
    ])
    expect(t.events.findLast((e) => e.type === 'brief')).toEqual({
      brief: BRIEF.brief,
      durationSeconds: 30,
      title: BRIEF.title,
      type: 'brief',
    })
  })

  it('retries a bad brief once without bothering the user', async () => {
    const t = makeService([
      JSON.stringify(IDEAS),
      JSON.stringify({ ...BRIEF, title: ' ' }),
      JSON.stringify(BRIEF),
      JSON.stringify(OPENINGS),
    ])
    await toStyleRequest(t, 'my own idea')

    expect(t.events.some((e) => e.type === 'notice')).toBe(false)
    expect(t.session.autonomous).toEqual({
      ...BRIEF,
      cameraStyle: 'dynamic',
      music: { choice: 'auto' },
      opening: OPENINGS.openings[0].line,
    })
  })

  it('a step cancelled by shutdown (not by Stop) ends quietly, with no flow_cancelled', async () => {
    const t = makeService([new AgentFlowCancelledError('ReelMakeEasy is shutting down')])
    await expect(t.svc.start(S)).resolves.toBeUndefined()
    expect(t.events.map((e) => e.type)).toEqual(['message'])
    expect(t.sessions.endAutonomousFlow).toHaveBeenCalledWith(S)
  })

  it('Stop during a step ends the flow with one flow_cancelled', async () => {
    const t = makeService([new AgentFlowCancelledError()])
    t.cancelled.value = true
    await expect(t.svc.start(S)).resolves.toBeUndefined()
    expect(t.events.map((e) => e.type)).toEqual(['message', 'flow_cancelled'])
    expect(t.sessions.endAutonomousFlow).toHaveBeenCalledWith(S)
  })

  it('stops quietly when the user stops a step', async () => {
    const t = makeService([new AgentFlowCancelledError()])
    await expect(t.svc.start(S)).resolves.toBeUndefined()
    expect(t.events.map((e) => e.type)).toEqual(['message'])

    const u = makeService([JSON.stringify(IDEAS)])
    const run = u.svc.start(S)
    await waitFor(() => u.isOpen('autonomous-idea-'))
    const [, q] = [...u.open][0]
    u.cancelled.value = true
    q.reject(new AgentFlowCancelledError())
    await expect(run).resolves.toBeUndefined()
    expect(u.events.some((e) => e.type === 'notice' || e.type === 'style_request')).toBe(false)
    expect(cancelledEvents(u.events)).toEqual([{ type: 'flow_cancelled' }])
  })

  it('stops quietly, and ends the flow, when Stop lands between steps', async () => {
    const t = makeService([JSON.stringify(IDEAS)])
    t.sessions.runQuietTurn.mockImplementationOnce(async () => {
      t.cancelled.value = true // Stop pressed while the ideas turn ran
      return JSON.stringify(IDEAS)
    })

    await expect(t.svc.start(S)).resolves.toBeUndefined()

    expect(t.events.some((e) => e.type === 'question')).toBe(false)
    expect(t.sessions.endAutonomousFlow).toHaveBeenCalledWith(S)
    expect(t.session.flowActive).toBe(false)
    expect(cancelledEvents(t.events)).toEqual([{ type: 'flow_cancelled' }])
  })

  it('Stop while waiting for a style ends the flow; the style route then answers 409', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    await toStyleRequest(t, 'my own idea')

    t.svc.cancel(S)
    t.svc.cancel(S) // a second Stop changes nothing

    expect(t.sessions.endAutonomousFlow).toHaveBeenCalledWith(S)
    // The open style card expires through this event.
    expect(cancelledEvents(t.events)).toEqual([{ type: 'flow_cancelled' }])
    expect(t.events.at(-1)).toEqual({ type: 'flow_cancelled' })
    await expect(t.svc.chooseStyle(S, '3d-animation')).rejects.toBeInstanceOf(
      StyleNotRequestedError,
    )
  })

  it('Stop after the style is chosen stops before the project or the workflow', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    await toStyleRequest(t, 'my own idea')
    t.cancelled.value = true

    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.session.flowActive === false)

    expect(t.projects.createProject).not.toHaveBeenCalled()
    expect(t.longTake.startWorkflow).not.toHaveBeenCalled()
    expect(t.events.some((e) => e.type === 'notice' || e.type === 'video_started')).toBe(false)
    expect(cancelledEvents(t.events)).toEqual([{ type: 'flow_cancelled' }])
    expect(t.session.status).toBe('idle')
  })

  it('Stop on the video "Try again" card ends the flow with one flow_cancelled', async () => {
    const startWorkflow = jest.fn().mockRejectedValue(new Error('boom'))
    const t = makeService(
      [JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)],
      { startWorkflow },
    )
    await toStyleRequest(t, 'my own idea')
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.isOpen('autonomous-retry-'))

    t.cancelled.value = true
    const [, q] = [...t.open].find(([id]) => id.startsWith('autonomous-retry-')) ?? []
    q?.reject(new AgentFlowCancelledError())
    await waitFor(() => t.session.flowActive === false)

    expect(cancelledEvents(t.events)).toEqual([{ type: 'flow_cancelled' }])
    expect(startWorkflow).toHaveBeenCalledTimes(1)
  })

  it('keeps the style request when reading the user fails', async () => {
    let calls = 0
    const t = makeService(
      [JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)],
      {
        user: () => {
          if (calls++ === 0) throw new Error('no request context')
          return USER
        },
      },
    )
    await toStyleRequest(t, 'my own idea')

    await expect(t.svc.chooseStyle(S, '3d-animation')).rejects.toThrow('no request context')
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
  })

  it('refuses a style nobody asked for, and an unknown style', async () => {
    const t = makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)])
    await expect(t.svc.chooseStyle(S, '3d-animation')).rejects.toBeInstanceOf(
      StyleNotRequestedError,
    )

    await toStyleRequest(t, 'my own idea')
    await expect(t.svc.chooseStyle(S, 'nope')).rejects.toBeInstanceOf(UnknownStyleError)
    // Still waiting for a (valid) style.
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
  })

  it('offers "Try again" when the video fails to start, reusing the project and the style', async () => {
    const startWorkflow = jest
      .fn()
      .mockRejectedValueOnce(new Error('Prompt or audio is required'))
      .mockResolvedValue({ projectId: 'p1', workflowId: 'w1' })
    const t = makeService(
      [JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)],
      { startWorkflow },
    )
    await toStyleRequest(t, 'my own idea')

    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.isOpen('autonomous-retry-'))
    expect(t.events.filter((e) => e.type === 'notice')).toEqual([
      { text: "Couldn't start the video: Prompt or audio is required", type: 'notice' },
    ])
    expect(t.events.some((e) => e.type === 'video_started')).toBe(false)

    t.answer('autonomous-retry-', 'Try again')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(startWorkflow).toHaveBeenCalledTimes(2)
    expect(startWorkflow.mock.calls[1][13]).toBe('Animation')
    expect(t.projects.createProject).toHaveBeenCalledTimes(1)
    expect(t.events.filter((e) => e.type === 'style_chosen')).toHaveLength(1)
    // Working while trying, idle while the "Try again" card waits, working again, idle at the end.
    expect(
      t.events.filter((e) => e.type === 'session').map((e) => (e as { status: string }).status),
    ).toEqual(['running', 'idle', 'running', 'idle'])
  })

  it('refuses with nothing to make the video, before the project or the script', async () => {
    const reason = 'Add FAL_KEY or GEMINI_API_KEY to .env, then restart'
    const refusal = `${GENERATION_NOT_SET_UP_MESSAGE}. ${reason}`
    const assertCanStart = jest.fn(() => {
      throw new ConflictException(refusal)
    })
    const t = makeService(
      [JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)],
      { assertCanStart },
    )
    await toStyleRequest(t, 'my own idea')

    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.isOpen('autonomous-retry-'))
    expect(t.events.filter((e) => e.type === 'notice')).toEqual([
      { text: `Couldn't start the video: ${refusal}`, type: 'notice' },
    ])
    expect(t.projects.createProject).not.toHaveBeenCalled()
    expect(t.writeScript).not.toHaveBeenCalled()
    expect(t.longTake.startWorkflow).not.toHaveBeenCalled()
  })
})

/** The card open now whose id starts with `prefix`: its id and questions. */
function openCard(t: ReturnType<typeof makeService>, prefix: string) {
  const [id, card] = [...t.open].find(([questionId]) => questionId.startsWith(prefix)) ?? []
  if (!id || !card) throw new Error(`no open question ${prefix}`)
  return { id, questions: card.questions }
}

/** ReelMakeEasy shuts down with the flow where it is; the cut-off flow ends quietly. */
async function shutDown(t: ReturnType<typeof makeService>, run?: Promise<void>) {
  t.shutDown()
  await run
  await flush()
  await flush()
}

/** The next process picks the flow up, as `AgentSessionService.resumeFlow` hands it over (the
 *  flow claimed again, in the working state) to a new flow service with nothing in memory.
 *  `mark`: where its events start in `t.events`. */
function pickUp(t: ReturnType<typeof makeService>) {
  const svc = t.build()
  Object.assign(t.session, { flowActive: true, interrupted: false })
  t.sessions.setFlowWorking(S, true)
  const mark = t.events.length
  const run = svc.resume(S)
  return { mark, run, svc }
}

/** The cards a picked-up flow asked, by question id. */
const askedSince = (t: ReturnType<typeof makeService>, mark: number) =>
  t.events.slice(mark).flatMap((e) => (e.type === 'question' ? [e.questionId] : []))

describe('Easy: picking up where it left off after a restart', () => {
  const replies = (...more: (Error | string)[]) => [
    JSON.stringify(IDEAS),
    ...more,
    JSON.stringify(BRIEF),
    JSON.stringify(OPENINGS),
  ]
  const COMET = 'Recent news: A comet you can see'

  it('idea card open: offers the same ideas again with no new search, and briefs the full idea', async () => {
    const t = makeService(replies())
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    const asked = openCard(t, 'autonomous-idea-')
    await shutDown(t, run)

    const { mark, run: resumed } = pickUp(t)
    await waitFor(() => t.isOpen('autonomous-idea-'))

    // The same card, fresh at the bottom, with an id of its own.
    expect(openCard(t, 'autonomous-idea-')).toEqual({ ...asked, id: 'autonomous-idea-2' })
    expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(1)
    expect(t.events.slice(mark)).toEqual([
      { status: 'idle', type: 'session' },
      { itemId: 'ly', text: 'Picking up where you left off.', type: 'message' },
      { questionId: 'autonomous-idea-2', questions: asked.questions, type: 'question' },
    ])

    t.answer('autonomous-idea-', COMET)
    await answerOpening(t)
    await answerCamera(t)
    await answerMusic(t)
    await resumed

    // The idea's date and source still reach the brief's fact check.
    expect(t.sessions.runQuietTurn.mock.calls[1][1]).toBe(
      POLISH_PROMPT(
        `${COMET}. A comet visible tonight without a telescope. (When: 2026-09-28) (Source: https://news.example/comet)`,
      ),
    )
    expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(3)
    expect(t.events.at(-1)).toEqual({ type: 'style_request' })
  })

  it('a step cut off mid-way runs again, from the answers it had: no new idea search', async () => {
    const t = makeService(replies(new AgentFlowCancelledError('ReelMakeEasy is shutting down')))
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', COMET)
    // The brief's turn ends as ReelMakeEasy shuts down.
    await shutDown(t, run)
    expect(t.session.autonomous).toBeUndefined()

    const { run: resumed } = pickUp(t)
    await answerOpening(t)

    const prompts = t.sessions.runQuietTurn.mock.calls.map(([, text]) => text)
    expect(prompts).toHaveLength(4)
    expect(prompts[2]).toBe(prompts[1])
    expect(prompts.filter((text) => text.startsWith('Find three'))).toHaveLength(1)
    await answerCamera(t)
    await answerMusic(t)
    await resumed
    expect(t.session.autonomous).toMatchObject({ title: BRIEF.title })
  })

  it('hook card open: asks the same openers again; the idea and its brief stay as they were', async () => {
    const t = makeService(replies())
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', COMET)
    await waitFor(() => t.isOpen('autonomous-opening-'))
    const asked = openCard(t, 'autonomous-opening-')
    const briefs = t.events.filter((e) => e.type === 'brief').length
    await shutDown(t, run)

    const { mark, run: resumed } = pickUp(t)
    await waitFor(() => t.isOpen('autonomous-opening-'))

    expect(openCard(t, 'autonomous-opening-')).toEqual({ ...asked, id: 'autonomous-opening-3' })
    expect(askedSince(t, mark)).toEqual(['autonomous-opening-3'])
    expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(3)
    t.answer('autonomous-opening-', 'Shock number: Ten thousand years for one fly-by.')
    await answerCamera(t)
    await answerMusic(t)
    await resumed

    expect(t.events.filter((e) => e.type === 'brief')).toHaveLength(briefs + 1)
    expect(t.session.autonomous).toEqual({
      ...BRIEF,
      cameraStyle: 'dynamic',
      music: { choice: 'auto' },
      opening: OPENINGS.openings[1].line,
    })
  })

  it('camera card open: asks it again, then on as if never cut off', async () => {
    const t = makeService(replies())
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', COMET)
    await answerOpening(t)
    await waitFor(() => t.isOpen('autonomous-camera-'))
    await shutDown(t, run)
    // Its button says only "Pick up where you left off": a card comes before anything is spent.
    expect(t.build().resumeAction(S)).toEqual({ kind: 'carry_on' })

    const { mark, run: resumed, svc } = pickUp(t)
    await waitFor(() => t.isOpen('autonomous-camera-'))
    expect(askedSince(t, mark)).toEqual(['autonomous-camera-4'])
    await answerCamera(t, 'Calm', '45 seconds')
    await answerMusic(t)
    await resumed
    await svc.chooseStyle(S, STYLE.id)
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))

    expect(askedSince(t, mark)).toEqual([
      'autonomous-camera-4',
      'autonomous-length-5',
      'autonomous-music-6',
    ])
    expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(3)
    expect(t.projects.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ cameraStyle: 'calm' }),
      { agentSessionId: S },
    )
    expect(t.writeScript).toHaveBeenCalledWith(
      expect.objectContaining({ durationSeconds: 45, opening: OPENINGS.openings[0].line }),
    )
    expect(t.session).toMatchObject({ flowActive: false, projectId: 'p1' })
  })

  it('length card open: keeps the camera picked, asks the length again', async () => {
    const t = makeService(replies())
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', COMET)
    await answerOpening(t)
    await waitFor(() => t.isOpen('autonomous-camera-'))
    t.answer('autonomous-camera-', 'Dynamic')
    await waitFor(() => t.isOpen('autonomous-length-'))
    await shutDown(t, run)

    const { mark, run: resumed } = pickUp(t)
    await answerLength(t, '60 seconds')
    await answerMusic(t)
    await resumed

    expect(askedSince(t, mark)).toEqual(['autonomous-length-5', 'autonomous-music-6'])
    expect(t.session.autonomous).toMatchObject({ cameraStyle: 'dynamic', durationSeconds: 60 })
    // The plan's brief at its new length, once.
    expect(t.events.slice(mark).filter((e) => e.type === 'brief')).toEqual([
      { brief: BRIEF.brief, durationSeconds: 60, title: BRIEF.title, type: 'brief' },
    ])
  })

  it('music card open: keeps the camera and length, asks for the music again', async () => {
    const t = makeService(replies())
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', COMET)
    await answerOpening(t)
    await answerCamera(t, 'Calm', '45 seconds')
    await waitFor(() => t.isOpen('autonomous-music-'))
    await shutDown(t, run)

    const { mark, run: resumed } = pickUp(t)
    await answerMusic(t, 'Upbeat')
    await resumed

    expect(askedSince(t, mark)).toEqual(['autonomous-music-6'])
    expect(t.events.slice(mark).some((e) => e.type === 'brief')).toBe(false)
    expect(t.session.autonomous).toEqual({
      ...BRIEF,
      cameraStyle: 'calm',
      durationSeconds: 45,
      music: { choice: 'upbeat' },
      opening: OPENINGS.openings[0].line,
    })
    expect(t.events.at(-1)).toEqual({ type: 'style_request' })
  })

  it('style picker open: opens it again, and the pick starts the video with every answer', async () => {
    const t = makeService(replies())
    await toStyleRequest(t, COMET)
    await shutDown(t)
    expect(t.build().resumeAction(S)).toEqual({ kind: 'carry_on' })

    const { mark, run: resumed, svc } = pickUp(t)
    await resumed

    expect(askedSince(t, mark)).toEqual([])
    expect(t.events.slice(mark).at(-1)).toEqual({ type: 'style_request' })
    await svc.chooseStyle(S, STYLE.id)
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(3)
    expect(t.projects.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ bgmEnabled: true, cameraStyle: 'dynamic' }),
      { agentSessionId: S },
    )
    expect(t.longTake.startWorkflow).toHaveBeenCalledTimes(1)
  })

  it('the video start failed and its "Try again" was open: asks it again, reusing the project and the script', async () => {
    const startWorkflow = jest
      .fn()
      .mockRejectedValueOnce(new Error('Prompt or audio is required'))
      .mockResolvedValue({ projectId: 'p1', workflowId: 'w1' })
    const t = makeService(replies(), { startWorkflow })
    await toStyleRequest(t, COMET)
    await t.svc.chooseStyle(S, STYLE.id)
    await waitFor(() => t.isOpen('autonomous-retry-'))
    await shutDown(t)
    // Its "Try again" card comes first: picking up starts nothing on its own.
    expect(t.build().resumeAction(S)).toEqual({ kind: 'carry_on' })

    const { mark, run: resumed } = pickUp(t)
    await resumed
    await waitFor(() => t.isOpen('autonomous-retry-'))
    // Nothing starts again until the user says so.
    expect(startWorkflow).toHaveBeenCalledTimes(1)
    expect(askedSince(t, mark)).toEqual(['autonomous-retry-7'])
    t.answer('autonomous-retry-', 'Try again')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))

    expect(startWorkflow).toHaveBeenCalledTimes(2)
    expect(startWorkflow.mock.calls[1][13]).toBe(STYLE.label)
    expect(t.projects.createProject).toHaveBeenCalledTimes(1)
    expect(t.writeScript).toHaveBeenCalledTimes(1)
    expect(t.events.filter((e) => e.type === 'style_chosen')).toHaveLength(1)
    expect(t.session).toMatchObject({ flowActive: false, projectId: 'p1' })
  })

  it('style picked, the video start cut off: picking up starts it at once, and says so', async () => {
    const t = makeService(replies())
    await toStyleRequest(t, COMET)
    // ReelMakeEasy stops while the start makes the project: nothing has started yet.
    t.projects.createProject.mockImplementationOnce(() => new Promise<never>(() => undefined))
    await t.svc.chooseStyle(S, STYLE.id)
    await waitFor(() => t.projects.createProject.mock.calls.length === 1)
    await shutDown(t)

    expect(t.build().resumeAction(S)).toEqual({ kind: 'start_video' })

    // And it does what it says: the video starts once, with no card first.
    const { mark, run: resumed } = pickUp(t)
    await resumed
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(askedSince(t, mark)).toEqual([])
    expect(t.longTake.startWorkflow).toHaveBeenCalledTimes(1)
  })

  it('an older chat that kept no ideas: the same card again, briefed from what it showed', async () => {
    const t = makeService(replies())
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    await shutDown(t, run)
    // Saved by a ReelMakeEasy from before the ideas were kept.
    delete t.session.easyProgress

    const { run: resumed } = pickUp(t)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', COMET)
    await answerOpening(t)

    expect(t.sessions.runQuietTurn.mock.calls[1][1]).toBe(
      POLISH_PROMPT(`${COMET}. A comet visible tonight without a telescope.`),
    )
    await answerCamera(t)
    await answerMusic(t)
    await resumed
    expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(3)
  })
})

describe('pastIdeas', () => {
  const card = (labels: string[]): AgentQuestion => ({
    header: 'Idea',
    id: 'idea',
    isOther: true,
    isSecret: false,
    options: labels.map((label) => ({ description: `${label} hook`, label })),
    question: 'Which idea should we make?',
  })

  it('strips the source tag and Recommended, keeps the hook, and lists each title once', () => {
    expect(
      pastIdeas([
        card(['Recent news: Mars Rocks (Recommended)', 'Fun fact: Wombat Cubes']),
        card(['Fun fact: wombat cubes', 'Famous figure: Lincoln']),
      ]),
    ).toEqual([
      { hook: 'Recent news: Mars Rocks (Recommended) hook', title: 'Mars Rocks' },
      { hook: 'Fun fact: Wombat Cubes hook', title: 'Wombat Cubes' },
      { hook: 'Famous figure: Lincoln hook', title: 'Lincoln' },
    ])
  })

  it('keeps at most 40, newest first', () => {
    const many = Array.from({ length: 50 }, (_, i) => `Fun fact: Idea ${i}`)
    const ideas = pastIdeas([card(many)])
    expect(ideas).toHaveLength(40)
    expect(ideas[0].title).toBe('Idea 0')
  })
})

describe('IDEAS_PROMPT', () => {
  const variety = { avoid: [], figureKind: 'an explorer', funFactTopic: 'the ocean' }

  it('asks for a fun fact on the drawn topic and a famous figure of the drawn kind', () => {
    const prompt = IDEAS_PROMPT('2026-10-01', variety)
    expect(prompt).toContain('fun_fact: a little-known, surprising fun fact about the ocean.')
    expect(prompt).toContain('who is an explorer')
    expect(prompt).not.toContain('already offered')
  })

  it('lists earlier ideas to avoid, with their hooks', () => {
    const prompt = IDEAS_PROMPT('2026-10-01', {
      ...variety,
      avoid: [{ hook: 'Wombats poop cubes.', title: 'Why Wombats Poop Cubes' }],
    })
    expect(prompt).toContain('already offered before')
    expect(prompt).toContain('- Why Wombats Poop Cubes: Wombats poop cubes.')
  })
})

describe('plainText', () => {
  it('strips link syntax and emphasis around whole words, nothing else', () => {
    expect(plainText('See [the comet](https://x.example/c) **tonight**, _really_.')).toBe(
      'See the comet tonight, really.',
    )
    expect(plainText('Rename `snake_case_name` in my_file_v2 and 2*3*4')).toBe(
      'Rename snake_case_name in my_file_v2 and 2*3*4',
    )
  })
})

describe('Autonomous mode over the real session service', () => {
  const FAKE = path.join(__dirname, '..', 'codex', '__fixtures__', 'fake-app-server.mjs')
  let services: AgentSessionService[] = []

  afterEach(() => {
    delete process.env.FAKE_LOG
    delete process.env.FAKE_REPLIES
    for (const svc of services) svc.onModuleDestroy()
    services = []
  })

  function wire(
    env: Record<string, string>,
    cold?: Promise<void>,
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'autonomous-e2e-')),
  ) {
    // The session service and the flow need each other, as in AgentModule.
    const ref: { flow?: AutonomousService } = {}
    const sessions = new AgentSessionService({
      autonomous: {
        cancel: (id) => ref.flow?.cancel(id),
        resume: (id) => (ref.flow as AutonomousService).resume(id),
        resumeAction: (id) => (ref.flow as AutonomousService).resumeAction(id),
        start: (id) => (ref.flow as AutonomousService).start(id),
      },
      root,
      spawnCodex: async (cwd) => {
        Object.assign(process.env, env)
        await cold
        return CodexRpcClient.spawn(process.execPath, [FAKE], { cwd })
      },
    })
    services.push(sessions)
    const longTake = {
      assertCanStart: jest.fn(),
      startWorkflow: jest.fn().mockResolvedValue({ projectId: 'p1' }),
    }
    const projects = { createProject: jest.fn().mockResolvedValue({ id: 'p1' }) }
    const flow = new AutonomousService({
      agentProjects: { add: jest.fn() },
      findStyle: (id) => (id === STYLE.id ? STYLE : null),
      longTake: longTake as never,
      now: () => TODAY,
      projects,
      sessions,
      user: () => USER,
      writeScript: jest.fn().mockResolvedValue('Look up tonight.'),
    })
    ref.flow = flow
    return { flow, longTake, projects, root, sessions }
  }

  it('picks up a chat a shutdown cut off at its camera card, with no step made again', async () => {
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'autonomous-e2e-log-')), 'l.jsonl')
    const turns = () =>
      fs
        .readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .filter((l) => (JSON.parse(l) as { method?: string }).method === 'turn/start').length
    const first = wire({
      FAKE_LOG: log,
      FAKE_REPLIES: JSON.stringify([
        JSON.stringify(IDEAS),
        JSON.stringify(BRIEF),
        JSON.stringify(OPENINGS),
      ]),
    })
    const { id } = await first.sessions.createSession()
    const events: AgentUiEvent[] = []
    first.sessions.subscribe(id, 0, (e) => events.push(e))
    const asked =
      (questionId: string, list = events) =>
      () =>
        list.some((e) => e.type === 'question' && e.questionId === questionId)
    await first.sessions.chooseMode(id, 'autonomous')
    await waitFor(asked('autonomous-idea-1'), 5000)
    first.sessions.answerQuestion(id, 'autonomous-idea-1', { idea: ['my own idea'] })
    await waitFor(asked('autonomous-opening-2'), 5000)
    first.sessions.answerQuestion(id, 'autonomous-opening-2', { opening: [FIRST_OPENING] })
    await waitFor(asked('autonomous-camera-3'), 5000)

    first.sessions.onModuleDestroy()
    services = services.filter((s) => s !== first.sessions)
    await flush()
    expect(first.sessions.getSession(id)).toMatchObject({
      flowActive: false,
      interrupted: true,
      status: 'stopped',
    })
    expect(turns()).toBe(3)

    // The next start of ReelMakeEasy, on the same data.
    const next = wire({ FAKE_LOG: log }, undefined, first.root)
    expect(next.sessions.getSession(id).interrupted).toBe(true)
    // The chat's view: its card is asked again, so the button says only "Pick up where you left off".
    expect(next.sessions.sessionView(id).resume).toEqual({ kind: 'carry_on' })
    const replay: AgentUiEvent[] = []
    next.sessions.subscribe(id, 0, (e) => replay.push(e))
    const mark = replay.length

    next.sessions.resumeFlow(id)
    await waitFor(asked('autonomous-camera-4', replay))
    expect(next.sessions.getSession(id)).toMatchObject({ flowActive: true, interrupted: false })
    expect(next.sessions.sessionView(id).resume).toBeUndefined()
    expect(() => next.sessions.resumeFlow(id)).toThrow(FlowActiveError)
    next.sessions.answerQuestion(id, 'autonomous-camera-4', { camera: ['Dynamic'] })
    await waitFor(asked('autonomous-length-5', replay))
    next.sessions.answerQuestion(id, 'autonomous-length-5', { length: [STORY_LENGTH] })
    await waitFor(asked('autonomous-music-6', replay))
    next.sessions.answerQuestion(id, 'autonomous-music-6', { music: [AUTO_MUSIC] })
    await waitFor(() => replay.some((e) => e.type === 'style_request'))
    await next.flow.chooseStyle(id, STYLE.id)
    await waitFor(() => replay.some((e) => e.type === 'video_started'))

    // Only the camera card and the ones after it were asked; no turn ran again.
    expect(
      replay.slice(mark).flatMap((e) => (e.type === 'question' ? [e.questionId] : [])),
    ).toEqual(['autonomous-camera-4', 'autonomous-length-5', 'autonomous-music-6'])
    expect(turns()).toBe(3)
    expect(next.longTake.startWorkflow).toHaveBeenCalledTimes(1)
    expect(next.sessions.getSession(id)).toMatchObject({ flowActive: false, projectId: 'p1' })
    // Its video started: nothing more to pick up.
    expect(() => next.sessions.resumeFlow(id)).toThrow(NotResumableError)
  })

  it("a story video whose start a shutdown cut off: the chat's view says picking up starts it, and it starts once", async () => {
    const first = wire({
      FAKE_REPLIES: JSON.stringify([
        JSON.stringify(IDEAS),
        JSON.stringify(BRIEF),
        JSON.stringify(OPENINGS),
      ]),
    })
    const { id } = await first.sessions.createSession()
    const events: AgentUiEvent[] = []
    first.sessions.subscribe(id, 0, (e) => events.push(e))
    const answer = async (questionId: string, answers: AgentAnswers, list = events) => {
      await waitFor(
        () => list.some((e) => e.type === 'question' && e.questionId === questionId),
        5000,
      )
      first.sessions.answerQuestion(id, questionId, answers)
    }
    await first.sessions.chooseMode(id, 'autonomous')
    await answer('autonomous-idea-1', { idea: ['my own idea'] })
    await answer('autonomous-opening-2', { opening: [FIRST_OPENING] })
    await answer('autonomous-camera-3', { camera: ['Dynamic'] })
    await answer('autonomous-length-4', { length: [STORY_LENGTH] })
    await answer('autonomous-music-5', { music: [AUTO_MUSIC] })
    await waitFor(() => events.some((e) => e.type === 'style_request'), 5000)
    // ReelMakeEasy stops while the start makes the project: nothing has started yet.
    first.projects.createProject.mockImplementationOnce(() => new Promise<never>(() => undefined))
    await first.flow.chooseStyle(id, STYLE.id)
    await waitFor(() => first.projects.createProject.mock.calls.length === 1)
    first.sessions.onModuleDestroy()
    services = services.filter((s) => s !== first.sessions)
    await flush()

    const next = wire({}, undefined, first.root)
    expect(next.sessions.sessionView(id)).toMatchObject({
      interrupted: true,
      resume: { kind: 'start_video' },
    })
    // Only the view says it: the saved chat never keeps it.
    expect(next.sessions.getSession(id).resume).toBeUndefined()

    const replay: AgentUiEvent[] = []
    next.sessions.subscribe(id, 0, (e) => replay.push(e))
    const mark = replay.length
    next.sessions.resumeFlow(id)
    expect(() => next.sessions.resumeFlow(id)).toThrow(FlowActiveError)
    await waitFor(() => replay.some((e) => e.type === 'video_started'))

    expect(replay.slice(mark).some((e) => e.type === 'question')).toBe(false)
    expect(next.longTake.startWorkflow).toHaveBeenCalledTimes(1)
    expect(next.sessions.sessionView(id).resume).toBeUndefined()
  })

  it('locks the chat from the mode pick on, through the video start', async () => {
    const { flow, sessions } = wire({
      FAKE_REPLIES: JSON.stringify([
        JSON.stringify(IDEAS),
        JSON.stringify(BRIEF),
        JSON.stringify(OPENINGS),
      ]),
    })
    const { id } = await sessions.createSession()
    const events: AgentUiEvent[] = []
    sessions.subscribe(id, 0, (e) => events.push(e))

    await sessions.chooseMode(id, 'autonomous')
    await waitFor(() => events.some((e) => e.type === 'question'), 5000)
    // No raw JSON in the chat: the only messages are ReelMakeEasy's.
    expect(
      events.filter((e) => e.type === 'message').map((e) => (e as { itemId: string }).itemId),
    ).toEqual([expect.stringMatching(/^ly-/)])
    await expect(sessions.sendMessage(id, 'hi')).rejects.toBeInstanceOf(FlowActiveError)

    sessions.answerQuestion(id, 'autonomous-idea-1', { idea: ['my own idea'] })
    await waitFor(
      () => events.some((e) => e.type === 'question' && e.questionId === 'autonomous-opening-2'),
      5000,
    )
    sessions.answerQuestion(id, 'autonomous-opening-2', { opening: [FIRST_OPENING] })
    await waitFor(
      () => events.some((e) => e.type === 'question' && e.questionId === 'autonomous-camera-3'),
      5000,
    )
    sessions.answerQuestion(id, 'autonomous-camera-3', { camera: ['Dynamic'] })
    await waitFor(
      () => events.some((e) => e.type === 'question' && e.questionId === 'autonomous-length-4'),
      5000,
    )
    sessions.answerQuestion(id, 'autonomous-length-4', { length: [STORY_LENGTH] })
    await waitFor(
      () => events.some((e) => e.type === 'question' && e.questionId === 'autonomous-music-5'),
      5000,
    )
    sessions.answerQuestion(id, 'autonomous-music-5', { music: [AUTO_MUSIC] })
    await waitFor(() => events.some((e) => e.type === 'style_request'), 5000)
    await expect(sessions.sendMessage(id, 'hi')).rejects.toBeInstanceOf(FlowActiveError)
    await flow.chooseStyle(id, STYLE.id)
    await waitFor(() => events.some((e) => e.type === 'video_started'))

    expect(sessions.getSession(id)).toMatchObject({ flowActive: false, projectId: 'p1' })
    // Once its video started, the session is done: chat stays closed.
    await expect(sessions.sendMessage(id, 'thanks!')).rejects.toBeInstanceOf(ModeNotChattableError)
    expect(events.some((e) => e.type === 'flow_cancelled')).toBe(false)
  })

  it('Stop with the idea card open: the card expires, one flow_cancelled, flow over', async () => {
    const { sessions } = wire({ FAKE_REPLIES: JSON.stringify([JSON.stringify(IDEAS)]) })
    const { id } = await sessions.createSession()
    const events: AgentUiEvent[] = []
    sessions.subscribe(id, 0, (e) => events.push(e))
    await sessions.chooseMode(id, 'autonomous')
    await waitFor(() => events.some((e) => e.type === 'question'), 5000)

    await sessions.interrupt(id)
    await waitFor(() => sessions.getSession(id).flowActive === false)
    await flush()

    expect(events.filter((e) => e.type === 'question_expired')).toHaveLength(1)
    expect(cancelledEvents(events)).toHaveLength(1)
  })

  it('Stop with the length card open: the card expires, one flow_cancelled, no music card', async () => {
    const { sessions } = wire({
      FAKE_REPLIES: JSON.stringify([
        JSON.stringify(IDEAS),
        JSON.stringify(BRIEF),
        JSON.stringify(OPENINGS),
      ]),
    })
    const { id } = await sessions.createSession()
    const events: AgentUiEvent[] = []
    sessions.subscribe(id, 0, (e) => events.push(e))
    await sessions.chooseMode(id, 'autonomous')
    await waitFor(() => events.some((e) => e.type === 'question'), 5000)
    sessions.answerQuestion(id, 'autonomous-idea-1', { idea: ['my own idea'] })
    await waitFor(
      () => events.some((e) => e.type === 'question' && e.questionId === 'autonomous-opening-2'),
      5000,
    )
    sessions.answerQuestion(id, 'autonomous-opening-2', { opening: [FIRST_OPENING] })
    await waitFor(
      () => events.some((e) => e.type === 'question' && e.questionId === 'autonomous-camera-3'),
      5000,
    )
    sessions.answerQuestion(id, 'autonomous-camera-3', { camera: ['Calm'] })
    await waitFor(
      () => events.some((e) => e.type === 'question' && e.questionId === 'autonomous-length-4'),
      5000,
    )

    await sessions.interrupt(id)
    await waitFor(() => sessions.getSession(id).flowActive === false)
    await flush()

    expect(events.filter((e) => e.type === 'question_expired')).toEqual([
      expect.objectContaining({ questionId: 'autonomous-length-4' }),
    ])
    expect(cancelledEvents(events)).toHaveLength(1)
    expect(events.some((e) => e.type === 'question' && /music/.test(e.questionId))).toBe(false)
  })

  it('Stop with the style card open: one flow_cancelled, flow over, style route 409s', async () => {
    const { flow, sessions } = wire({
      FAKE_REPLIES: JSON.stringify([
        JSON.stringify(IDEAS),
        JSON.stringify(BRIEF),
        JSON.stringify(OPENINGS),
      ]),
    })
    const { id } = await sessions.createSession()
    const events: AgentUiEvent[] = []
    sessions.subscribe(id, 0, (e) => events.push(e))
    await sessions.chooseMode(id, 'autonomous')
    await waitFor(() => events.some((e) => e.type === 'question'), 5000)
    sessions.answerQuestion(id, 'autonomous-idea-1', { idea: ['my own idea'] })
    await waitFor(
      () => events.some((e) => e.type === 'question' && e.questionId === 'autonomous-opening-2'),
      5000,
    )
    sessions.answerQuestion(id, 'autonomous-opening-2', { opening: [FIRST_OPENING] })
    await waitFor(
      () => events.some((e) => e.type === 'question' && e.questionId === 'autonomous-camera-3'),
      5000,
    )
    sessions.answerQuestion(id, 'autonomous-camera-3', { camera: ['Dynamic'] })
    await waitFor(
      () => events.some((e) => e.type === 'question' && e.questionId === 'autonomous-length-4'),
      5000,
    )
    sessions.answerQuestion(id, 'autonomous-length-4', { length: [STORY_LENGTH] })
    await waitFor(
      () => events.some((e) => e.type === 'question' && e.questionId === 'autonomous-music-5'),
      5000,
    )
    sessions.answerQuestion(id, 'autonomous-music-5', { music: [AUTO_MUSIC] })
    await waitFor(() => events.some((e) => e.type === 'style_request'), 5000)

    await sessions.interrupt(id)
    await sessions.interrupt(id) // the flow is over: a second Stop adds nothing

    expect(sessions.getSession(id).flowActive).toBe(false)
    expect(cancelledEvents(events)).toHaveLength(1)
    expect(events.at(-1)).toMatchObject({ type: 'flow_cancelled' })
    await expect(flow.chooseStyle(id, STYLE.id)).rejects.toBeInstanceOf(StyleNotRequestedError)
  })

  it('Stop during the ideas turn cold start: no turn, no idea card, one flow_cancelled', async () => {
    let release: () => void = () => undefined
    const cold = new Promise<void>((r) => (release = r))
    const log = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'autonomous-e2e-log-')), 'l.jsonl')
    const { sessions } = wire({ FAKE_LOG: log }, cold)
    const { id } = await sessions.createSession()
    const events: AgentUiEvent[] = []
    sessions.subscribe(id, 0, (e) => events.push(e))

    await sessions.chooseMode(id, 'autonomous')
    await waitFor(() => events.some((e) => e.type === 'message'))
    await sessions.interrupt(id)
    release()
    await waitFor(() => sessions.getSession(id).flowActive === false, 5000)

    expect(events.some((e) => e.type === 'question' || e.type === 'notice')).toBe(false)
    expect(cancelledEvents(events)).toHaveLength(1)
    expect(sessions.getSession(id).status).toBe('idle')
    const methods = fs
      .readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => (JSON.parse(l) as { method?: string }).method)
    expect(methods).not.toContain('turn/start')
  })
})

describe('make_video (Free chat)', () => {
  it("a Claude chat's video plans on Claude", async () => {
    const t = makeService([])
    t.session.mode = 'free'
    t.session.flowActive = false
    t.session.harness = 'claude'
    t.svc.requestStyle(S, {
      brief: 'Moon caves',
      durationSeconds: 30,
      script: 'Did you know? Moon caves.',
      title: 'Moon caves',
    })
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.agentProjects.add).toHaveBeenCalledWith('p1', 'claude')
    const args = t.longTake.startWorkflow.mock.calls[0]
    expect((args[16] as { llm: { chatProvider: string } }).llm.chatProvider).toBe('claude')
  })

  it('requestStyle opens the style picker and the pick starts the video with the script as written', async () => {
    const t = makeService([])
    t.session.mode = 'free'
    t.session.flowActive = false
    t.svc.requestStyle(S, {
      brief: 'Moon caves',
      cameraStyle: 'dynamic',
      durationSeconds: 30,
      script: 'Did you know? Moon caves.',
      title: 'Moon caves',
    })
    expect(t.events.at(-1)).toEqual({ type: 'style_request' })
    // The storyboard panel shows the title and length while the picker waits.
    expect(t.events.at(-2)).toEqual({
      brief: '',
      durationSeconds: 30,
      title: 'Moon caves',
      type: 'brief',
    })
    // A second request while the card is open replaces the brief and opens no second card.
    const styleRequests = () => t.events.filter((e) => e.type === 'style_request')
    t.svc.requestStyle(S, {
      brief: 'Moon caves v2',
      durationSeconds: 30,
      script: 'Did you know? Moon caves, v2.',
      title: 'Moon caves v2',
    })
    expect(styleRequests()).toHaveLength(1)
    expect(t.events.at(-1)).toEqual(
      expect.objectContaining({ title: 'Moon caves v2', type: 'brief' }),
    )
    expect(t.session.autonomous?.script).toBe('Did you know? Moon caves, v2.')
    t.svc.requestStyle(S, {
      brief: 'Moon caves',
      cameraStyle: 'dynamic',
      durationSeconds: 30,
      script: 'Did you know? Moon caves.',
      title: 'Moon caves',
    })
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.writeScript).not.toHaveBeenCalled()
    expect(t.longTake.startWorkflow.mock.calls[0][2]).toBe('Did you know? Moon caves.')
    expect(t.projects.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ cameraStyle: 'dynamic', initialText: 'Moon caves' }),
      expect.anything(),
    )
    expect(t.sessions.linkProject).toHaveBeenCalledWith(S, expect.stringMatching(/\/projects\/p1$/))
    expect(t.session.flowActive).toBe(false)
  })
})

describe("the music card with a library and the user's own tracks", () => {
  const CATALOG = {
    library: [
      { id: 'bright-steps', title: 'Bright Steps' },
      { id: 'quiet-piano', title: 'Quiet Piano' },
    ],
    mine: [
      { aiGenerated: false, durationSec: 42, id: 't1', name: 'Brand theme' },
      { aiGenerated: true, durationSec: 31, id: 'a1', name: 'Curious Acoustic Echo' },
    ],
  }
  const withCatalog = (catalog = CATALOG) =>
    makeService([JSON.stringify(IDEAS), JSON.stringify(BRIEF), JSON.stringify(OPENINGS)], {
      music: { catalog: jest.fn(async () => catalog) },
    })
  const toMusicCard = async (t: ReturnType<typeof makeService>) => {
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await answerCamera(t)
    await waitFor(() => t.isOpen('autonomous-music-'))
    return { run }
  }

  it('offers the library and, when the user has tracks, their music', async () => {
    const t = withCatalog()
    const { run } = await toMusicCard(t)
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-music-'))!
    expect(card.questions[0].options?.find((o) => o.label === 'My music')?.description).toBe(
      'Your uploads and the music made for your videos.',
    )
    expect(card.questions[0].options?.map((o) => o.label)).toEqual([
      AUTO_MUSIC,
      'Upbeat',
      'Calm',
      'From the library',
      'My music',
      'No music',
    ])
    t.answer('autonomous-music-', 'Calm')
    await run
    const none = withCatalog({ ...CATALOG, mine: [] })
    const { run: run2 } = await toMusicCard(none)
    const [, card2] = [...none.open].find(([id]) => id.startsWith('autonomous-music-'))!
    expect(card2.questions[0].options?.map((o) => o.label)).not.toContain('My music')
    none.answer('autonomous-music-', 'Calm')
    await run2
  })

  it('"From the library" asks which track, and the pick becomes the project\'s track', async () => {
    const t = withCatalog()
    const { run } = await toMusicCard(t)
    t.answer('autonomous-music-', 'From the library')
    await waitFor(() => t.isOpen('autonomous-track-'))
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-track-'))!
    expect(card.questions[0].options?.map((o) => o.label)).toEqual(['Bright Steps', 'Quiet Piano'])
    t.answer('autonomous-track-', 'Quiet Piano')
    await run
    expect(t.session.autonomous?.music).toEqual({
      choice: 'auto',
      track: { id: 'quiet-piano', source: 'library' },
    })
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.projects.createProject.mock.calls[0][0]).toMatchObject({
      bgmEnabled: true,
      bgmSource: 'library',
      bgmTrackId: 'quiet-piano',
    })
  })

  it('"My music" lists the user\'s tracks; a title typed on the first card picks one too', async () => {
    const t = withCatalog()
    const { run } = await toMusicCard(t)
    t.answer('autonomous-music-', 'My music')
    await waitFor(() => t.isOpen('autonomous-track-'))
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-track-'))!
    expect(card.questions[0].options).toEqual([
      { description: '0:42', label: 'Brand theme' },
      { description: 'AI generated · 0:31', label: 'Curious Acoustic Echo' },
    ])
    t.answer('autonomous-track-', 'Brand theme')
    await run
    expect(t.session.autonomous?.music).toEqual({
      choice: 'auto',
      track: { id: 't1', source: 'upload' },
    })

    const typed = withCatalog()
    const { run: run2 } = await toMusicCard(typed)
    typed.answer('autonomous-music-', 'bright steps')
    await run2
    expect(typed.session.autonomous?.music).toEqual({
      choice: 'auto',
      track: { id: 'bright-steps', source: 'library' },
    })
  })
})

describe('make_beat_loop (Free chat)', () => {
  const LOOP_CARD = 'autonomous-loop-'

  function freeChat(over: Parameters<typeof makeService>[1] = {}) {
    const t = makeService([], over)
    t.session.mode = 'free'
    t.session.flowActive = false
    return t
  }
  const questionEvents = (events: AgentUiEvent[]) =>
    events.filter((e): e is Extract<AgentUiEvent, { type: 'question' }> => e.type === 'question')

  it('reports every storyboard issue at once, and asks nothing', async () => {
    const t = freeChat()
    const storyboard = loopStoryboard({ style: EXPLAINER_COLLAGE_STYLE })
    storyboard.clips[0] = { ...storyboard.clips[0], narration: 'Too short.' }
    storyboard.clips[2] = { ...storyboard.clips[2], freeze: 'The camera zooms in on the comb.' }

    const result = await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(storyboard) })

    expect(result).toEqual({
      format: 'beat_loop',
      issues: expect.arrayContaining([
        expect.stringMatching(/^clips\[0\]\.narration/),
        expect.stringMatching(/^clips\[2\]\.freeze/),
      ]),
      status: 'invalid',
      warnings: expect.any(Array),
    })
    expect(t.events).toEqual([])
    expect(t.sessions.recordAutonomous).not.toHaveBeenCalled()
    expect(t.longTake.checkBeatLoopLines).not.toHaveBeenCalled()
  })

  it('says every line in the voice before asking, and lists each line too long for its clip: no card', async () => {
    const t = freeChat({ checkBeatLoopLines: jest.fn(saidLines({ c2: 4.9 })) })
    const storyboard = loopStoryboard({ style: EXPLAINER_COLLAGE_STYLE })

    const result = await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(storyboard) })

    expect(t.longTake.checkBeatLoopLines).toHaveBeenCalledWith({
      shouldStop: expect.any(Function),
      storyboard,
      user: USER,
    })
    expect(result).toEqual({
      format: 'beat_loop',
      issues: [
        'clips[1].narration (c2): takes 4.9 s to say with Kokoro Heart and would need 1.42x speed; at most 1.3x fits the 3.45 s a line has. Aim for about 8 short words.',
      ],
      status: 'invalid',
      tooLong: [
        {
          clipId: 'c2',
          narration: 'Bees fan the nectar with their wings to dry it.',
          speedNeeded: 1.42,
          spokenSeconds: 4.9,
          target: 'about 8 short words',
        },
      ],
      voice: FREE_VOICE,
      warnings: [],
    })
    expect(t.events).toEqual([])
    expect(t.sessions.recordAutonomous).not.toHaveBeenCalled()
  })

  it('checks the lines before the style picker too, and says nothing fits in the reply', async () => {
    const t = freeChat({ checkBeatLoopLines: jest.fn(saidLines({ c1: 5, c4: 4.6 })) })

    const result = await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard()) })

    expect(result).toEqual(
      expect.objectContaining({
        issues: [
          expect.stringMatching(/^clips\[0\]\.narration \(c1\): takes 5\.0 s/),
          expect.stringMatching(/^clips\[3\]\.narration \(c4\): takes 4\.6 s/),
        ],
        status: 'invalid',
      }),
    )
    expect(t.events).toEqual([])
  })

  it('a Stop while the lines are said shows no card, and the check stops saying the rest', async () => {
    let stopSeen: boolean | undefined
    const checkBeatLoopLines = jest.fn(
      async (input: { shouldStop: () => boolean; storyboard: BeatLoopStoryboard }) => {
        // The user presses Stop while the voice is still saying the lines.
        t.cancelled.value = true
        stopSeen = input.shouldStop()
        return saidLines()(input)
      },
    )
    const t = freeChat({ checkBeatLoopLines })

    await expect(
      t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })) }),
    ).rejects.toBeInstanceOf(AgentFlowCancelledError)
    expect(stopSeen).toBe(true)
    expect(t.events).toEqual([])
    expect(t.sessions.recordAutonomous).not.toHaveBeenCalled()
    expect(t.sessions.askServerQuestion).not.toHaveBeenCalled()
  })

  it('a check that stopped for a Stop says the chat was stopped, not that the voice failed', async () => {
    const checkBeatLoopLines = jest.fn(async () => {
      t.cancelled.value = true
      throw new Error('Stopped before every line was said')
    })
    const t = freeChat({ checkBeatLoopLines })

    await expect(
      t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard()) }),
    ).rejects.toBeInstanceOf(AgentFlowCancelledError)
    expect(t.events).toEqual([])
  })

  it("asks nothing when the voice can't say the lines, and says why", async () => {
    const checkBeatLoopLines = jest
      .fn()
      .mockRejectedValue(new Error('Local kokoro failed (HTTP 500)'))
    const t = freeChat({ checkBeatLoopLines })

    await expect(
      t.svc.makeBeatLoop(S, {
        storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })),
      }),
    ).rejects.toThrow(
      "Couldn't say the narration lines to check they fit their clips: Local kokoro failed (HTTP 500). No card was shown: try again, or pass another voice.",
    )
    expect(t.events).toEqual([])
    expect(t.sessions.recordAutonomous).not.toHaveBeenCalled()
  })

  it('names the voice on the card, and says when it is free', async () => {
    const t = freeChat()
    const result = await t.svc.makeBeatLoop(S, {
      storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })),
    })
    expect(result).toEqual(expect.objectContaining({ voice: FREE_VOICE }))
    const [card] = questionEvents(t.events)
    expect(card.questions[0].options[0].description).toMatch(
      / Voice: Kokoro Heart, free on this computer\.$/,
    )

    // Another voice while the card is open: a new card names it.
    await t.svc.makeBeatLoop(S, {
      storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })),
      voice: 'Sarah',
    })
    const cards = questionEvents(t.events)
    expect(cards).toHaveLength(2)
    expect(cards[1].questions[0].options[0].description).toMatch(/ Voice: Sarah\.$/)
    t.answer(LOOP_CARD, 'Make it')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.longTake.startBeatLoop).toHaveBeenCalledWith(
      expect.objectContaining({ voice: 'Sarah' }),
    )
  })

  it('makes the loop in the voice the lines were said in, a free one when none is named', async () => {
    const t = freeChat()
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard()) })
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.longTake.startBeatLoop).toHaveBeenCalledWith(
      expect.objectContaining({ voice: 'kokoro-af_heart' }),
    )
  })

  it('asks "Make this 16-second loop? About $0.80" for a styled storyboard, and "Make it" makes it', async () => {
    const t = freeChat()
    const storyboard = loopStoryboard({ style: EXPLAINER_COLLAGE_STYLE })

    const result = await t.svc.makeBeatLoop(S, {
      storyboard: JSON.stringify(storyboard),
      title: 'Honey keeps',
      voice: 'Rachel',
    })

    expect(result).toEqual({
      card: { buttons: ['Make it', 'Not now'], question: 'Make this 16-second loop? About $0.80' },
      clipUsd: 0.16,
      clips: 4,
      durationSeconds: 16,
      estimatedCostUsd: 0.8,
      format: 'beat_loop',
      model: 'MiniMax Hailuo 3',
      next: expect.stringContaining('until the user clicks "Make it"'),
      status: 'waiting_for_make_it',
      voice: { free: false, id: 'Rachel', name: 'Rachel' },
      warnings: [],
    })
    expect(t.estimateLoop).toHaveBeenCalledWith(4)
    expect(t.longTake.checkBeatLoopLines).toHaveBeenCalledWith({
      shouldStop: expect.any(Function),
      storyboard: { ...storyboard, title: 'Honey keeps' },
      user: USER,
      voice: 'Rachel',
    })
    const stored = { ...storyboard, title: 'Honey keeps' }
    expect(t.session.autonomous).toEqual({
      brief: 'Honey keeps',
      durationSeconds: 16,
      format: 'beat_loop',
      storyboard: stored,
      title: 'Honey keeps',
    })
    const [card] = questionEvents(t.events)
    expect(card.questions[0].question).toBe('Make this 16-second loop? About $0.80')
    expect(card.questions[0].options.map((o) => o.label)).toEqual(['Make it', 'Not now'])
    // In a chat the user can still change the storyboard.
    expect(card.questions[0].options[1].description).toBe(
      'Nothing is spent. Change the storyboard first.',
    )
    expect(t.projects.createProject).not.toHaveBeenCalled()

    t.answer(LOOP_CARD, 'Make it')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))

    expect(t.projects.createProject).toHaveBeenCalledWith(
      {
        bgmEnabled: false,
        createUseCase: 'beat-loop',
        enableCaption: true,
        // The project, and so the chat's row, is named after the storyboard's title, not its
        // first line (as make_video's project is named after its title).
        initialText: 'Honey keeps',
        isLongTake: true,
        longTakeInput: 'transcript',
        longTakeRatio: '9:16',
        styleName: 'Explainer collage',
        styleText: EXPLAINER_COLLAGE_STYLE,
      },
      { agentSessionId: S },
    )
    expect(t.agentProjects.add).toHaveBeenCalledWith('p1', 'codex')
    expect(t.longTake.startBeatLoop).toHaveBeenCalledWith({
      debugSettings: { llm: { chatProvider: 'codex' } },
      projectId: 'p1',
      storyboard: stored,
      style: EXPLAINER_COLLAGE_STYLE,
      styleName: 'Explainer collage',
      user: USER,
      voice: 'Rachel',
    })
    expect(t.longTake.startWorkflow).not.toHaveBeenCalled()
    expect(t.writeScript).not.toHaveBeenCalled()
    expect(t.sessions.linkProject).toHaveBeenCalledWith(S, expect.stringMatching(/\/projects\/p1$/))
    expect(t.session.projectId).toBe('p1')
  })

  it("names the other provider's model on the card and in the reply, with what a clip costs there", async () => {
    const t = freeChat()
    t.estimateLoop.mockReturnValueOnce({
      ...LOOP_ESTIMATE,
      fallback: {
        clipUsd: 0.42,
        model: 'omni-flash-google',
        modelLabel: 'Gemini Omni Flash',
        provider: 'google',
      },
    })

    const result = await t.svc.makeBeatLoop(S, {
      storyboard: JSON.stringify(loopStoryboard({ style: EXPLAINER_COLLAGE_STYLE })),
    })

    expect(result).toEqual(
      expect.objectContaining({
        fallback: { clipUsd: 0.42, model: 'Gemini Omni Flash' },
        model: 'MiniMax Hailuo 3',
      }),
    )
    const [card] = questionEvents(t.events)
    expect(card.questions[0].options[0].description).toBe(
      "4 clips of 4 s on MiniMax Hailuo 3, in the storyboard's style. A clip made again costs about $0.16. A clip MiniMax Hailuo 3 fails to make is made with Gemini Omni Flash instead, at about $0.42. Voice: Kokoro Heart, free on this computer.",
    )
  })

  it('"Not now" spends nothing and ends the card', async () => {
    const t = freeChat()
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })) })

    t.answer(LOOP_CARD, 'Not now')
    await flush()

    expect(t.projects.createProject).not.toHaveBeenCalled()
    expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()
    expect(t.events.filter((e) => e.type === 'notice')).toEqual([
      { text: 'The loop was not made.', type: 'notice' },
    ])
  })

  it('shows the storyboard in the side panel: its title, length, and each line with its stamp', async () => {
    const t = freeChat()
    const lines = LOOP_CLIPS.slice(0, 4).map(({ narration, stamp }) => ({ narration, stamp }))
    const brief = {
      brief: '4 clips of 4 s, replaying as a loop',
      durationSeconds: 16,
      lines,
      title: 'Honey keeps',
      type: 'brief',
    }

    await t.svc.makeBeatLoop(S, {
      storyboard: JSON.stringify(loopStoryboard({ style: EXPLAINER_COLLAGE_STYLE })),
      title: 'Honey keeps',
    })
    // Before the card, so the panel has the lines while the user decides.
    expect(t.events.map((e) => e.type)).toEqual(['brief', 'question'])
    expect(t.events[0]).toEqual(brief)

    // A revised storyboard (here without a style: the picker) shows its own lines.
    const revised = loopStoryboard()
    revised.clips[1] = { ...revised.clips[1], stamp: 'WINGS' }
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(revised) })
    const briefs = t.events.filter((e) => e.type === 'brief')
    expect(briefs.at(-1)).toEqual({
      ...brief,
      lines: [lines[0], { ...lines[1], stamp: 'WINGS' }, lines[2], lines[3]],
      title: 'Honey never spoils',
    })
    expect(t.events.at(-1)).toEqual({ type: 'style_request' })
  })

  it("a story video started after a loop's storyboard replaces the loop's lines in the panel", async () => {
    const t = freeChat()
    await t.svc.makeBeatLoop(S, {
      storyboard: JSON.stringify(loopStoryboard({ style: EXPLAINER_COLLAGE_STYLE })),
    })

    t.svc.requestStyle(S, {
      brief: 'Did you know? Honey keeps.',
      durationSeconds: 30,
      script: 'Did you know? Honey keeps.',
      title: 'Untitled video',
    })

    const briefs = t.events.filter((e) => e.type === 'brief')
    expect(briefs).toHaveLength(2)
    expect(briefs[1]).toEqual({
      brief: 'Did you know? Honey keeps.',
      durationSeconds: 30,
      title: 'Untitled video',
      type: 'brief',
    })
  })

  it('opens the style picker for a storyboard without a style, and makes the loop in the pick', async () => {
    const t = freeChat()

    const result = await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard()) })

    expect(result).toEqual(expect.objectContaining({ status: 'waiting_for_style' }))
    expect(t.events.at(-1)).toEqual({ type: 'style_request' })
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.projects.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        createUseCase: 'beat-loop',
        styleName: 'Animation',
        styleText: STYLE.styleText,
        // The project keeps the preset's address, not its URL with a host and port.
        styleThumbnailUrl: 'preset://v001/story-mode/styles/3d-animation.webp',
      }),
      { agentSessionId: S },
    )
    expect(t.longTake.startBeatLoop).toHaveBeenCalledWith(
      expect.objectContaining({ style: STYLE.styleText, styleName: 'Animation' }),
    )
    expect(t.longTake.startWorkflow).not.toHaveBeenCalled()
  })

  it('Stop with the "Make it?" card open ends the flow with one flow_cancelled, making nothing', async () => {
    const t = freeChat()
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })) })

    t.cancelled.value = true
    const [, q] = [...t.open].find(([id]) => id.startsWith(LOOP_CARD)) ?? []
    q?.reject(new AgentFlowCancelledError())
    await waitFor(() => cancelledEvents(t.events).length > 0)

    expect(cancelledEvents(t.events)).toEqual([{ type: 'flow_cancelled' }])
    expect(t.projects.createProject).not.toHaveBeenCalled()
    expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()
  })

  it('Stop after "Make it" stops before the project or the workflow', async () => {
    const t = freeChat()
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })) })
    t.cancelled.value = true

    t.answer(LOOP_CARD, 'Make it')
    await waitFor(() => cancelledEvents(t.events).length > 0)

    expect(t.projects.createProject).not.toHaveBeenCalled()
    expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()
  })

  it('offers "Try again" when the loop fails to start, reusing its project', async () => {
    const startBeatLoop = jest
      .fn()
      .mockRejectedValueOnce(new Error('This loop is still being made; wait for it to finish.'))
      .mockResolvedValue({ projectId: 'p1', workflowId: 'w1' })
    const t = freeChat({ startBeatLoop })
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })) })

    t.answer(LOOP_CARD, 'Make it')
    await waitFor(() => t.isOpen('autonomous-retry-'))
    expect(t.events.filter((e) => e.type === 'notice')).toEqual([
      {
        text: "Couldn't start the video: This loop is still being made; wait for it to finish.",
        type: 'notice',
      },
    ])

    t.answer('autonomous-retry-', 'Try again')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(startBeatLoop).toHaveBeenCalledTimes(2)
    expect(t.projects.createProject).toHaveBeenCalledTimes(1)
  })

  it('refuses with nothing to make the video, before any line is said or card shown', async () => {
    const assertCanStart = jest.fn(() => {
      throw new ConflictException(GENERATION_NOT_SET_UP_MESSAGE)
    })
    const t = freeChat({ assertCanStart })

    await expect(
      t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })) }),
    ).rejects.toThrow(GENERATION_NOT_SET_UP_MESSAGE)
    expect(t.longTake.checkBeatLoopLines).not.toHaveBeenCalled()
    expect(t.events).toEqual([])
    expect(t.projects.createProject).not.toHaveBeenCalled()
    expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()
  })

  it('a storyboard changed while its card is open: the same length keeps the card, a new one asks again', async () => {
    const t = freeChat()
    const first = loopStoryboard({ style: 'Ink' })
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(first) })

    const reworded = {
      ...first,
      clips: first.clips.map((clip) =>
        clip.id === 'c2'
          ? { ...clip, narration: 'Bees fan the nectar with their tiny wings to dry it.' }
          : clip,
      ),
    }
    expect(await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(reworded) })).toEqual(
      expect.objectContaining({
        note: 'The storyboard was updated; the card is still open.',
        status: 'waiting_for_make_it',
      }),
    )
    expect(questionEvents(t.events)).toHaveLength(1)
    expect(t.session.autonomous?.storyboard).toEqual(reworded)

    const longer = loopStoryboard({ clips: 5, style: 'Ink' })
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(longer) })
    const cards = questionEvents(t.events)
    expect(cards.map((c) => c.questions[0].question)).toEqual([
      'Make this 16-second loop? About $0.80',
      'Make this 20-second loop? About $1.00',
    ])

    // The first card is out of date: it expired, so only the new one can be answered.
    expect(t.events).toContainEqual({ questionId: cards[0].questionId, type: 'question_expired' })
    expect([...t.open.keys()]).toEqual([cards[1].questionId])
    expect(cards[1].questionId).not.toBe(cards[0].questionId)
    await flush()
    expect(t.events.filter((e) => e.type === 'notice')).toEqual([])

    t.answer(LOOP_CARD, 'Make it')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.longTake.startBeatLoop).toHaveBeenCalledWith(
      expect.objectContaining({ storyboard: longer }),
    )
  })

  it('never reuses a card id: a new card after the flow ended asks again', async () => {
    const t = freeChat()
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })) })
    await t.svc.makeBeatLoop(S, {
      storyboard: JSON.stringify(loopStoryboard({ clips: 5, style: 'Ink' })),
    })
    t.answer(LOOP_CARD, 'Not now')
    await flush()

    // A new flow: its card still gets an id no card of this session had.
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })) })
    const ids = questionEvents(t.events).map((card) => card.questionId)
    expect(ids).toHaveLength(3)
    expect(new Set(ids).size).toBe(3)
    expect(t.isOpen(LOOP_CARD)).toBe(true)
  })

  it('a styled storyboard closes an open style picker, and one without a style closes the card', async () => {
    const t = freeChat()
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard()) })
    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })) })
    await expect(t.svc.chooseStyle(S, '3d-animation')).rejects.toBeInstanceOf(
      StyleNotRequestedError,
    )

    await t.svc.makeBeatLoop(S, { storyboard: JSON.stringify(loopStoryboard()) })
    // The picker replaced the card: it expired.
    expect(t.isOpen(LOOP_CARD)).toBe(false)
    expect(t.events.at(-2)).toEqual(expect.objectContaining({ type: 'question_expired' }))
    expect(t.projects.createProject).not.toHaveBeenCalled()
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.longTake.startBeatLoop).toHaveBeenCalledWith(
      expect.objectContaining({ style: STYLE.styleText }),
    )
  })
})

describe('a loop run that fails after the card started it', () => {
  const LOOP_CARD = 'autonomous-loop-'
  const TOO_LONG =
    'Narration too long for its clip even at 1.3x speed: clip 1 (c1) takes 4.6 s to say, 0.1 s more than fits (cut about 1 word; it would need 1.33x, aim for about 8 short words): "Honey found in ancient tombs was still good to eat.". Each line has 3.45 s, 4.5 s at most sped up.'
  /** A failed run, as the engine's handle rejects: the activity's own failure, wrapped. */
  const failedRun = (reason: string) =>
    new WorkflowFailedError(
      'Workflow execution failed',
      new ActivityFailure(
        'Activity task failed',
        'generateBeatLoopVoiceover',
        '1',
        'NON_RETRYABLE',
        ApplicationFailure.nonRetryable(reason, 'BeatLoopLineTooLong'),
      ),
    )

  function freeChat(waitForWorkflow: jest.Mock) {
    const t = makeService([], { waitForWorkflow })
    t.session.mode = 'free'
    t.session.flowActive = false
    return t
  }

  async function makeIt(t: ReturnType<typeof freeChat>) {
    await t.svc.makeBeatLoop(S, {
      storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })),
      title: 'Honey keeps',
    })
    t.answer(LOOP_CARD, 'Make it')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
  }

  it("tells the chat's agent why, so it offers a fix", async () => {
    const t = freeChat(jest.fn().mockRejectedValue(failedRun(TOO_LONG)))

    await makeIt(t)
    await waitFor(() => t.sessions.notifyAgent.mock.calls.length > 0)

    expect(t.waitForWorkflow).toHaveBeenCalledWith('w1')
    expect(t.sessions.notifyAgent).toHaveBeenCalledTimes(1)
    const [id, note] = t.sessions.notifyAgent.mock.calls[0] as unknown as [string, string]
    expect(id).toBe(S)
    // The innermost reason, word for word: which lines, and by how much.
    expect(note).toContain(TOO_LONG)
    expect(note).toContain('"Honey keeps"')
    // How to fix it here: the loop's own redo, not make_beat_loop again.
    expect(note).toMatch(/regenerate_clip/)
    expect(note).toMatch(/"narration"/)
    expect(note).toMatch(/\$0\.16/)
  })

  it('says nothing when the run finishes, or when it was stopped', async () => {
    const done = freeChat(jest.fn().mockResolvedValue({ status: 'completed' }))
    await makeIt(done)
    const stopped = freeChat(
      jest
        .fn()
        .mockRejectedValue(
          new WorkflowFailedError('Workflow execution cancelled', new CancelledFailure()),
        ),
    )
    await makeIt(stopped)
    await flush()
    await flush()

    expect(done.waitForWorkflow).toHaveBeenCalledWith('w1')
    expect(done.sessions.notifyAgent).not.toHaveBeenCalled()
    expect(stopped.sessions.notifyAgent).not.toHaveBeenCalled()
  })

  it('watches only a loop: a story video started from the style picker is not watched', async () => {
    const t = freeChat(jest.fn().mockRejectedValue(failedRun('boom')))
    t.svc.requestStyle(S, {
      brief: 'Comet',
      durationSeconds: 30,
      script: 'Look up.',
      title: 'Comet',
    })
    await t.svc.chooseStyle(S, STYLE.id)
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    await flush()

    expect(t.waitForWorkflow).not.toHaveBeenCalled()
    expect(t.sessions.notifyAgent).not.toHaveBeenCalled()
  })
})

describe('the "Make this loop?" card, as the agent hears of it', () => {
  it('names the card\'s real button, "Make it", and never a "Confirm" one', async () => {
    const t = makeService([])
    t.session.mode = 'free'
    t.session.flowActive = false

    const result = await t.svc.makeBeatLoop(S, {
      storyboard: JSON.stringify(loopStoryboard({ style: 'Ink' })),
    })

    expect(result).toEqual(
      expect.objectContaining({
        card: {
          buttons: ['Make it', 'Not now'],
          question: 'Make this 16-second loop? About $0.80',
        },
        status: 'waiting_for_make_it',
      }),
    )
    const next = (result as { next?: string }).next ?? ''
    expect(next).toMatch(/"Make it"/)
    expect(next).not.toMatch(/\bConfirm\b/)
    // Nothing in the reply the agent reads suggests a confirm step (its status included).
    expect(JSON.stringify(result)).not.toMatch(/confirm/i)
  })
})

describe('Easy: the "Beat loop" camera option', () => {
  const LOOP_OPTION = 'Beat loop'
  const LOOP_CARD = 'autonomous-loop-'
  /** The opener the user types: a usable first line as it is (9 words, no digits). */
  const HOOK = 'Honey from the pharaohs is still safe to eat.'
  /** The loop the writer answers with: 6 clips (24 s), its own first line, no style. */
  const SIX_CLIPS: BeatLoopClip[] = [
    ...LOOP_CLIPS,
    {
      ...LOOP_CLIPS[0],
      id: 'c6',
      narration: 'Which is why honey outlasts the people who make it.',
    },
  ]
  const written = (clips: BeatLoopClip[] = SIX_CLIPS) =>
    JSON.stringify({
      accent: '#FFE500',
      clips,
      keyframes: [
        ...clips.map((clip, i) => ({
          id: `f${i}`,
          prompt: `The scene of ${clip.id}.`,
          same_as: null,
        })),
        { id: `f${clips.length}`, prompt: null, same_as: 'f0' },
      ],
      sources: 'Smithsonian Magazine',
      title: 'Honey that never spoils',
    })

  /** Runs Easy to the camera card and picks `camera` (the hook typed as `HOOK`); `run` is the
   *  flow, still going. */
  async function toCamera(
    t: ReturnType<typeof makeService>,
    camera = LOOP_OPTION,
    length?: string,
  ): Promise<{ run: Promise<void> }> {
    const run = t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t, HOOK)
    await answerCamera(t, camera, length)
    return { run }
  }

  /** Easy with a loop picked (`length` long), through the music card (`music`) to the style
   *  request. */
  async function toLoopStyle(
    t: ReturnType<typeof makeService>,
    music = 'No music (Recommended)',
    length?: string,
  ) {
    const { run } = await toCamera(t, LOOP_OPTION, length)
    await answerMusic(t, music)
    await run
  }

  /** `n` clips that pass every check: the six, then more with lines of their own. */
  const clipsOf = (n: number): BeatLoopClip[] => [
    ...SIX_CLIPS,
    ...['Bees visit two million flowers for one jar.', 'A spoon of honey is a whole bee life.']
      .slice(0, n - SIX_CLIPS.length)
      .map((narration, i) => ({ ...LOOP_CLIPS[1 + i], id: `c${7 + i}`, narration })),
  ]

  const replies = (...loops: string[]) => [
    JSON.stringify(IDEAS),
    JSON.stringify(BRIEF),
    JSON.stringify(OPENINGS),
    ...loops,
  ]

  it('offers the loop third on the camera card, after Dynamic and Calm', async () => {
    const t = makeService(replies())
    void t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t)
    await waitFor(() => t.isOpen('autonomous-camera-'))
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-camera-'))!
    const options = card.questions[0].options
    expect(options.map((o) => o.label)).toEqual(['Dynamic', 'Calm', LOOP_OPTION])
    expect(options[2].description).toBe(
      "Hit, hit, freeze, cut: a short loop with the clips' own sounds.",
    )
  })

  it('asks the loop length after the loop pick: 24 s first and recommended, then 28 and 32', async () => {
    const t = makeService(replies(written()))
    void t.svc.start(S)
    await waitFor(() => t.isOpen('autonomous-idea-'))
    t.answer('autonomous-idea-', 'my own idea')
    await answerOpening(t, HOOK)
    await waitFor(() => t.isOpen('autonomous-camera-'))
    t.answer('autonomous-camera-', LOOP_OPTION)
    await waitFor(() => t.isOpen('autonomous-length-'))
    // Nothing is written until the length is picked.
    expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(3)
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-length-'))!
    const [question] = card.questions
    expect(question).toMatchObject({
      header: 'Length',
      id: 'length',
      isOther: false,
      question: 'How long should the video be?',
    })
    expect(question.options.map((o) => o.label)).toEqual([
      '24 seconds (Recommended)',
      '28 seconds',
      '32 seconds',
    ])
    expect(question.options.map((o) => o.description)).toEqual([
      expect.stringMatching(/^6 clips/),
      expect.stringMatching(/^7 clips/),
      expect.stringMatching(/^8 clips/),
    ])
    expect(question.info).toMatch(/4 seconds/)
  })

  it.each([
    ['28 seconds', 28, 7, '1.40'],
    ['32 seconds', 32, 8, '1.60'],
  ])(
    'a %s loop: the writer, the check, the plan, the card and the run all have %i s',
    async (pick, seconds, clips, usd) => {
      const t = makeService(replies(written(clipsOf(clips))))
      await toLoopStyle(t, 'No music (Recommended)', pick)

      const [, prompt] = t.sessions.runQuietTurn.mock.calls[3]
      expect(prompt).toContain(`${seconds}-second loop short (${clips} clips of 4 seconds)`)
      expect(prompt).toContain(`exactly ${clips} clips and ${clips + 1} keyframes`)
      expect(prompt).toContain(`{"id": "f${clips}", "prompt": null, "same_as": "f0"}`)
      expect(prompt).not.toMatch(/24-second|exactly 6 clips/)
      const checked = t.longTake.checkBeatLoopLines.mock.calls[0][0]
        .storyboard as BeatLoopStoryboard
      expect(checked.duration_s).toBe(seconds)
      expect(checked.clips).toHaveLength(clips)
      expect(checked.keyframes.at(-1)).toEqual({ id: `f${clips}`, same_as: 'f0' })
      expect(t.session.autonomous).toMatchObject({ durationSeconds: seconds, format: 'beat_loop' })
      const briefs = t.events.filter(
        (e): e is Extract<AgentUiEvent, { type: 'brief' }> => e.type === 'brief',
      )
      expect(briefs.at(-1)).toMatchObject({ durationSeconds: seconds })
      expect(briefs.at(-1)?.lines).toHaveLength(clips)
      const shown = t.events
        .flatMap((e) => (e.type === 'message' || e.type === 'notice' ? [e.text] : []))
        .join('\n')
      expect(shown).toContain(`Writing your ${seconds}-second loop: ${clips} short lines`)
      expect(shown).toContain(`· ${seconds}s`)
      expect(shown).not.toMatch(/24-second|· 24s|· 30s/)

      await t.svc.chooseStyle(S, '3d-animation')
      await waitFor(() => t.isOpen(LOOP_CARD))
      const [, card] = [...t.open].find(([id]) => id.startsWith(LOOP_CARD))!
      expect(card.questions[0].question).toBe(`Make this ${seconds}-second loop? About $${usd}`)
      expect(card.questions[0].options[0].description).toMatch(new RegExp(`^${clips} clips of 4 s`))
      expect(t.estimateLoop).toHaveBeenCalledWith(clips)
      t.answer(LOOP_CARD, 'Make it')
      await waitFor(() => t.events.some((e) => e.type === 'video_started'))
      const started = t.longTake.startBeatLoop.mock.calls[0][0]
      expect(started.storyboard.duration_s).toBe(seconds)
      expect(started.storyboard.clips).toHaveLength(clips)
    },
  )

  it('writes a 24-second loop with the hook as its first line and says its lines, before any card', async () => {
    const t = makeService(replies(written()))
    await toLoopStyle(t)

    // The writer gets the brief, the hook and the loop's rules, and answers JSON.
    const [, prompt, opts] = t.sessions.runQuietTurn.mock.calls[3]
    expect(prompt).toContain(BRIEF.brief)
    expect(prompt).toContain(HOOK)
    expect(prompt).toContain('24')
    expect(opts).toMatchObject({ outputSchema: expect.any(Object) })
    // The lines were said (and fit) with the hook as line 1, at 24 s, in no style of its own.
    const checked = t.longTake.checkBeatLoopLines.mock.calls[0][0].storyboard as BeatLoopStoryboard
    expect(checked.clips[0].narration).toBe(HOOK)
    expect(checked.clips.map((c) => c.narration).slice(1)).toEqual(
      SIX_CLIPS.slice(1).map((c) => c.narration),
    )
    expect(checked.duration_s).toBe(24)
    expect(checked.title).toBe(BRIEF.title)
    expect(checked.style).toBeUndefined()
    expect(t.session.autonomous).toMatchObject({
      durationSeconds: 24,
      format: 'beat_loop',
      music: { choice: 'off' },
      opening: HOOK,
      title: BRIEF.title,
    })
    expect(t.session.autonomous?.cameraStyle).toBeUndefined()
    // The plan's header reads 24 s, with the six lines and their stamps.
    const briefs = t.events.filter(
      (e): e is Extract<AgentUiEvent, { type: 'brief' }> => e.type === 'brief',
    )
    expect(briefs.at(-1)).toMatchObject({ durationSeconds: 24, title: BRIEF.title })
    expect(briefs.at(-1)?.lines?.[0]).toEqual({ narration: HOOK, stamp: 'c. 1325 BC' })
    expect(briefs.at(-1)?.lines).toHaveLength(6)
    // Nothing is made or asked to be paid for yet; the style picker comes next.
    expect(t.events.some((e) => e.type === 'style_request')).toBe(true)
    expect(t.isOpen(LOOP_CARD)).toBe(false)
    expect(t.projects.createProject).not.toHaveBeenCalled()
    expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()
    expect(t.writeScript).not.toHaveBeenCalled()
    // No internal notes or file paths in what the chat shows.
    const shown = t.events
      .flatMap((e) => (e.type === 'message' || e.type === 'notice' ? [e.text] : []))
      .join('\n')
    expect(shown).toContain('· 24s')
    expect(shown).not.toMatch(/SKILL|\.md\b|make_beat_loop|JSON|\.reelmakeeasy/)
  })

  it('sends a storyboard issue, or a line too long for its clip, back to the writer before any card', async () => {
    const tooLongOnce = jest
      .fn()
      .mockImplementationOnce(saidLines({ c3: 6 }))
      .mockImplementation(saidLines())
    const broken = written(SIX_CLIPS.slice(0, 5)) // 5 clips for 24 s
    const t = makeService(replies(broken, written(), written()), {
      checkBeatLoopLines: tooLongOnce,
    })
    await toLoopStyle(t)

    const prompts = t.sessions.runQuietTurn.mock.calls.slice(3).map(([, text]) => text as string)
    expect(prompts).toHaveLength(3)
    expect(prompts[1]).toMatch(/clips/)
    expect(prompts[2]).toContain('clips[2].narration (c3): takes 6.0 s to say')
    expect(tooLongOnce).toHaveBeenCalledTimes(2)
    expect(t.events.some((e) => e.type === 'style_request')).toBe(true)
  })

  it('lets the writer shorten a hook too long to say, and keeps that on the next try', async () => {
    // The hook takes 6 s to say; every other first line fits.
    const slowHook = jest.fn((input: { storyboard: BeatLoopStoryboard; voice?: string }) =>
      saidLines(input.storyboard.clips[0]?.narration === HOOK ? { c1: 6 } : {})(input),
    )
    const keptHook = written([{ ...SIX_CLIPS[0], narration: HOOK }, ...SIX_CLIPS.slice(1)])
    // Round 1 has the hook put in; rounds 2-3 keep it word for word; the next try's first
    // round has a line of the writer's own.
    const t = makeService(replies(written(), keptHook, keptHook, written()), {
      checkBeatLoopLines: slowHook,
    })
    await toLoopStyle(t)

    const prompts = t.sessions.runQuietTurn.mock.calls.slice(3).map(([, text]) => text as string)
    expect(prompts).toHaveLength(4)
    expect(prompts[0]).toContain(`this opening line, word for word: "${HOOK}"`)
    for (const prompt of prompts.slice(1)) {
      expect(prompt).not.toContain('word for word')
      expect(prompt).toContain(
        `Clip 1's narration starts from this opening line: "${HOOK}". It takes too long to say in its clip, so shorten it`,
      )
    }
    // The next try kept the writer's own first line instead of putting the hook back.
    const last = slowHook.mock.calls.at(-1)?.[0].storyboard as BeatLoopStoryboard
    expect(last.clips[0].narration).toBe(SIX_CLIPS[0].narration)
    expect(t.isOpen('autonomous-retry-')).toBe(false)
    expect(t.events.some((e) => e.type === 'style_request')).toBe(true)
  })

  it("says in plain words when the voice can't say the lines, with a Try again card", async () => {
    const checkBeatLoopLines = jest
      .fn()
      .mockRejectedValue(new Error('ElevenLabs failed (HTTP 401): invalid_api_key'))
    const t = makeService(replies(written(), written()), { checkBeatLoopLines })
    void (await toCamera(t)).run
    await waitFor(() => t.isOpen('autonomous-retry-'))

    const notices = t.events.flatMap((e) => (e.type === 'notice' ? [e.text] : []))
    expect(notices).toEqual([
      "Couldn't write the loop: the voice couldn't read its lines aloud to check they fit. Try again in a moment, or check your keys on the Setup page.",
    ])
    expect(notices.join('\n')).not.toMatch(/narration|No card|pass another voice|HTTP|ElevenLabs/)
    expect(t.isOpen('autonomous-music-')).toBe(false)
  })

  it('defaults the music card to No music for a loop, still offering the others', async () => {
    const t = makeService(replies(written()))
    const { run } = await toCamera(t)
    await waitFor(() => t.isOpen('autonomous-music-'))
    const [, card] = [...t.open].find(([id]) => id.startsWith('autonomous-music-'))!
    expect(card.questions[0].options.map((o) => o.label)).toEqual([
      'No music (Recommended)',
      'Pick for me',
      'Upbeat',
      'Calm',
    ])
    t.answer('autonomous-music-', 'Upbeat')
    await run
    expect(t.session.autonomous?.music).toEqual({ choice: 'upbeat' })
  })

  it('asks "Make this 24-second loop? About $1.20" after the style pick; nothing is spent until "Make it"', async () => {
    const t = makeService(replies(written()))
    await toLoopStyle(t)
    await t.svc.chooseStyle(S, '3d-animation')

    await waitFor(() => t.isOpen(LOOP_CARD))
    const [, card] = [...t.open].find(([id]) => id.startsWith(LOOP_CARD))!
    expect(card.questions[0].question).toBe('Make this 24-second loop? About $1.20')
    expect(card.questions[0].options.map((o) => o.label)).toEqual(['Make it', 'Not now'])
    expect(card.questions[0].options[0].description).toContain('in the Animation style')
    expect(card.questions[0].options[0].description).toContain('Kokoro Heart, free')
    expect(t.estimateLoop).toHaveBeenCalledWith(6)
    await flush()
    expect(t.projects.createProject).not.toHaveBeenCalled()
    expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()
    expect(t.longTake.startWorkflow).not.toHaveBeenCalled()

    t.answer(LOOP_CARD, 'Make it')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.projects.createProject).toHaveBeenCalledWith(
      expect.objectContaining({
        bgmEnabled: false,
        createUseCase: 'beat-loop',
        initialText: BRIEF.title,
        styleName: STYLE.label,
        styleText: STYLE.styleText,
      }),
      { agentSessionId: S },
    )
    const started = t.longTake.startBeatLoop.mock.calls[0][0]
    expect(started).toMatchObject({ style: STYLE.styleText, voice: 'kokoro-af_heart' })
    expect(started.storyboard.clips[0].narration).toBe(HOOK)
    expect(started.storyboard.duration_s).toBe(24)
    expect(t.longTake.startWorkflow).not.toHaveBeenCalled()
    expect(t.writeScript).not.toHaveBeenCalled()
    expect(t.longTake.createBgmVersion).not.toHaveBeenCalled()
  })

  it('"Not now" on the loop card makes nothing', async () => {
    const t = makeService(replies(written()))
    await toLoopStyle(t)
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.isOpen(LOOP_CARD))
    // Easy takes no messages here, so the card doesn't offer to change the storyboard.
    const [, card] = [...t.open].find(([id]) => id.startsWith(LOOP_CARD))!
    expect(card.questions[0].options[1]).toEqual({
      description: 'Nothing is made or spent.',
      label: 'Not now',
    })
    t.answer(LOOP_CARD, 'Not now')
    await flush()
    expect(t.projects.createProject).not.toHaveBeenCalled()
    expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()
    expect(t.sessions.endAutonomousFlow).toHaveBeenCalled()
  })

  it('a loop with music picked gets it once the run has finished', async () => {
    let finish: () => void = () => undefined
    const waitForWorkflow = jest.fn((id: string) =>
      id === 'w1' ? new Promise<void>((resolve) => (finish = resolve)) : Promise.resolve(),
    )
    const t = makeService(replies(written()), { waitForWorkflow })
    await toLoopStyle(t, 'Upbeat')
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.isOpen(LOOP_CARD))
    t.answer(LOOP_CARD, 'Make it')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.longTake.createBgmVersion).not.toHaveBeenCalled()

    finish()
    await waitFor(() => t.events.some((e) => e.type === 'video_rendered'))
    expect(t.longTake.createBgmVersion).toHaveBeenCalledWith(
      'p1',
      { track: { id: 'groovy-lofi', source: 'library' } },
      USER,
    )
    expect(waitForWorkflow).toHaveBeenCalledWith('bgm1')
  })

  it('Dynamic and Calm still make a story video, with no loop written', async () => {
    const t = makeService(replies())
    const { run } = await toCamera(t, 'Calm')
    await answerMusic(t)
    await run
    expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(3)
    expect(t.longTake.checkBeatLoopLines).not.toHaveBeenCalled()
    expect(t.session.autonomous).toMatchObject({ cameraStyle: 'calm', durationSeconds: 30 })
    expect(t.session.autonomous?.format).toBeUndefined()
    await t.svc.chooseStyle(S, '3d-animation')
    await waitFor(() => t.events.some((e) => e.type === 'video_started'))
    expect(t.longTake.startWorkflow).toHaveBeenCalled()
    expect(t.isOpen(LOOP_CARD)).toBe(false)
  })

  describe('picking up after a restart', () => {
    it('length card open: keeps the loop pick and asks the length again; nothing written yet', async () => {
      const t = makeService(replies(written()))
      const run = t.svc.start(S)
      await waitFor(() => t.isOpen('autonomous-idea-'))
      t.answer('autonomous-idea-', 'my own idea')
      await answerOpening(t, HOOK)
      await waitFor(() => t.isOpen('autonomous-camera-'))
      t.answer('autonomous-camera-', LOOP_OPTION)
      await waitFor(() => t.isOpen('autonomous-length-'))
      await shutDown(t, run)

      const { mark, run: resumed } = pickUp(t)
      await answerLength(t, LOOP_LENGTH)
      await answerMusic(t, 'No music (Recommended)')
      await resumed

      expect(askedSince(t, mark)).toEqual(['autonomous-length-5', 'autonomous-music-6'])
      expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(4)
      expect(t.longTake.checkBeatLoopLines).toHaveBeenCalledTimes(1)
      expect(t.session.autonomous).toMatchObject({ durationSeconds: 24, format: 'beat_loop' })
    })

    it('music card open: the loop written and said before is kept, not written or said again', async () => {
      const t = makeService(replies(written()))
      const { run } = await toCamera(t)
      await waitFor(() => t.isOpen('autonomous-music-'))
      const loop = t.session.autonomous
      await shutDown(t, run)

      const { mark, run: resumed, svc } = pickUp(t)
      await answerMusic(t, 'No music (Recommended)')
      await resumed
      await svc.chooseStyle(S, STYLE.id)
      await waitFor(() => t.isOpen(LOOP_CARD))

      expect(askedSince(t, mark)).toEqual(['autonomous-music-6', 'autonomous-loop-1'])
      expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(4)
      expect(t.longTake.checkBeatLoopLines).toHaveBeenCalledTimes(1)
      expect(t.events.slice(mark).some((e) => e.type === 'brief')).toBe(false)
      expect(t.session.autonomous).toEqual({ ...loop, music: { choice: 'off' } })
      // The card names the voice the lines were said in.
      expect(openCard(t, LOOP_CARD).questions[0].options[0].description).toContain(
        'Kokoro Heart, free',
      )
      t.answer(LOOP_CARD, 'Make it')
      await waitFor(() => t.events.some((e) => e.type === 'video_started'))
      expect(t.longTake.startBeatLoop.mock.calls[0][0]).toMatchObject({
        storyboard: loop?.storyboard,
        style: STYLE.styleText,
        voice: 'kokoro-af_heart',
      })
    })

    it('loop cost card open: shows the same card again, and never makes the loop on its own', async () => {
      const t = makeService(replies(written()))
      await toLoopStyle(t)
      await t.svc.chooseStyle(S, STYLE.id)
      await waitFor(() => t.isOpen(LOOP_CARD))
      const asked = openCard(t, LOOP_CARD)
      await shutDown(t)
      // Unanswered: its card is shown again, so the button says only "Pick up where you left off".
      expect(t.build().resumeAction(S)).toEqual({ kind: 'carry_on' })

      const { mark, run: resumed } = pickUp(t)
      await resumed
      await waitFor(() => t.isOpen(LOOP_CARD))
      await flush()

      expect(openCard(t, LOOP_CARD)).toEqual({ ...asked, id: 'autonomous-loop-2' })
      expect(askedSince(t, mark)).toEqual(['autonomous-loop-2'])
      expect(t.events.slice(mark).some((e) => e.type === 'style_request')).toBe(false)
      expect(t.projects.createProject).not.toHaveBeenCalled()
      expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()

      t.answer(LOOP_CARD, 'Make it')
      await waitFor(() => t.events.some((e) => e.type === 'video_started'))
      expect(t.longTake.startBeatLoop).toHaveBeenCalledTimes(1)
      expect(t.longTake.startBeatLoop.mock.calls[0][0]).toMatchObject({
        style: STYLE.styleText,
        styleName: STYLE.label,
        voice: 'kokoro-af_heart',
      })
      expect(t.sessions.runQuietTurn).toHaveBeenCalledTimes(4)
      expect(t.longTake.checkBeatLoopLines).toHaveBeenCalledTimes(1)
      expect(t.estimateLoop).toHaveBeenCalledWith(6)
    })

    it('"Not now" on the card shown again makes nothing', async () => {
      const t = makeService(replies(written()))
      await toLoopStyle(t)
      await t.svc.chooseStyle(S, STYLE.id)
      await waitFor(() => t.isOpen(LOOP_CARD))
      await shutDown(t)

      const { run: resumed } = pickUp(t)
      await resumed
      await waitFor(() => t.isOpen(LOOP_CARD))
      t.answer(LOOP_CARD, 'Not now')
      await flush()

      expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()
      expect(t.session.flowActive).toBe(false)
    })

    it('"Make it" answered, the loop not started: picking up makes it at once, at the price its card showed', async () => {
      const t = makeService(replies(written()))
      await toLoopStyle(t)
      await t.svc.chooseStyle(S, STYLE.id)
      await waitFor(() => t.isOpen(LOOP_CARD))
      expect(openCard(t, LOOP_CARD).questions[0].question).toBe(
        'Make this 24-second loop? About $1.20',
      )
      // ReelMakeEasy stops while the start makes the project: the loop has not started.
      t.projects.createProject.mockImplementationOnce(() => new Promise<never>(() => undefined))
      t.answer(LOOP_CARD, 'Make it')
      await waitFor(() => t.projects.createProject.mock.calls.length === 1)
      await shutDown(t)
      // Prices move: picking up names the price the user said "Make it" to, never a new one.
      t.estimateLoop.mockClear()
      t.estimateLoop.mockImplementation((clips: number) => ({
        ...LOOP_ESTIMATE,
        clipCount: clips,
        totalUsd: 9.99,
      }))

      expect(t.build().resumeAction(S)).toEqual({ costUsd: 1.2, kind: 'make_loop' })
      expect(t.estimateLoop).not.toHaveBeenCalled()

      // And it does what it says: the loop starts once, with no card first.
      const { mark, run: resumed } = pickUp(t)
      await resumed
      await waitFor(() => t.events.some((e) => e.type === 'video_started'))
      expect(askedSince(t, mark)).toEqual([])
      expect(t.longTake.startBeatLoop).toHaveBeenCalledTimes(1)
    })

    it('"Make it" answered and its start failed with "Try again" open: says only "Pick up where you left off"', async () => {
      const startBeatLoop = jest
        .fn()
        .mockRejectedValueOnce(new Error('fal is down'))
        .mockResolvedValue({ projectId: 'p1', workflowId: 'w1' })
      const t = makeService(replies(written()), { startBeatLoop })
      await toLoopStyle(t)
      await t.svc.chooseStyle(S, STYLE.id)
      await waitFor(() => t.isOpen(LOOP_CARD))
      t.answer(LOOP_CARD, 'Make it')
      await waitFor(() => t.isOpen('autonomous-retry-'))
      await shutDown(t)

      expect(t.build().resumeAction(S)).toEqual({ kind: 'carry_on' })
    })

    describe('an older chat, whose camera card called the loop "Beat loop (1-2-3-4)"', () => {
      const OLD_LOOP_OPTION = 'Beat loop (1-2-3-4)'

      /** The chat as ReelMakeEasy saved it before the option was renamed: its camera card offered,
       *  and was answered with, the old label. */
      function withOldLabel(t: ReturnType<typeof makeService>) {
        const camera = (id: string) => id.startsWith('autonomous-camera-')
        t.transcript.forEach((e, i) => {
          if (e.type === 'question' && camera(e.questionId)) {
            t.transcript[i] = {
              ...e,
              questions: e.questions.map((q) => ({
                ...q,
                options: q.options.map((o) =>
                  o.label === LOOP_OPTION ? { ...o, label: OLD_LOOP_OPTION } : o,
                ),
              })),
            }
          }
          if (e.type === 'question_answered' && camera(e.questionId))
            t.transcript[i] = { ...e, answers: { camera: [OLD_LOOP_OPTION] } }
        })
      }

      it('length card open: still a loop, asked its loop lengths', async () => {
        const t = makeService(replies(written()))
        const run = t.svc.start(S)
        await waitFor(() => t.isOpen('autonomous-idea-'))
        t.answer('autonomous-idea-', 'my own idea')
        await answerOpening(t, HOOK)
        await waitFor(() => t.isOpen('autonomous-camera-'))
        t.answer('autonomous-camera-', LOOP_OPTION)
        await waitFor(() => t.isOpen('autonomous-length-'))
        await shutDown(t, run)
        withOldLabel(t)

        const { run: resumed } = pickUp(t)
        await waitFor(() => t.isOpen('autonomous-length-'))
        expect(openCard(t, 'autonomous-length-').questions[0].options.map((o) => o.label)).toEqual([
          '24 seconds (Recommended)',
          '28 seconds',
          '32 seconds',
        ])
        await answerLength(t, LOOP_LENGTH)
        await answerMusic(t, 'No music (Recommended)')
        await resumed

        expect(t.session.autonomous).toMatchObject({ durationSeconds: 24, format: 'beat_loop' })
        expect(t.session.autonomous?.cameraStyle).toBeUndefined()
      })

      it('music card open: the loop is kept as it is, and its cost card comes before anything is made', async () => {
        const t = makeService(replies(written()))
        const { run } = await toCamera(t)
        await waitFor(() => t.isOpen('autonomous-music-'))
        const loop = t.session.autonomous
        await shutDown(t, run)
        withOldLabel(t)

        const { mark, run: resumed, svc } = pickUp(t)
        await answerMusic(t, 'No music (Recommended)')
        await resumed
        expect(t.session.autonomous).toEqual({ ...loop, music: { choice: 'off' } })
        await svc.chooseStyle(S, STYLE.id)
        await waitFor(() => t.isOpen(LOOP_CARD))
        await flush()

        expect(askedSince(t, mark)).toEqual(['autonomous-music-6', 'autonomous-loop-1'])
        expect(t.projects.createProject).not.toHaveBeenCalled()
        expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()
        expect(t.longTake.startWorkflow).not.toHaveBeenCalled()
        t.answer(LOOP_CARD, 'Make it')
        await waitFor(() => t.events.some((e) => e.type === 'video_started'))
        expect(t.longTake.startBeatLoop.mock.calls[0][0]).toMatchObject({
          storyboard: loop?.storyboard,
          voice: 'kokoro-af_heart',
        })
        expect(t.longTake.checkBeatLoopLines).toHaveBeenCalledTimes(1)
      })

      it('style picker open: the pick asks the cost card, and nothing is made until "Make it"', async () => {
        const t = makeService(replies(written()))
        await toLoopStyle(t)
        const loop = t.session.autonomous
        await shutDown(t)
        withOldLabel(t)

        const { mark, run: resumed, svc } = pickUp(t)
        await resumed
        expect(t.events.slice(mark).at(-1)).toEqual({ type: 'style_request' })
        await svc.chooseStyle(S, STYLE.id)
        await waitFor(() => t.isOpen(LOOP_CARD))
        await flush()

        expect(askedSince(t, mark)).toEqual(['autonomous-loop-1'])
        expect(t.session.autonomous).toEqual(loop)
        expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()
        expect(t.longTake.startWorkflow).not.toHaveBeenCalled()
      })

      it('loop cost card open: shows it again, never making the loop on its own', async () => {
        const t = makeService(replies(written()))
        await toLoopStyle(t)
        await t.svc.chooseStyle(S, STYLE.id)
        await waitFor(() => t.isOpen(LOOP_CARD))
        await shutDown(t)
        withOldLabel(t)

        const { mark, run: resumed } = pickUp(t)
        await resumed
        await waitFor(() => t.isOpen(LOOP_CARD))
        await flush()

        expect(askedSince(t, mark)).toEqual(['autonomous-loop-2'])
        expect(t.projects.createProject).not.toHaveBeenCalled()
        expect(t.longTake.startBeatLoop).not.toHaveBeenCalled()
        expect(t.longTake.startWorkflow).not.toHaveBeenCalled()
      })
    })

    describe('a loop written before its voice was kept', () => {
      /** The loop as a ReelMakeEasy from before the voice was kept with it saved it. */
      const withoutVoice = (loop: AgentSession['autonomous']) => {
        if (!loop) throw new Error('no loop yet')
        const { voice: _voice, ...older } = loop
        return older
      }

      it('is not said again to pick a voice: the card leaves the voice out, and the run picks it', async () => {
        const t = makeService(replies(written()))
        const { run } = await toCamera(t)
        await waitFor(() => t.isOpen('autonomous-music-'))
        await shutDown(t, run)
        t.session.autonomous = withoutVoice(t.session.autonomous)

        const { run: resumed, svc } = pickUp(t)
        await answerMusic(t, 'No music (Recommended)')
        await resumed
        await svc.chooseStyle(S, STYLE.id)
        await waitFor(() => t.isOpen(LOOP_CARD))

        expect(t.longTake.checkBeatLoopLines).toHaveBeenCalledTimes(1)
        const [option] = openCard(t, LOOP_CARD).questions[0].options
        expect(option.description).toMatch(/^6 clips of 4 s on MiniMax Hailuo 3, in the Animation/)
        expect(option.description).not.toMatch(/Voice/)
        t.answer(LOOP_CARD, 'Make it')
        await waitFor(() => t.events.some((e) => e.type === 'video_started'))
        // No voice named: the run says the lines in the loop's own voice, as they were said.
        expect(t.longTake.startBeatLoop.mock.calls[0][0]).not.toHaveProperty('voice')
        expect(t.longTake.checkBeatLoopLines).toHaveBeenCalledTimes(1)
      })

      it('style picker open: the same, with no line said again', async () => {
        const failing = jest.fn(saidLines()).mockName('checkBeatLoopLines')
        const t = makeService(replies(written()), { checkBeatLoopLines: failing })
        await toLoopStyle(t)
        await shutDown(t)
        t.session.autonomous = withoutVoice(t.session.autonomous)
        // Saying them again would fail now: picking up must not need it.
        failing.mockRejectedValue(new Error('ElevenLabs failed (HTTP 401): invalid_api_key'))

        const { run: resumed, svc } = pickUp(t)
        await resumed
        expect(t.session.flowActive).toBe(true)
        await svc.chooseStyle(S, STYLE.id)
        await waitFor(() => t.isOpen(LOOP_CARD))

        expect(failing).toHaveBeenCalledTimes(1)
        expect(t.events.some((e) => e.type === 'notice')).toBe(false)
      })
    })
  })
})
