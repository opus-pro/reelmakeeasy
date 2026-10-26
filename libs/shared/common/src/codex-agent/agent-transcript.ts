import type {
  AgentAnswers,
  AgentAttachment,
  AgentLoopLine,
  AgentMode,
  AgentMotionSetupView,
  AgentMotionTask,
  AgentPlanStep,
  AgentQuestion,
  AgentUiEvent,
} from '@shared/types/api/agent'

import { motionSetupViewFromStored } from './agent-sessions'

export type Transcript = {
  /** What Codex is doing right now, for the live activity line; null when nothing is running. */
  activity: null | { id: string; label: string }
  /** The brief an autonomous session settled on (the `brief` event), with a loop short's lines;
   *  null until then. No `durationSeconds` until the length is picked. */
  brief: null | {
    brief: string
    durationSeconds?: number
    lines?: AgentLoopLine[]
    title: string
  }
  entries: TranscriptEntry[]
  lastEventId: number
  /** Chosen once, right after the session is created; null until the `mode` event arrives. */
  mode: AgentMode | null
  /** A Motion Reel's phases (the last `motion_tasks` event); null until ReelMakeEasy sends them. */
  motionTasks: AgentMotionTask[] | null
  /** The latest `turn/plan/updated` steps; cleared when the user sends a message. */
  plan: AgentPlanStep[] | null
  /** A Ranking chat's ranking (the last `ranking` event) and how many changes it has seen, so
   *  its preview reloads on each; null until a tool touches one. */
  ranking: null | { id: string; version: number }
  working: boolean
}

export type TranscriptEntry =
  | {
      answers?: AgentAnswers
      id: string
      kind: 'question'
      questions: AgentQuestion[]
      /** ReelMakeEasy's own card (`askServerQuestion`): the agent's turn ending leaves it open. */
      server?: true
      state: 'answered' | 'expired' | 'open'
    }
  | {
      command: string
      exitCode?: null | number
      id: string
      kind: 'command'
      status: 'completed' | 'failed' | 'started'
    }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'image'; src?: string; status: 'done' | 'failed' | 'generating' }
  | { id: string; kind: 'notice'; text: string }
  | { id: string; kind: 'thinking'; status: 'completed' | 'started'; text: string }
  | { id: string; kind: 'tool'; status: 'completed' | 'failed' | 'started'; text: string }
  /** `attachments`: the files sent with the message, shown under it. */
  | { attachments?: AgentAttachment[]; id: string; kind: 'user'; text: string }
  | { id: string; kind: 'video'; projectId: string }
  /** A Motion Reel's setup card: open until it is sent, then showing what was chosen. */
  | { id: string; kind: 'motion_setup'; setup?: AgentMotionSetupView; state: 'chosen' | 'open' }
  /** A rendered Motion Reel, played in the chat. */
  | { id: string; kind: 'motion_video'; posterUrl?: string; report?: string; videoUrl: string }
  | {
      id: string
      kind: 'style'
      state: 'chosen' | 'expired' | 'open'
      styleId?: string
      styleName?: string
      thumbnailUrl?: string
    }

/** A notice raised by the browser itself (e.g. a send the server refused). It never
 *  changes `working` or `lastEventId`: the server's own events own those. */
export type LocalNotice = { noticeId: string; text: string; type: 'local_notice' }

/** The server refused an answer because the card is no longer open there (409), e.g. a card
 *  ReelMakeEasy asked before it restarted: the card expires here too. Never changes `lastEventId`. */
export type LocalQuestionExpired = { questionId: string; type: 'local_question_expired' }

export type TranscriptAction = AgentUiEvent | LocalNotice | LocalQuestionExpired

export const initialTranscript: Transcript = {
  activity: null,
  brief: null,
  entries: [],
  lastEventId: 0,
  mode: null,
  motionTasks: null,
  plan: null,
  ranking: null,
  working: false,
}

/** Notice ids must be unique React keys even for an event without an id. */
const noticeId = (state: Transcript, event: AgentUiEvent) =>
  event.id === undefined ? `n-${state.entries.length}` : `n${event.id}`

/** Style ids must be unique React keys even for an event without an id. */
const styleEntryId = (state: Transcript, event: AgentUiEvent) =>
  event.id === undefined ? `style-${state.entries.length}` : `style-${event.id}`

const upsert = (entries: TranscriptEntry[], entry: TranscriptEntry) => {
  const i = entries.findIndex((e) => e.id === entry.id && e.kind === entry.kind)
  return i === -1 ? [...entries, entry] : entries.map((e, j) => (j === i ? entry : e))
}

