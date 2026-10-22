'use client'

import {
  initialTranscript,
  reduceTranscript,
  type Transcript,
} from '@reelmakeeasy/common/codex-agent/agent-transcript'
import type {
  AgentAnswers,
  AgentHarnessName,
  AgentMode,
  AgentSession,
  AgentStatusResponse,
  AgentUiEvent,
} from '@shared/types/api/agent'
import { useQueryClient } from '@tanstack/react-query'
import { useSetAtom } from 'jotai'
import { useEffect, useReducer, useRef, useState } from 'react'

import { useRefCallback } from '@/hooks/use-ref-callback'
import { type CreateSSEConnection, useApi } from '@/hooks/useApi'
import { ApiError } from '@/lib/api-error'

import { HARNESS_LABEL, HARNESS_SHORT } from './agent-harness'
import { noteVideoRenderedAtom } from './renderedVersions'
import { resumeRefusedNotice } from './resume-chat'

const SSE_TIMEOUT_MS = 10000
const RECONNECT_DELAY_MS = 2000
/** Events that may change the session record arrive in bursts (a replay): one GET per burst. */
const SESSION_REFRESH_DELAY_MS = 100

/** `SSEConnection.start()` rejects with `SSE open failed: <status>` for a non-2xx open. */
const isSseNotFound = (error: Error) => /^SSE open failed: 404\b/.test(error.message)
/** 403: the API's loopback guard refused this browser (not on this computer, or via a proxy). */
const isSseForbidden = (error: Error) => /^SSE open failed: 403\b/.test(error.message)
const FORBIDDEN_NOTICE =
  'Agent mode only works on the computer running ReelMakeEasy. Open http://localhost:3000 there.'
/** Refusals (409) whose message says why, shown as is: chat in an autonomous session (its flow
 *  runs, or is over), and files sent before an Easy ranking's topic is picked. */
const SHOWN_REFUSAL_RE =
  /^(Autonomous mode is making your video|This autonomous session is finished|Pick what the ranking is about first)\b/

/**
 * Loads an agent session, streams its transcript over SSE (replaying from
 * `lastEventId` on every (re)connect), and exposes `send`/`stop` for the
 * composer and `answer` for Codex's question cards. One connection is kept
 * open for the lifetime of the hook; a connection that drops - or ends
 * cleanly, as it does when the API shuts down - reconnects after a short
 * delay with `?after=` set to whatever the reducer has already seen, so a
 * reconnect never duplicates entries. An
 * unknown session (404) sets `notFound` and stops reconnecting.
 *
 * `chooseMode` and `chooseStyle` answer the welcome card and the autonomous style
 * card. Whether an autonomous flow still runs is the server's `session.flowActive`
 * (`serverFlowActive`): once known (true or false) it has the last word. It is
 * undefined while a re-fetch is in flight or before the first one lands, and only then
 * does the caller fall back to the transcript. The session is re-fetched after Stop and
 * on the events that can start, end or move a flow (`mode`, a stop or `idle`, a notice,
 * `video_started`, `flow_cancelled`). `autonomousEnded` is the transcript-side fallback: it
 * turns true once an autonomous flow was cut off (a session stop, an expired card, a
 * cancelled flow, or a click on Stop). `resume` picks up an Easy chat a restart cut off (the
 * record's `interrupted`, re-read whenever the stream reconnects).
 */
