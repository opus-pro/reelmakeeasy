import { randomUUID } from 'node:crypto'

import { isStoreUri } from '@reelmakeeasy/common/storage/address'
import { projectRootKey, storedFileUrl } from '@reelmakeeasy/common/storage/stored-files'

import { createPlannerStorage } from '../persistence'
import { computeChangedShotFields, renderPlanMd, ShotChangeMap } from '../renderer'
import {
  ClarifyOption,
  PlannerPhase,
  SessionResponse,
  SessionState,
  SessionStatus,
  Spec,
  SpecHistoryTurn,
} from '../types'

import { getScriptSource } from './session-runtime'

interface MessageRuntimeDeps {
  sessionStore: {
    appendMessage: (
      session: SessionState,
      message: {
        content: string
        expect_assets?: boolean
        message_id?: string
        options?: ClarifyOption[]
        phase?: PlannerPhase
        question_index?: number
        role: 'assistant'
        spec_version?: number
        timestamp: string
      },
    ) => void
  }
}

export function appendAgentReply(
  runtime: object,
  session: SessionState,
  content: string,
  options?: ClarifyOption[],
  expectAssets?: boolean,
  questionIndex?: number,
): void {
  const deps = runtime as MessageRuntimeDeps
  deps.sessionStore.appendMessage(session, {
    role: 'assistant',
    content,
    expect_assets: expectAssets === true ? true : undefined,
    message_id: randomUUID(),
    options,
    phase: session.todo_state.phase,
    question_index: questionIndex,
    spec_version: session.spec.meta.spec_version,
    timestamp: new Date().toISOString(),
  })
}

export function appendProgressReply(
  runtime: object,
  session: SessionState,
  summary: string,
  options?: { reviewHint?: boolean },
): void {
  const reviewHint = options?.reviewHint ? '\n\nTake a look and tell me what to change.' : ''
  appendAgentReply(runtime, session, `${summary}${reviewHint}`)
}

/**
 * Build a full SessionResponse from session state.
 *
 * `opts.skipHeavyFields` omits `plan_md` (renderPlanMd) and `spec_history_turns`
 * (buildSpecHistoryTurns). Use this for status-only callbacks (publishSessionStatus)
 * where the API handler never reads those fields -- avoids redundant computation on
 * every loop iteration.
 */
export function buildResponse(
  session: SessionState,
  opts?: { skipHeavyFields?: boolean },
): SessionResponse {
  const lastMessage = session.transcript[session.transcript.length - 1]
  const reply = lastMessage?.role === 'assistant' ? lastMessage.content : ''
  const changedShotFields = getChangedShotFieldsForResponse(session)
  const lastDiffSummary = getLastDiffSummary(session)
  const storage = createPlannerStorage(session.sessionId)

  return {
    audio_path: session.audioPath,
    anchor_assets: session.cached_artifacts.anchor_assets_summary
      ? {
          ...session.cached_artifacts.anchor_assets_summary,
          anchors: session.cached_artifacts.anchor_assets_summary.anchors.map((anchor) => ({
            ...anchor,
            // An address: served as a URL when the session is sent to a browser.
            preview_url: anchor.preview_relative_path
              ? storage.getFullPath(anchor.preview_relative_path)
              : null,
          })),
        }
      : null,
    session_id: session.sessionId,
    spec: session.spec,
    plan_md: opts?.skipHeavyFields
      ? ''
      : renderPlanMd(session.spec, {
          changedShots: changedShotFields,
          lastDiffSummary,
        }),
    diff_summary: lastDiffSummary,
    gui_request_id: session.cached_artifacts.brand_draft_gui_request_id,
    is_idle: session.is_idle ?? false,
    is_processing: session.is_processing,
    is_running_planner_loop: session.is_running_planner_loop,
    blocking: session.spec.meta.blocking,
    can_undo: session.spec_history.length > 0,
    locked_at: session.spec.meta.locked_at ?? null,
    open_questions: session.spec.meta.open_questions,
    mode_state: session.spec.meta.mode_state,
    phase: session.todo_state.phase,
    auto_lock_deadline_at: session.spec.meta.auto_lock_deadline_at,
    review_auto_continue_deadline_at: session.review_auto_continue_deadline_at ?? null,
    script_word_cap_exceeded: session.spec.meta.script_word_cap?.exceeded === true,
    reply,
    reply_expect_assets:
      lastMessage?.role === 'assistant' ? lastMessage.expect_assets === true : false,
    reply_options: lastMessage?.role === 'assistant' ? [...(lastMessage.options ?? [])] : [],
    script_review_context: {
      script: getScriptSource(session) ?? '',
      global_constraints: JSON.parse(
        JSON.stringify(
          session.cached_artifacts.pending_global_constraints ?? session.spec.global_constraints,
        ),
      ),
    },
    transcript: session.transcript.map((message) => ({
      ...message,
      options: message.options ? [...message.options] : undefined,
    })),
    queued_items: (session.queued_items ?? []).map((item) => ({
      ...item,
      uploaded_assets: item.uploaded_assets.map((asset) => ({ ...asset })),
    })),
    tool_call_states: (session.tool_call_states ?? []).map((item) => ({
      ...item,
      tools: [...item.tools],
    })),
    review_gate: session.review_gate
      ? {
          kind: session.review_gate.kind,
          status: session.review_gate.status,
          token: session.review_gate.token,
          options: session.review_gate.options.map((option) => ({ ...option })),
        }
      : null,
    uploaded_assets: (session.cached_artifacts.uploaded_assets ?? []).map((asset) => ({
      ...asset,
      preview_url: resolveUploadedAssetPreviewUrl(session.sessionId, asset.file_path),
    })),
    status: computeSessionStatus(session),
    failure_message: extractFailureMessage(session),
    spec_history_turns: opts?.skipHeavyFields ? [] : buildSpecHistoryTurns(session),
  }
}