/** Clears the activity indicator when it belongs to `id`; otherwise leaves it as-is. */
const clearActivity = (state: Transcript, id: string) =>
  state.activity?.id === id ? null : state.activity

/** Moves still-`open` question cards to `expired` (answered cards are untouched). A turn end
 *  or an agent stop (`keepServer`) leaves ReelMakeEasy's own cards open: their answer route doesn't
 *  depend on the agent's turn or process, and ReelMakeEasy expires them itself (`question_expired`)
 *  when they go (Stop, a deleted chat, a shutdown, a restart). */
const expireOpen = (entries: TranscriptEntry[], keepServer = false): TranscriptEntry[] =>
  entries.map((e) =>
    e.kind === 'question' && e.state === 'open' && !(keepServer && e.server)
      ? { ...e, state: 'expired' }
      : e,
  )

/** Moves one still-`open` question card to `expired`. */
const expireQuestion = (entries: TranscriptEntry[], questionId: string): TranscriptEntry[] =>
  entries.map((e) =>
    e.kind === 'question' && e.id === questionId && e.state === 'open'
      ? { ...e, state: 'expired' }
      : e,
  )

/** Moves a still-`open` style card to `expired` (chosen cards are untouched). Only a
 *  session stop (the pending request lived in the now-gone process's memory) or a cancelled
 *  autonomous flow does this, unlike a question, whose answer route still works after a
 *  terminal turn. */
const expireOpenStyle = (entries: TranscriptEntry[]): TranscriptEntry[] =>
  entries.map((e) => (e.kind === 'style' && e.state === 'open' ? { ...e, state: 'expired' } : e))

/** Settles the entries a turn end or a session stop cut off, so nothing spins forever:
 *  open questions expire (but `keepServerQuestions` leaves ReelMakeEasy's own cards open), and
 *  in-flight images, commands and tools fail. An in-flight thinking entry
 *  completes, or goes away if it never got any text (as a completed empty one does).
 *  Finished entries are untouched. */
const settleInFlight = (
  entries: TranscriptEntry[],
  keepServerQuestions = false,
): TranscriptEntry[] =>
  expireOpen(entries, keepServerQuestions).flatMap((e): TranscriptEntry[] => {
    if (e.kind === 'image' && e.status === 'generating') return [{ ...e, status: 'failed' }]
    if ((e.kind === 'command' || e.kind === 'tool') && e.status === 'started')
      return [{ ...e, status: 'failed' }]
    if (e.kind === 'thinking' && e.status === 'started')
      return e.text === '' ? [] : [{ ...e, status: 'completed' }]
    return [e]
  })

const isQuestionEntry = (
  entry: TranscriptEntry,
): entry is Extract<TranscriptEntry, { kind: 'question' }> => entry.kind === 'question'

const isThinkingEntry = (
  entry: TranscriptEntry,
): entry is Extract<TranscriptEntry, { kind: 'thinking' }> => entry.kind === 'thinking'

const isAssistantEntry = (
  entry: TranscriptEntry,
): entry is Extract<TranscriptEntry, { kind: 'assistant' }> => entry.kind === 'assistant'

const isStyleEntry = (
  entry: TranscriptEntry,
): entry is Extract<TranscriptEntry, { kind: 'style' }> => entry.kind === 'style'

/** Commands longer than `max` are cut to `max - 1` chars + an ellipsis, for the activity label only. */
const shorten = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

type EventOf<T extends AgentUiEvent['type']> = Extract<AgentUiEvent, { type: T }>

const handleCommand = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'command'>,
): Transcript => ({
  ...next,
  activity:
    event.status === 'started'
      ? { id: event.itemId, label: `Running ${shorten(event.command, 60)}` }
      : clearActivity(state, event.itemId),
  entries: upsert(state.entries, {
    command: event.command,
    exitCode: event.exitCode,
    id: event.itemId,
    kind: 'command',
    status: event.status,
  }),
})

/** The notice a cancelled autonomous flow leaves in the transcript. */
export const FLOW_CANCELLED_NOTICE = 'Autonomous mode stopped.'

/** Item ids of assistant messages ReelMakeEasy posts itself (not Codex): `ly-<event id>`. */
export const REELMAKEEASY_MESSAGE_PREFIX = 'ly-'

/** The message ReelMakeEasy posts right after a video starts. The chat shows it only while that
 *  video is being made: once it is done, a line saying it is ready takes its place (for a loop,
 *  naming any clip its checks still flag); once its run failed, the failure does. */