export function useAgentSession(sessionId: string | undefined) {
  const { fetchApiDomain, createSSEConnection } = useApi()
  const queryClient = useQueryClient()
  const noteVideoRendered = useSetAtom(noteVideoRenderedAtom)
  const [session, setSession] = useState<AgentSession | null>(null)
  const [notFound, setNotFound] = useState(false)
  const [sending, setSending] = useState(false)
  const [autonomousEnded, setAutonomousEnded] = useState(false)
  // A session GET is scheduled or in flight: `session` may be stale until it lands.
  const [sessionFetching, setSessionFetching] = useState(true)
  const [transcript, dispatch] = useReducer(reduceTranscript, initialTranscript)

  const transcriptRef = useRef<Transcript>(transcript)
  transcriptRef.current = transcript
  /** The id of the newest message of the user's the server has sent the chat. */
  const lastUserMessageRef = useRef(0)

  const connectionRef = useRef<null | ReturnType<CreateSSEConnection>>(null)
  // The stream opened once already: a later open is a reconnect (e.g. after a restart).
  const streamedRef = useRef(false)
  const reconnectTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null)
  const connectRef = useRef<() => void>(() => undefined)
  const stoppedRef = useRef(false)
  const noticeSeqRef = useRef(0)
  // Mirrors `sending` synchronously, so two Enter presses in one render can't both send.
  const sendingRef = useRef(false)
  // The mode as the event stream announced it, ahead of the reducer's (batched) state.
  const streamModeRef = useRef<AgentMode | null>(null)
  // Only the latest session GET's answer counts; bumped on every load and on cleanup.
  const sessionSeqRef = useRef(0)
  const sessionRefreshTimerRef = useRef<null | ReturnType<typeof setTimeout>>(null)

  /** (Re)loads the session record (title, mode, `flowActive`). */
  const loadSession = useRefCallback(() => {
    if (!sessionId) return
    sessionSeqRef.current += 1
    const seq = sessionSeqRef.current
    setSessionFetching(true)
    void fetchApiDomain<AgentSession>('/api/agent/sessions/{id}', {
      method: 'GET',
      pathParams: { id: sessionId },
    })
      .then((response) => {
        if (seq === sessionSeqRef.current) setSession(response.data)
      })
      .catch((error: unknown) => {
        if (seq === sessionSeqRef.current && error instanceof ApiError && error.status === 404)
          markNotFound()
        // Other failures: the SSE connection surfaces a broken session; this fetch
        // is best-effort (title, mode, flowActive).
      })
      .finally(() => {
        if (seq === sessionSeqRef.current) setSessionFetching(false)
      })
  })

  /** Re-fetches the session soon, once for a burst of events; stale until then. */
  const scheduleSessionRefresh = useRefCallback(() => {
    setSessionFetching(true)
    if (sessionRefreshTimerRef.current) return
    sessionRefreshTimerRef.current = setTimeout(() => {
      sessionRefreshTimerRef.current = null
      loadSession()
    }, SESSION_REFRESH_DELAY_MS)
  })

  /** Tracks what ends an autonomous flow, which the reducer keeps no state for. Events
   *  replay in order on every (re)connect, so this rebuilds on a reload. The events that
   *  can change the flow server-side also re-fetch the session for its `flowActive`. */
  const trackFlow = useRefCallback((event: AgentUiEvent) => {
    if (event.type === 'mode') streamModeRef.current = event.mode
    // The chat opened for editing: the session record says so (the composer unlocks).
    if (event.type === 'editing') scheduleSessionRefresh()
    if (event.type === 'video_rendered') {
      // The chat rebuilt the video. The storyboard's clips first, so a player remounted for
      // the new file builds its plan from the new state; then the file itself.
      const { projectId } = event
      void queryClient
        .invalidateQueries({ queryKey: ['long-take-state', projectId] })
        .finally(() => noteVideoRendered(projectId))
    }
    if (streamModeRef.current !== 'autonomous') return
    const stopped = event.type === 'session' && event.status === 'stopped'
    const idle = event.type === 'session' && event.status === 'idle'
    const cancelled = event.type === 'flow_cancelled'
    if (stopped || cancelled || event.type === 'question_expired') setAutonomousEnded(true)
    if (
      stopped ||
      idle ||
      cancelled ||
      event.type === 'mode' ||
      event.type === 'notice' ||
      event.type === 'video_started'
    )
      scheduleSessionRefresh()
  })

  const dispatchRaw = useRefCallback((raw: string) => {
    let event: AgentUiEvent
    try {
      event = JSON.parse(raw) as AgentUiEvent
    } catch {
      // Malformed event payload; nothing sane to show for it.
      return
    }
    trackFlow(event)
    // As the event arrives, not at the next render: a send's outcome reads it.
    if (event.type === 'user_message' && (event.id ?? 0) > lastUserMessageRef.current)
      lastUserMessageRef.current = event.id ?? 0
    dispatch(event)
  })

  /** Bumped when the composer should take focus (the user clicked Edit); it focuses once
   *  the session re-fetch unlocks it. */
  const [focusComposerAt, setFocusComposerAt] = useState(0)
  /** Which harnesses can run this chat, for the welcome card (fetched while no mode is set). */
  const [harnessStatus, setHarnessStatus] = useState<AgentStatusResponse | null>(null)
  const modeSet = !!session?.mode
  useEffect(() => {
    if (!sessionId || modeSet) return
    let cancelled = false
    fetchApiDomain<AgentStatusResponse>('/api/agent/status', { method: 'GET' })
      .then(({ data }) => {
        if (!cancelled) setHarnessStatus(data)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [fetchApiDomain, modeSet, sessionId])

  const addLocalNotice = useRefCallback((text: string) => {
    noticeSeqRef.current += 1
    dispatch({ noticeId: `local-${noticeSeqRef.current}`, text, type: 'local_notice' })
  })

  const stopStreaming = useRefCallback(() => {
    stoppedRef.current = true
    if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
    reconnectTimerRef.current = null
    connectionRef.current?.close()
    connectionRef.current = null
  })

  const markNotFound = useRefCallback(() => {
    stopStreaming()
    setNotFound(true)
  })

  const scheduleReconnect = useRefCallback(() => {
    if (stoppedRef.current || reconnectTimerRef.current) return
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null
      connectRef.current()
    }, RECONNECT_DELAY_MS)
  })

  const connect = useRefCallback(() => {
    if (!sessionId || stoppedRef.current) return
    connectionRef.current?.close()

    const connection = createSSEConnection(
      `/api/agent/sessions/${sessionId}/events?after=${transcriptRef.current.lastEventId}`,
      {
        agent: (payload) => dispatchRaw(payload.data),
        // Back after a restart: the record may have changed with no event to replay (an Easy
        // chat cut off by the restart offers to pick up where it left off).
        hello: () => {
          if (streamedRef.current) loadSession()
          streamedRef.current = true
        },
        message: () => undefined,
        error: (payload) => {
          if (payload.raw_error?.name === 'AbortError') return
          scheduleReconnect()
        },
      },
      { timeoutMs: SSE_TIMEOUT_MS },
    )
    connectionRef.current = connection
    void connection.start().then(
      // The stream ended without an error (e.g. the API is shutting down): reconnect
      // too, unless this connection was replaced or the hook unmounted.
      () => {
        if (connectionRef.current === connection) scheduleReconnect()
      },
      (error: Error) => {
        if (error.name === 'AbortError' || connectionRef.current !== connection) return
        if (isSseNotFound(error)) {
          markNotFound()
          return
        }
        // Retrying can't change the answer, so stop and say why.
        if (isSseForbidden(error)) {
          stopStreaming()
          addLocalNotice(FORBIDDEN_NOTICE)
          return
        }
        scheduleReconnect()
      },
    )
  })
  connectRef.current = connect

  useEffect(() => {
    stoppedRef.current = false
    streamedRef.current = false
    lastUserMessageRef.current = 0
    setNotFound(false)
    setAutonomousEnded(false)
    streamModeRef.current = null
    if (!sessionId) return undefined

    loadSession()
    connectRef.current()

    return () => {
      // Drops the answer of any GET still in flight for this session.
      sessionSeqRef.current += 1
      if (sessionRefreshTimerRef.current) clearTimeout(sessionRefreshTimerRef.current)
      sessionRefreshTimerRef.current = null
      stopStreaming()
    }
    // `fetchApiDomain` is a stable-by-ref helper; only the session id should retrigger this.
  }, [sessionId])

  /** Sends a message; `attachments` are the saved names of files attached to it (it may be
   *  only files). Resolves to whether it went (the chat shows it): false when it was refused or
   *  never reached the API, so the composer can give the user their text and files back. */
  const send = useRefCallback(async (text: string, attachments: string[] = []) => {
    const trimmed = text.trim()
    if ((!trimmed && !attachments.length) || !sessionId || sendingRef.current) return false
    const shownBefore = lastUserMessageRef.current
    sendingRef.current = true
    setSending(true)
    try {
      await fetchApiDomain('/api/agent/sessions/{id}/messages', {
        method: 'POST',
        pathParams: { id: sessionId },
        data: { ...(attachments.length ? { attachments } : {}), text: trimmed },
      })
      return true
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined
      if (status === 404) {
        markNotFound()
      } else if (status === 409) {
        // An autonomous flow still runs, or the topic isn't picked yet (their own messages say
        // so), or the turn in flight does; don't touch `working`.
        const message = error instanceof Error ? error.message : ''
        addLocalNotice(
          SHOWN_REFUSAL_RE.test(message)
            ? message
            : `${HARNESS_SHORT[session?.harness ?? 'codex']} is still working on the previous message.`,
        )
      } else if (status === undefined || status < 500) {
        // A 5xx means the server got past accepting the message and has already
        // reported the failure as an event (turn failed / session stopped).
        addLocalNotice('Failed to send the message.')
      }
      // A 5xx usually comes after the message was taken: the server sent it to the chat before
      // trying to start the turn (and the failure follows it). If it never came, it never went.
      return status !== undefined && status >= 500 && lastUserMessageRef.current > shownBefore
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  })

  const stop = useRefCallback(async () => {
    if (!sessionId) return
    // Stop ends a running autonomous flow too (the API cancels it at its next step).
    if (transcriptRef.current.mode === 'autonomous') setAutonomousEnded(true)
    try {
      await fetchApiDomain('/api/agent/sessions/{id}/interrupt', {
        method: 'POST',
        pathParams: { id: sessionId },
      })
    } catch {
      // The turn's own failure/interrupted event (if any) will surface via SSE.
    }
    // The interrupt may have ended an autonomous flow: `flowActive` says.
    loadSession()
  })

  /** Answers an open question card; resolves false (after a notice) when the server refused it. */
  const answer = useRefCallback(
    async (questionId: string, answers: AgentAnswers): Promise<boolean> => {
      if (!sessionId) return false
      try {
        await fetchApiDomain('/api/agent/sessions/{id}/questions/{questionId}/answer', {
          data: { answers },
          method: 'POST',
          // `pathParams` values are substituted verbatim, so encode the Codex-issued id.
          pathParams: { id: sessionId, questionId: encodeURIComponent(questionId) },
        })
        return true
      } catch (error) {
        const status = error instanceof ApiError ? error.status : undefined
        // Not open on the server any more (e.g. a card asked before ReelMakeEasy restarted): the
        // card expires here too, so it isn't answered again.
        if (status === 409) dispatch({ questionId, type: 'local_question_expired' })
        addLocalNotice(
          status === 409
            ? 'That question is no longer open.'
            : 'Could not send your answer. Try again.',
        )
        return false
      }
    },
  )

  /** Picks how the session starts (the welcome card); resolves false (after a notice) on failure. */
  const chooseMode = useRefCallback(
    async (mode: AgentMode, harness?: AgentHarnessName): Promise<boolean> => {
      if (!sessionId) return false
      try {
        await fetchApiDomain('/api/agent/sessions/{id}/mode', {
          data: harness ? { harness, mode } : { mode },
          method: 'POST',
          pathParams: { id: sessionId },
        })
        return true
      } catch (error) {
        const status = error instanceof ApiError ? error.status : undefined
        if (status === 404) {
          markNotFound()
          return false
        }
        const message = error instanceof Error ? error.message : ''
        const conflict = /not ready/.test(message)
          ? `${HARNESS_LABEL[harness ?? 'codex']} isn't ready. Check it is installed and signed in, then try again.`
          : 'A mode was already chosen.'
        addLocalNotice(status === 409 ? conflict : 'Could not start that mode. Try again.')
        return false
      }
    },
  )

  /** Answers the autonomous style card; resolves false (after a notice) on failure. */
  const chooseStyle = useRefCallback(async (styleId: string): Promise<boolean> => {
    if (!sessionId) return false
    try {
      await fetchApiDomain('/api/agent/sessions/{id}/style', {
        data: { styleId },
        method: 'POST',
        pathParams: { id: sessionId },
      })
      return true
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined
      if (status === 404) {
        markNotFound()
        return false
      }
      addLocalNotice(
        status === 409
          ? 'This style step is no longer open.'
          : status === 400
            ? "That style isn't available. Pick another one."
            : 'Could not choose that style. Try again.',
      )
      return false
    }
  })

  /** "Pick up where you left off": carries on an Easy chat a restart cut off, from its open
   *  card. False (with a notice saying why, in the API's words) when the API refuses. */
  const resume = useRefCallback(async (): Promise<boolean> => {
    if (!sessionId) return false
    try {
      await fetchApiDomain('/api/agent/sessions/{id}/resume', {
        method: 'POST',
        pathParams: { id: sessionId },
      })
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined
      if (status === 404) {
        markNotFound()
        return false
      }
      addLocalNotice(
        resumeRefusedNotice(status, error instanceof ApiError ? error.message : undefined),
      )
      // The chat may have moved on meanwhile (picked up in another tab): read it again.
      loadSession()
      return false
    }
    // The flow runs again: its cards arrive on the stream, and the record says so.
    setAutonomousEnded(false)
    loadSession()
    return true
  })

  /** The Edit card: opens this chat for editing its finished video. False (with a notice)
   *  when the API refuses, e.g. while the video is still rendering. */
  const startEditing = useRefCallback(async (): Promise<boolean> => {
    if (!sessionId) return false
    try {
      await fetchApiDomain('/api/agent/sessions/{id}/edit', {
        method: 'POST',
        pathParams: { id: sessionId },
      })
    } catch (error) {
      const status = error instanceof ApiError ? error.status : undefined
      if (status === 404) {
        markNotFound()
        return false
      }
      // A 409 says why the chat cannot be edited yet.
      addLocalNotice(
        error instanceof ApiError && error.message ? error.message : 'Could not start editing.',
      )
      return false
    }
    scheduleSessionRefresh()
    setFocusComposerAt((n) => n + 1)
    return true
  })

  return {
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
    startEditing,
    /** The server's `session.flowActive`; undefined while it may be stale or is unknown. */
    serverFlowActive: sessionFetching ? undefined : session?.flowActive,
    session,
    stop,
    transcript,
  }
}

/** Everything `useAgentSession` gives the page: lifted to the page so the chat and the
 *  storyboard panel share one session (and one SSE connection). */
export type AgentSessionState = ReturnType<typeof useAgentSession>
