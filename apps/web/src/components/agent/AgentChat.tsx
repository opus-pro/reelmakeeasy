'use client'

import {
  REELMAKEEASY_MESSAGE_PREFIX,
  type Transcript,
  type TranscriptEntry,
} from '@reelmakeeasy/common/codex-agent/agent-transcript'
import {
  type AgentAnswers,
  type AgentMode,
  type AgentTool,
  isMotionMode,
  isRankingTopicQuestion,
} from '@shared/types/api/agent'
import { Button, cn, Textarea } from '@shared/ui'
import Link from 'next/link'
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import { MicButton } from '@/components/dictation/MicButton'
import { useVoiceTyping } from '@/components/dictation/useVoiceTyping'

import { SentAttachmentCards } from './attachments/AttachmentCards'
import {
  AttachButton,
  AttachmentDropZone,
  pasteFiles,
  sendWaits,
  takesFiles,
} from './attachments/ComposerAttachments'
import { useAttachments } from './attachments/useAttachments'
import { ChatModelBar } from './models/ChatModelBar'
import { AnimationSetupCard } from './animation/AnimationSetupCard'
import { composerPlaceholder } from './composer-placeholder'
import { MotionReelSetupCard } from './motion/MotionReelSetupCard'
import { MotionReelVideoCard } from './motion/MotionReelVideoCard'
import { type ActivityEntry, ActivityGroup } from './ActivityGroup'
import { agentNameOf, chosenHarnessOf, presetHarnessOf } from './agent-harness'
import { AgentMarkdown } from './AgentMarkdown'
import { AgentPlan } from './AgentPlan'
import { composerCard } from './card-answer'
import { QuestionCard } from './QuestionCard'
import {
  canPickUp,
  carryOnCardId,
  carryOnMessage,
  type ExpiredHints,
  expiredHintsFor,
} from './resume-chat'
import { ResumeCard, resumeWords } from './ResumeCard'
import { Spinner } from './Spinner'
import { StyleRequestCard } from './StyleRequestCard'
import { useAgentImageSrc } from './useAgentImageSrc'
import type { AgentSessionState } from './useAgentSession'
import { useAutoGrow } from './useAutoGrow'
import { VideoProgressCard } from './VideoProgressCard'
import { VideoStartedLine, videoStartedLines } from './VideoStartedLine'
import { WelcomeCard } from './WelcomeCard'

export type AgentChatProps = {
  /** The page's one `useAgentSession`, shared with the storyboard panel. */
  agent: AgentSessionState
  /** The tool the welcome card shows first (a link from Ranking Builder: Ranking). */
  firstTool?: AgentTool | null
  /** Shown at the start of the header (the agent page's sidebar button). */
  headerStart?: ReactNode
  sessionId: string
  /** A mode the page is choosing for the user (Easy, from the home page's first-video prompt). */
  startingMode?: AgentMode | null
  /** The sidebar row's title (the project name, once there is one): overrides the chat's
   *  own stored title so the header always agrees with the row, including after a rename. */
  title?: string
}

type AnswerFn = (questionId: string, answers: AgentAnswers) => Promise<boolean>
type ChooseStyleFn = (styleId: string) => Promise<boolean>
type QuestionEntry = Extract<TranscriptEntry, { kind: 'question' }>
type StartEditingFn = () => Promise<boolean>

/** One transcript row: a single entry, or a run of consecutive thinking/command entries. */
type TranscriptItem =
  | { entries: ActivityEntry[]; key: string; type: 'activity' }
  | { entry: TranscriptEntry; key: string; type: 'entry' }

/** The chat box grows with its text up to this height (about 8 lines), then scrolls. */
const COMPOSER_MAX_PX = 200
/** Within this many px of the bottom counts as "at the bottom" for autoscroll. */
const STICK_TO_BOTTOM_PX = 80

const isActivityEntry = (entry: TranscriptEntry): entry is ActivityEntry =>
  entry.kind === 'thinking' || entry.kind === 'command'

/** Folds each run of consecutive thinking/command entries into one activity item. */
function groupEntries(entries: TranscriptEntry[]): TranscriptItem[] {
  const items: TranscriptItem[] = []
  for (const entry of entries) {
    const last = items[items.length - 1]
    if (isActivityEntry(entry)) {
      if (last?.type === 'activity') last.entries.push(entry)
      else items.push({ entries: [entry], key: `activity-${entry.id}`, type: 'activity' })
    } else {
      items.push({ entry, key: `${entry.kind}-${entry.id}`, type: 'entry' })
    }
  }
  return items
}