export const VIDEO_STARTED_MESSAGE =
  "Your video is being made. It will play right here when it's ready."

const handleFlowCancelled = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'flow_cancelled'>,
): Transcript => ({
  ...next,
  entries: [
    ...expireOpenStyle(state.entries),
    { id: noticeId(state, event), kind: 'notice', text: FLOW_CANCELLED_NOTICE },
  ],
})

const handleImage = (state: Transcript, next: Transcript, event: EventOf<'image'>): Transcript => ({
  ...next,
  activity: clearActivity(state, event.itemId),
  entries: upsert(state.entries, {
    id: event.itemId,
    kind: 'image',
    src: event.path,
    status: 'done',
  }),
})

const handleImageProgress = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'image_progress'>,
): Transcript => ({
  ...next,
  activity:
    event.status === 'started'
      ? { id: event.itemId, label: 'Generating an image…' }
      : clearActivity(state, event.itemId),
  entries: upsert(state.entries, {
    id: event.itemId,
    kind: 'image',
    status: event.status === 'started' ? 'generating' : 'failed',
  }),
})

const handleMessage = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'message'>,
): Transcript => ({
  ...next,
  entries: upsert(state.entries, { id: event.itemId, kind: 'assistant', text: event.text }),
})

const handleMode = (state: Transcript, next: Transcript, event: EventOf<'mode'>): Transcript => ({
  ...next,
  mode: event.mode,
})

const handleNotice = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'notice'>,
): Transcript => ({
  ...next,
  entries: [...state.entries, { id: noticeId(state, event), kind: 'notice', text: event.text }],
})

const handleQuestion = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'question'>,
): Transcript => ({
  ...next,
  activity: { id: event.questionId, label: 'Waiting for your answer' },
  entries: upsert(state.entries, {
    id: event.questionId,
    kind: 'question',
    questions: event.questions,
    ...(event.server ? { server: true as const } : {}),
    state: 'open',
  }),
})

const handleQuestionAnswered = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'question_answered'>,
): Transcript => {
  const current = state.entries.find((e) => e.id === event.questionId && isQuestionEntry(e))
  const questions = current && isQuestionEntry(current) ? current.questions : []
  return {
    ...next,
    activity: clearActivity(state, event.questionId),
    entries: upsert(state.entries, {
      answers: event.answers,
      id: event.questionId,
      kind: 'question',
      questions,
      state: 'answered',
    }),
  }
}

const handleQuestionExpired = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'question_expired'>,
): Transcript => ({
  ...next,
  activity: clearActivity(state, event.questionId),
  entries: expireQuestion(state.entries, event.questionId),
})

/**
 * A Motion Reel's phases when the agent stops (an exit, a restart): nothing it was doing is
 * running any more. Scenes being written are as far as they got; a call cut off says so. A call
 * the server still finishes sends the phases again.
 */
const settleMotionTasks = (tasks: AgentMotionTask[] | null): AgentMotionTask[] | null =>
  tasks?.some((t) => t.state === 'running')
    ? tasks.map((t): AgentMotionTask => {
        if (t.state !== 'running') return t
        if (t.id === 'build') return { ...t, state: 'done' }
        return { ...t, result: 'Stopped before it finished', state: 'failed' }
      })
    : tasks

const handleSession = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'session'>,
): Transcript => {
  // A stop always shows; other session events only when they say something
  // (e.g. "could not resume the earlier conversation").
  const stopped = event.status === 'stopped'
  // `idle` ends a ReelMakeEasy-run working phase (e.g. autonomous mode writing the script and
  // starting the video) that has no Codex turn of its own to end it.
  const idle = event.status === 'idle'
  const text = event.reason ?? (stopped ? 'The agent stopped' : undefined)
  const entries = text
    ? [...state.entries, { id: noticeId(state, event), kind: 'notice' as const, text }]
    : state.entries
  return {
    ...next,
    activity: stopped || idle ? null : state.activity,
    // The agent's cards go with it; ReelMakeEasy's own stay until it expires them (an agent that
    // exited mid-turn leaves the loop card it waits on answerable).
    entries: stopped ? expireOpenStyle(settleInFlight(entries, true)) : entries,
    motionTasks: stopped ? settleMotionTasks(state.motionTasks) : state.motionTasks,
    working: stopped || idle ? false : event.status === 'running' ? true : state.working,
  }
}