export function buildSpecHistoryTurns(session: SessionState): SpecHistoryTurn[] {
  if (!session.spec_history?.length) {
    return []
  }

  const userMessages = session.transcript
    .filter((m) => m.role === 'user')
    .map((m) => ({ text: m.content, timestamp: Date.parse(m.timestamp) }))

  if (userMessages.length === 0) {
    return []
  }

  const turns: SpecHistoryTurn[] = []
  for (let i = 0; i < userMessages.length; i++) {
    const turnStart = userMessages[i].timestamp
    const turnEnd = i < userMessages.length - 1 ? userMessages[i + 1].timestamp : Infinity

    const turnEntries = session.spec_history.filter((entry) => {
      const t = Date.parse(entry.timestamp)
      return t >= turnStart && t < turnEnd
    })

    if (turnEntries.length === 0) {
      continue
    }

    const changes = turnEntries.map((entry, idx) => ({
      diff_summary: entry.diff_summary,
      ops: entry.ops,
      source: entry.source,
      spec_version:
        idx < turnEntries.length - 1
          ? (turnEntries[idx + 1].prev_spec?.meta?.spec_version ??
            entry.prev_spec.meta.spec_version)
          : session.spec.meta.spec_version,
      timestamp: entry.timestamp,
    }))

    turns.push({
      user_message_preview: userMessages[i].text.slice(0, 100),
      turn_start_time: new Date(turnStart).toISOString(),
      turn_end_time: Number.isFinite(turnEnd) ? new Date(turnEnd).toISOString() : null,
      spec_version_before: turnEntries[0].prev_spec.meta.spec_version,
      spec_version_after: changes[changes.length - 1].spec_version,
      changes,
    })
  }

  return turns
}

/**
 * Compute session status from workflow-level flags on session state.
 * Mirrors the logic used by persistFromCallback on the API side.
 *
 * Priority order (once locked_at is set, that wins; otherwise failure wins over
 * cancellation/timeout because failure indicates an unrecoverable error state
 * that the user needs to see clearly):
 *   locked_at -> completed
 *   _failed -> failed
 *   _cancelled -> cancelled
 *   _timed_out -> timed_out
 *   else -> active
 */
function computeSessionStatus(session: SessionState): SessionStatus {
  if (session.spec.meta.locked_at) {
    return 'completed'
  }
  // These flags are set by workflow signal handlers but not part of core SessionState type.
  const flags = session as SessionState & {
    _cancelled?: boolean
    _failed?: boolean
    _timed_out?: boolean
  }
  if (flags._failed) {
    return 'failed'
  }
  if (flags._cancelled) {
    return 'cancelled'
  }
  if (flags._timed_out) {
    return 'timed_out'
  }
  return 'active'
}

/**
 * Extract the failure_message string off the workflow-level flag.
 * Only populated when the session terminated via a hard-fail path
 * (currently: pre-voiceover ASR failure in the bootstrap_script gate).
 */
function extractFailureMessage(session: SessionState): string | undefined {
  const flags = session as SessionState & { _failure_message?: string }
  return flags._failure_message ?? undefined
}

/**
 * Group spec_history entries by user turn (user message timestamps as boundaries).
 * Returns a lightweight summary suitable for timeline UI rendering.
 */
export function getChangedShotFieldsForResponse(session: SessionState): ShotChangeMap | undefined {
  const turnBaseline = (session as SessionState & { _turnChangeBaselineSpec?: unknown })
    ._turnChangeBaselineSpec
  if (isSpecLike(turnBaseline)) {
    return computeChangedShotFields(turnBaseline, session.spec)
  }

  const rawChangedShotFields = (session as unknown as { _lastChangedShotFields?: unknown })
    ._lastChangedShotFields
  if (rawChangedShotFields instanceof Map) {
    return rawChangedShotFields as ShotChangeMap
  }

  const lastHistory = session.spec_history[session.spec_history.length - 1]
  if (!lastHistory) {
    return undefined
  }

  const historyTimestamp = Date.parse(lastHistory.timestamp)
  const hasNewerUserTurn =
    Number.isFinite(historyTimestamp) &&
    session.transcript.some(
      (message) => message.role === 'user' && Date.parse(message.timestamp) > historyTimestamp,
    )

  if (hasNewerUserTurn) {
    return undefined
  }

  return computeChangedShotFields(lastHistory.prev_spec, session.spec)
}

export function getLastDiffSummary(session: SessionState): string {
  return session.spec_history[session.spec_history.length - 1]?.diff_summary ?? ''
}

function isSpecLike(value: unknown): value is Spec {
  if (!value || typeof value !== 'object') {
    return false
  }
  const maybeSpec = value as Partial<Spec>
  return Boolean(maybeSpec.meta && maybeSpec.global_constraints && maybeSpec.visual_script)
}

function resolveUploadedAssetPreviewUrl(sessionId: string, fileUri: string): null | string {
  if (!fileUri) {
    return null
  }
  if (fileUri.startsWith('https://') || fileUri.startsWith('http://')) {
    return fileUri
  }
  if (isStoreUri(fileUri)) {
    return storedFileUrl(fileUri)
  }
  // Relative path under the project folder: projects/{sessionId}/user-intent-planner/{fileUri}
  return storedFileUrl(`${projectRootKey(sessionId)}/user-intent-planner/${fileUri}`)
}