function ImageEntry({
  entry,
  sessionId,
}: {
  entry: Extract<TranscriptEntry, { kind: 'image' }>
  sessionId: string
}) {
  const src = useAgentImageSrc(sessionId, entry.src)

  if (entry.status === 'generating') {
    return (
      <div className="flex aspect-[2/3] w-64 max-w-full flex-col items-center justify-center gap-2 rounded-lg border border-white/10 bg-fill-secondary text-xs text-secondary">
        <Spinner />
        <span>Generating image…</span>
      </div>
    )
  }
  if (entry.status === 'failed') {
    return <div className="text-sm text-secondary">Image generation failed</div>
  }
  if (!src) return null

  return <img alt="" className="w-64 max-w-full rounded-lg" src={src} />
}

function QuestionRow({
  answer,
  carryOn,
  entry,
  expiredHint,
  submitted,
}: {
  answer: AnswerFn
  /** Sends a message: set when this expired card can still be answered (`carryOnCardId`). */
  carryOn?: (text: string) => Promise<boolean>
  entry: QuestionEntry
  expiredHint?: string
  submitted: boolean
}) {
  const onAnswer = useCallback(
    (answers: AgentAnswers) => answer(entry.id, answers),
    [answer, entry.id],
  )
  const onCarryOn = useMemo(
    () =>
      carryOn
        ? (answers: AgentAnswers) => carryOn(carryOnMessage(entry.questions, answers))
        : undefined,
    [carryOn, entry.questions],
  )
  return (
    <QuestionCard
      entry={entry}
      expiredHint={expiredHint}
      onAnswer={onAnswer}
      {...(onCarryOn ? { onCarryOn } : {})}
      submitted={submitted}
    />
  )
}

function ToolEntry({ entry }: { entry: Extract<TranscriptEntry, { kind: 'tool' }> }) {
  const failed = entry.status === 'failed'
  const completed = entry.status === 'completed'
  return (
    <div
      className={cn(
        'flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
        failed
          ? 'border-red-500/30 bg-red-500/10 text-red-400'
          : 'border-white/10 bg-fill-secondary text-secondary',
      )}
    >
      {!completed && !failed && <Spinner />}
      {completed && <span className="text-green-400">✓</span>}
      {failed && <span>✕</span>}
      <span>{toolLabel(entry.text)}</span>
    </div>
  )
}

/** What a Motion Reel or Claude Animation chat still needs set up (its card not yet sent), as
 *  the composer names it; null when nothing is waiting. */
function setupPendingFor(mode: AgentMode | null, entries: TranscriptEntry[]): null | string {
  const card = mode === 'motion' ? 'motion_setup' : mode === 'animation' ? 'animation_setup' : null
  if (!card || entries.some((e) => e.kind === card && e.state === 'chosen')) return null
  return card === 'motion_setup' ? 'Motion Reel' : 'animation'
}

/** Codex tool names are snake_case; the pill shows them as words. */
function toolLabel(name: string | undefined): string {
  return (name ?? '').replace(/_/g, ' ')
}