const handleStyleChosen = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'style_chosen'>,
): Transcript => {
  const openIndex = state.entries.findLastIndex((e) => isStyleEntry(e) && e.state === 'open')
  const chosen: TranscriptEntry = {
    id: openIndex === -1 ? styleEntryId(state, event) : state.entries[openIndex].id,
    kind: 'style',
    state: 'chosen',
    styleId: event.styleId,
    styleName: event.styleName,
    thumbnailUrl: event.thumbnailUrl,
  }
  return {
    ...next,
    entries:
      openIndex === -1
        ? [...state.entries, chosen]
        : state.entries.map((e, i) => (i === openIndex ? chosen : e)),
  }
}

const handleStyleRequest = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'style_request'>,
): Transcript => ({
  ...next,
  entries: [...state.entries, { id: styleEntryId(state, event), kind: 'style', state: 'open' }],
})

const handleTextDelta = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'text_delta'>,
): Transcript => {
  const current = state.entries.find((e) => e.id === event.itemId && isAssistantEntry(e))
  const currentText = current && isAssistantEntry(current) ? current.text : ''
  return {
    ...next,
    activity: null,
    entries: upsert(state.entries, {
      id: event.itemId,
      kind: 'assistant',
      text: currentText + event.text,
    }),
  }
}

const handleThinking = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'thinking'>,
): Transcript => {
  const current = state.entries.find((e) => e.id === event.itemId && isThinkingEntry(e))
  const currentText = current && isThinkingEntry(current) ? current.text : ''
  const text = event.text || currentText || ''
  if (event.status === 'completed' && text === '') {
    return {
      ...next,
      activity: clearActivity(state, event.itemId),
      entries: state.entries.filter((e) => !(e.id === event.itemId && e.kind === 'thinking')),
    }
  }
  return {
    ...next,
    activity:
      event.status === 'completed'
        ? clearActivity(state, event.itemId)
        : { id: event.itemId, label: 'Thinking…' },
    entries: upsert(state.entries, {
      id: event.itemId,
      kind: 'thinking',
      status: event.status,
      text,
    }),
  }
}

const handleThinkingDelta = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'thinking_delta'>,
): Transcript => {
  const current = state.entries.find((e) => e.id === event.itemId && isThinkingEntry(e))
  const currentText = current && isThinkingEntry(current) ? current.text : ''
  return {
    ...next,
    entries: upsert(state.entries, {
      id: event.itemId,
      kind: 'thinking',
      status: 'started',
      text: currentText + event.text,
    }),
  }
}

const handleTool = (state: Transcript, next: Transcript, event: EventOf<'tool'>): Transcript => ({
  ...next,
  activity:
    event.status === 'started'
      ? { id: event.itemId, label: `Using ${event.tool.replace(/_/g, ' ')}` }
      : clearActivity(state, event.itemId),
  entries: upsert(state.entries, {
    id: event.itemId,
    kind: 'tool',
    status: event.status,
    text: event.summary,
  }),
})

const handleTurn = (state: Transcript, next: Transcript, event: EventOf<'turn'>): Transcript => {
  if (event.status === 'started') return { ...next, working: true }
  const entries = event.error
    ? [...state.entries, { id: noticeId(state, event), kind: 'notice' as const, text: event.error }]
    : state.entries
  // The agent's turn is over, not ReelMakeEasy's cards: those stay open for their answer.
  return { ...next, activity: null, entries: settleInFlight(entries, true), working: false }
}

const handleUserMessage = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'user_message'>,
): Transcript => ({
  ...next,
  entries: [
    ...state.entries,
    {
      ...(event.attachments?.length ? { attachments: event.attachments } : {}),
      id: `u${event.id}`,
      kind: 'user',
      text: event.text,
    },
  ],
  plan: null,
  working: true,
})

const handleVideoStarted = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'video_started'>,
): Transcript => ({
  ...next,
  entries: [
    ...state.entries,
    { id: `video-${event.projectId}`, kind: 'video', projectId: event.projectId },
  ],
})

const handleMotionSetupRequest = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'motion_setup_request'>,
): Transcript => {
  const id = `motion-setup-${event.id ?? state.entries.length}`
  // A setup that failed asks again: the open card stays the one card, under a new id so it
  // starts over (unlocked, as a fresh card).
  const openIndex = state.entries.findLastIndex(
    (e) => e.kind === 'motion_setup' && e.state === 'open',
  )
  if (openIndex !== -1)
    return { ...next, entries: state.entries.map((e, i) => (i === openIndex ? { ...e, id } : e)) }
  return { ...next, entries: [...state.entries, { id, kind: 'motion_setup', state: 'open' }] }
}