function TranscriptRow({
  answer,
  carryOn,
  chooseStyle,
  editing,
  entry,
  expiredHints,
  onEdit,
  sessionId,
  setupAnimation,
  setupMotionReel,
  startedProjectId,
  submittedIds,
}: {
  answer: AnswerFn
  /** Set on the expired card the chat can still answer: sends the answer as a message. */
  carryOn?: (text: string) => Promise<boolean>
  chooseStyle: ChooseStyleFn
  /** The chat is editing its finished video. */
  editing: boolean
  entry: TranscriptEntry
  /** What expired cards say, when not their default (an Easy chat takes no typed reply). */
  expiredHints?: ExpiredHints
  /** Opens the chat for editing (Easy only: Free chats are already open). */
  onEdit?: StartEditingFn
  sessionId: string
  /** Sends a Claude Animation's setup card. */
  setupAnimation: AgentSessionState['setupAnimation']
  /** Sends a Motion Reel's setup card. */
  setupMotionReel: AgentSessionState['setupMotionReel']
  /** Set on ReelMakeEasy's "Your video is being made" message: the video it follows. */
  startedProjectId?: string
  /** Question ids whose answer the server accepted, before `question_answered` arrives. */
  submittedIds: ReadonlySet<string>
}) {
  switch (entry.kind) {
    case 'assistant': {
      if (startedProjectId)
        return <VideoStartedLine projectId={startedProjectId} text={entry.text} />
      return <AgentMarkdown className="max-w-[80%]" text={entry.text} />
    }
    case 'image': {
      return <ImageEntry entry={entry} sessionId={sessionId} />
    }
    case 'animation_setup': {
      return <AnimationSetupCard entry={entry} onSubmit={setupAnimation} sessionId={sessionId} />
    }
    case 'motion_setup': {
      return <MotionReelSetupCard entry={entry} onSubmit={setupMotionReel} sessionId={sessionId} />
    }
    case 'motion_video': {
      return <MotionReelVideoCard entry={entry} />
    }
    case 'notice': {
      return <div className="text-sm text-amber-400">{entry.text}</div>
    }
    case 'question': {
      return (
        <QuestionRow
          answer={answer}
          {...(carryOn ? { carryOn } : {})}
          entry={entry}
          expiredHint={expiredHints?.question}
          submitted={submittedIds.has(entry.id)}
        />
      )
    }
    case 'style': {
      return (
        <StyleRequestCard entry={entry} expiredHint={expiredHints?.style} onChoose={chooseStyle} />
      )
    }
    case 'tool': {
      return <ToolEntry entry={entry} />
    }
    case 'user': {
      return (
        <div className="flex flex-col items-end gap-1.5">
          {entry.attachments?.length ? (
            <SentAttachmentCards attachments={entry.attachments} sessionId={sessionId} />
          ) : null}
          {entry.text && (
            <div className="max-w-[80%] rounded-2xl bg-fill-secondary px-3 py-2 text-sm whitespace-pre-wrap text-primary">
              {entry.text}
            </div>
          )}
        </div>
      )
    }
    case 'video': {
      return <VideoProgressCard editing={editing} onEdit={onEdit} projectId={entry.projectId} />
    }
    default: {
      return null
    }
  }
}

/**
 * The session's mode and whether its autonomous flow still runs (the composer then
 * only answers cards) or is over (`flowFinished`: an autonomous session is never a free
 * chat, so the composer stays locked). Right after a reload the session record knows the
 * mode before the replay does. The server's `flowActive` has the last word once known
 * (true or false), over `autonomousEnded` and a started video alike; the transcript decides
 * only while the server value is unknown (a re-fetch in flight).
 */
function useFlowState({
  autonomousEnded,
  editing,
  serverFlowActive,
  sessionMode,
  transcript,
}: {
  autonomousEnded: boolean
  /** The finished video is being edited: an autonomous session is a free chat again. */
  editing: boolean
  serverFlowActive: boolean | undefined
  sessionMode: AgentMode | undefined
  transcript: Transcript
}): { flowActive: boolean; flowFinished: boolean; mode: AgentMode | null } {
  const mode = transcript.mode ?? sessionMode ?? null
  const videoStarted = useMemo(
    () => transcript.entries.some((e) => e.kind === 'video'),
    [transcript.entries],
  )
  const autonomous = mode === 'autonomous'
  const flowActive = autonomous && (serverFlowActive ?? (!videoStarted && !autonomousEnded))
  return { flowActive, flowFinished: autonomous && !flowActive && !editing, mode }
}

/** Empties the composer when it locks, so stale text can't come back later. Adjusted
 *  during render (React's pattern for state derived from a change), not in an effect. */
function useClearWhenDisabled(disabled: boolean, setInput: (value: string) => void) {
  const [wasDisabled, setWasDisabled] = useState(disabled)
  if (disabled !== wasDisabled) {
    setWasDisabled(disabled)
    if (disabled) setInput('')
  }
}

/**
 * The Codex chat surface: transcript on top, a composer below. `working`
 * flips the Send button into Stop, and shows the live activity line ("Codex
 * is working..." when Codex hasn't said what it's doing) until the assistant's
 * own streamed text takes over. While a one-question card is open, typed text
 * answers it instead ("Answer") - unless the question is secret, which is only
 * answered in the card's password field. Only a click on Stop stops the turn:
 * Enter while Codex works with no card to answer does nothing. The button is
 * disabled while a send is in flight (Stop can't act until the turn has started
 * anyway). The transcript follows new output (and a card that grows, like the video
 * card turning into the finished video) as long as the user is already at the bottom.
 * The session comes from the page (`agent`), which shares it with the storyboard panel.
 *
 * The welcome card always comes first, and the composer stays disabled until a
 * mode is chosen there. While an autonomous flow runs (until its video starts, or
 * the flow is cut off) the composer only answers its cards: plain messages are
 * refused (the API would answer 409), and the button is Stop even between turns,
 * so the user can always leave the flow. Once the flow is over the session is not a
 * free chat: the composer stays disabled and says to start a new session - unless a
 * restart cut the flow off before its video, when "Pick up where you left off" under the
 * last card carries it on.
 */
export function AgentChat({
  agent,
  firstTool,
  headerStart,
  sessionId,
  startingMode,
  title,
}: AgentChatProps) {
  const {
    answer,
    chooseMode,
    chooseStyle,
    autonomousEnded,
    focusComposerAt,
    harnessStatus,
    notFound,
    resume,
    send,
    sending,
    serverFlowActive,
    session,
    setupAnimation,
    setupMotionReel,
    startEditing,
    stop,
    transcript,
  } = agent
  const who = agentNameOf(session)
  const editing = !!session?.editing
  const [input, setInput] = useState('')
  const [answering, setAnswering] = useState(false)
  // Answers the server accepted: their cards stay `open` until `question_answered`
  // arrives over SSE, but must not be answered again (that would 409).
  const [submittedIds, setSubmittedIds] = useState<ReadonlySet<string>>(() => new Set())
  const scrollRef = useRef<HTMLDivElement>(null)
  const atBottomRef = useRef(true)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  const voice = useVoiceTyping({ inputRef: composerRef, setValue: setInput, value: input })
  const files = useAttachments(sessionId)
  useAutoGrow(composerRef, input, COMPOSER_MAX_PX)

  const items = useMemo(() => groupEntries(transcript.entries), [transcript.entries])
  const startedLines = useMemo(() => videoStartedLines(transcript.entries), [transcript.entries])

  const openQuestions = useMemo(
    () =>
      transcript.entries.filter(
        (e): e is QuestionEntry => e.kind === 'question' && e.state === 'open',
      ),
    [transcript.entries],
  )
  const openQuestion = openQuestions.findLast((q) => !submittedIds.has(q.id))
  const onlyQuestion = openQuestion?.questions.length === 1 ? openQuestion.questions[0] : null
  // A secret answer typed in the composer would show in the clear: the card's password
  // field is the only way to answer one.
  const singleQuestion = onlyQuestion && !onlyQuestion.isSecret ? onlyQuestion : null
  /** A card is open that only its own Submit can answer (several questions, or a secret one). */
  const cardOnly = !!openQuestion && !singleQuestion

  const { activity } = transcript
  const { flowActive, flowFinished, mode } = useFlowState({
    autonomousEnded,
    editing,
    serverFlowActive,
    sessionMode: session?.mode,
    transcript,
  })
  const modeChosen = mode !== null
  const setupPending = setupPendingFor(mode, transcript.entries)
  const motionSetupPending = setupPending !== null
  // An Easy chat a restart cut off before its video: "Pick up where you left off" below it.
  const pickUp = canPickUp(session, transcript.entries, flowActive)
  const expiredHints = expiredHintsFor({ editing, flowActive, mode, pickUp })
  // The agent's last card, expired by a restart: still answerable while the chat takes messages.
  const carryOnId = carryOnCardId(transcript.entries, {
    busy: !modeChosen || motionSetupPending || flowFinished || flowActive || transcript.working,
  })
  const carryOn = useCallback((message: string) => send(message), [send])
  const lastEntry = transcript.entries[transcript.entries.length - 1]
  // The question wait needs no line of its own: the card is the prompt.
  const waitingOnCard = !!activity && openQuestions.some((q) => q.id === activity.id)
  // A Codex message streaming in already shows Codex is busy. A ReelMakeEasy note (e.g. "Let's
  // find you an idea") doesn't: the work it announces is still to come, so the line stays.
  const codexTalking =
    lastEntry?.kind === 'assistant' && !lastEntry.id.startsWith(REELMAKEEASY_MESSAGE_PREFIX)
  const showWorkingIndicator =
    transcript.working && (activity !== null || !codexTalking) && !waitingOnCard
  // A Motion Reel's to-do list is in its Tasks panel, beside the chat.
  const showPlan = transcript.working && !!transcript.plan?.length && !isMotionMode(mode)

  // Nothing to type before a mode is chosen, nor during autonomous mode with no card the
  // composer can answer, nor once autonomous mode is over; text left in the box then counts for nothing.
  const inputDisabled =
    !modeChosen || motionSetupPending || flowFinished || (flowActive && !singleQuestion)
  // An Easy ranking's topic card takes words only (what it's about): files come later.
  const canAttach = takesFiles(
    inputDisabled,
    flowActive || isRankingTopicQuestion(openQuestion?.id),
  )
  useClearWhenDisabled(inputDisabled, setInput)
  // Edit clicked: the user is told what to say, so the composer takes focus - once the
  // session re-fetch has unlocked it (a disabled textarea can't be focused).
  useEffect(() => {
    if (focusComposerAt && !inputDisabled) composerRef.current?.focus()
  }, [focusComposerAt, inputDisabled])
  const text = inputDisabled ? '' : input.trim()
  // A chat can be messaged while ReelMakeEasy's own card is open (Free chat, editing): text that
  // names none of its options goes to the agent instead (`composerCard`).
  const { answer: typedAnswer, cardOrMessage } = composerCard(
    openQuestion,
    singleQuestion,
    text,
    !flowActive,
  )
  const answerMode = typedAnswer !== null
  // With several questions (or a secret one) open, the card's Submit is the only way to answer.
  const sendBlocked = cardOnly && !!text
  /** The button stops the turn - or an autonomous flow, even between turns; Enter never does. */
  const stopMode = (transcript.working || flowActive) && !answerMode && !sendBlocked

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_PX
  }, [])

  // An image grows the pane only once it has loaded, after the effect below ran: follow it
  // down if the user was at the bottom. `load` doesn't bubble, so listen in the capture phase.
  const handleImageLoad = useCallback(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [])

  // A card can also grow with no new entry (the video card turning into the finished video):
  // follow any growth of the transcript's content while the user is at the bottom.
  const resizeObserverRef = useRef<null | ResizeObserver>(null)
  const contentRef = useCallback((node: HTMLDivElement | null) => {
    resizeObserverRef.current?.disconnect()
    resizeObserverRef.current = null
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const el = scrollRef.current
      if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
    })
    observer.observe(node)
    resizeObserverRef.current = observer
  }, [])

  // `entries` changes identity on every event, deltas included; the plan resizes the pane.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight
  }, [transcript.entries, showWorkingIndicator, showPlan])

  /** Answers a question (from its card or the composer) and remembers it once accepted. */
  const answerQuestion = useCallback<AnswerFn>(
    async (questionId, answers) => {
      atBottomRef.current = true
      const ok = await answer(questionId, answers)
      if (ok) setSubmittedIds((ids) => new Set(ids).add(questionId))
      return ok
    },
    [answer],
  )

  const handleSubmit = useCallback(() => {
    if (sending || answering) return
    if (answerMode && openQuestion && singleQuestion && typedAnswer !== null) {
      setAnswering(true)
      void answerQuestion(openQuestion.id, { [singleQuestion.id]: [typedAnswer] })
        .then((ok) => {
          if (ok) setInput('')
        })
        .finally(() => setAnswering(false))
      return
    }
    // Enter while Codex works (and no card to answer) must not stop the turn:
    // only a click on Stop does that.
    // Autonomous mode takes card answers only, and nothing once over (the API would answer 409).
    if (flowActive || flowFinished || sendBlocked || transcript.working) return
    // Files still uploading go with the message once they're saved: wait for them.
    if (sendWaits(text, canAttach, files)) return
    const attached = files.ready
    const taken = files.take()
    setInput('')
    // Sending your own message always brings you back to the bottom.
    atBottomRef.current = true
    void send(text, attached).then((sent) => {
      if (sent) return taken.release()
      // Refused (the notice says why): the text and files are back in the box, to try again.
      taken.restore()
      setInput((now) => now || text)
    })
  }, [
    answerMode,
    answerQuestion,
    answering,
    canAttach,
    files,
    flowActive,
    flowFinished,
    openQuestion,
    send,
    sendBlocked,
    sending,
    singleQuestion,
    text,
    transcript.working,
    typedAnswer,
  ])

  const handleButtonClick = useCallback(() => {
    if (stopMode) void stop()
    else handleSubmit()
  }, [handleSubmit, stop, stopMode])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  if (notFound) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-background text-primary">
        <p className="text-sm text-secondary">Session not found</p>
        <Link className="text-sm text-primary underline" href="/home">
          Back home
        </Link>
      </div>
    )
  }

  const placeholder = composerPlaceholder({
    cardOrMessage,
    cardQuestions: cardOnly ? openQuestion.questions.length : 0,
    editing,
    flowActive,
    flowFinished,
    modeChosen,
    pickUp: pickUp && resumeWords(session?.resume).button,
    setupPending,
    singleQuestion: !!singleQuestion,
    who,
    working: transcript.working,
  })
  const buttonLabel = answerMode ? 'Answer' : stopMode ? 'Stop' : 'Send'

  return (
    <div className="flex h-full flex-col bg-background text-primary">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3 text-sm font-medium text-secondary">
        {headerStart}
        <span className="min-w-0 truncate">{title || session?.title || 'Agent'}</span>
      </div>
      <div
        className="flex-1 overflow-y-auto p-4"
        onLoadCapture={handleImageLoad}
        onScroll={handleScroll}
        ref={scrollRef}
      >
        <div className="flex flex-col gap-3" ref={contentRef}>
          <WelcomeCard
            chosenHarness={chosenHarnessOf(session)}
            firstTool={firstTool}
            mode={mode}
            onChoose={chooseMode}
            presetHarness={presetHarnessOf(session)}
            startingMode={startingMode}
            status={harnessStatus}
          />
          {items.map((item) =>
            item.type === 'activity' ? (
              <ActivityGroup entries={item.entries} key={item.key} />
            ) : (
              <TranscriptRow
                answer={answerQuestion}
                {...(item.entry.id === carryOnId ? { carryOn } : {})}
                chooseStyle={chooseStyle}
                editing={editing}
                entry={item.entry}
                expiredHints={expiredHints}
                key={item.key}
                onEdit={mode === 'autonomous' ? startEditing : undefined}
                sessionId={sessionId}
                setupAnimation={setupAnimation}
                setupMotionReel={setupMotionReel}
                startedProjectId={startedLines.get(item.entry.id)}
                submittedIds={submittedIds}
              />
            ),
          )}
          {pickUp && <ResumeCard action={session?.resume} onResume={resume} />}
          {showWorkingIndicator && (
            <div className="flex items-center gap-1.5 text-sm text-secondary">
              <Spinner />
              <span>{activity?.label ?? `${who} is working…`}</span>
            </div>
          )}
        </div>
      </div>
      {showPlan && transcript.plan && (
        <div className="max-h-40 overflow-y-auto border-t border-white/10 px-4 py-2">
          <AgentPlan steps={transcript.plan} />
        </div>
      )}
      <AttachmentDropZone canAttach={canAttach} files={files}>
        <div className="flex items-end gap-2 p-3">
          <AttachButton canAttach={canAttach} files={files} />
          <Textarea
            className="max-h-[200px] min-h-11 flex-1 resize-none rounded-lg border-white/10 bg-fill-secondary py-[11px] text-sm leading-5 text-primary placeholder:text-secondary disabled:opacity-60"
            disabled={inputDisabled}
            onChange={setInput}
            onFocus={voice.prewarm}
            onKeyDown={handleKeyDown}
            onPaste={pasteFiles(canAttach, files)}
            placeholder={placeholder}
            ref={composerRef}
            rows={1}
            value={input}
          />
          <MicButton dictation={voice} disabled={inputDisabled} />
          <Button
            className="h-11 shrink-0 rounded-lg px-4"
            disabled={
              sending ||
              answering ||
              sendBlocked ||
              (!stopMode && sendWaits(text, canAttach, files))
            }
            onClick={handleButtonClick}
            type="button"
          >
            {buttonLabel}
          </Button>
        </div>
        <ChatModelBar session={session} />
      </AttachmentDropZone>
    </div>
  )
}