const handleMotionSetup = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'motion_setup'>,
): Transcript => {
  // The open card turns into the chosen one; a later setup (the agent composed the music)
  // updates the chosen card in place.
  const open = state.entries.findLastIndex((e) => e.kind === 'motion_setup' && e.state === 'open')
  const openIndex =
    open === -1 ? state.entries.findLastIndex((e) => e.kind === 'motion_setup') : open
  const chosen: TranscriptEntry = {
    id:
      openIndex === -1
        ? `motion-setup-${event.id ?? state.entries.length}`
        : state.entries[openIndex].id,
    kind: 'motion_setup',
    // A setup saved when reels had styles shows its type.
    setup: motionSetupViewFromStored(event.setup),
    state: 'chosen',
  }
  return {
    ...next,
    entries:
      openIndex === -1
        ? [...state.entries, chosen]
        : state.entries.map((e, i) => (i === openIndex ? chosen : e)),
  }
}

const handleMotionVideo = (
  state: Transcript,
  next: Transcript,
  event: EventOf<'motion_video'>,
): Transcript => ({
  ...next,
  entries: upsert(state.entries, {
    id: event.itemId,
    kind: 'motion_video',
    ...(event.posterUrl ? { posterUrl: event.posterUrl } : {}),
    ...(event.report ? { report: event.report } : {}),
    videoUrl: event.videoUrl,
  }),
})

export function reduceTranscript(state: Transcript, event: TranscriptAction): Transcript {
  if (event.type === 'local_notice') {
    return {
      ...state,
      entries: [...state.entries, { id: event.noticeId, kind: 'notice', text: event.text }],
    }
  }
  if (event.type === 'local_question_expired') {
    return {
      ...state,
      activity: clearActivity(state, event.questionId),
      entries: expireQuestion(state.entries, event.questionId),
    }
  }
  if (event.id !== undefined && event.id <= state.lastEventId) return state
  const next = { ...state, lastEventId: event.id ?? state.lastEventId }
  switch (event.type) {
    case 'brief': {
      return {
        ...next,
        brief: {
          brief: event.brief,
          ...(event.durationSeconds ? { durationSeconds: event.durationSeconds } : {}),
          ...(event.lines ? { lines: event.lines } : {}),
          title: event.title,
        },
      }
    }
    case 'command': {
      return handleCommand(state, next, event)
    }
    case 'flow_cancelled': {
      return handleFlowCancelled(state, next, event)
    }
    case 'image': {
      return handleImage(state, next, event)
    }
    case 'image_progress': {
      return handleImageProgress(state, next, event)
    }
    case 'message': {
      return handleMessage(state, next, event)
    }
    case 'mode': {
      return handleMode(state, next, event)
    }
    case 'motion_setup': {
      return handleMotionSetup(state, next, event)
    }
    case 'motion_setup_request': {
      return handleMotionSetupRequest(state, next, event)
    }
    case 'motion_tasks': {
      return { ...next, motionTasks: event.tasks }
    }
    case 'motion_video': {
      return handleMotionVideo(state, next, event)
    }
    case 'notice': {
      return handleNotice(state, next, event)
    }
    case 'plan': {
      return { ...next, plan: event.steps }
    }
    case 'question': {
      return handleQuestion(state, next, event)
    }
    case 'question_answered': {
      return handleQuestionAnswered(state, next, event)
    }
    case 'question_expired': {
      return handleQuestionExpired(state, next, event)
    }
    case 'ranking': {
      return { ...next, ranking: { id: event.rankingId, version: (state.ranking?.version ?? 0) + 1 } }
    }
    case 'session': {
      return handleSession(state, next, event)
    }
    case 'style_chosen': {
      return handleStyleChosen(state, next, event)
    }
    case 'style_request': {
      return handleStyleRequest(state, next, event)
    }
    case 'text_delta': {
      return handleTextDelta(state, next, event)
    }
    case 'thinking': {
      return handleThinking(state, next, event)
    }
    case 'thinking_delta': {
      return handleThinkingDelta(state, next, event)
    }
    case 'tool': {
      return handleTool(state, next, event)
    }
    case 'turn': {
      return handleTurn(state, next, event)
    }
    case 'user_message': {
      return handleUserMessage(state, next, event)
    }
    case 'video_started': {
      return handleVideoStarted(state, next, event)
    }
    default: {
      return next
    }
  }
}
