import { persistSpecSnapshot } from '../persistence'
import {
  OpenQuestion,
  PlannerScopeSpec,
  PlannerToolCall,
  PlannerToolParams,
  SessionState,
  Spec,
  UndoScope,
  UploadedAsset,
} from '../types'

interface SessionRuntimeDeps {
  appendAgentReply: (session: SessionState, content: string) => void
  getPendingTodoCount: (session: SessionState) => number
  syncPostSpecMutation: (
    session: SessionState,
    prevSpec: Spec,
    extraQuestions?: OpenQuestion[],
    options?: { clearPendingArtifacts?: boolean },
  ) => void
}

export async function executeUndoLastInternal(
  runtime: object,
  session: SessionState,
  _source: 'AGENT' | 'UI',
  options?: { count?: number; undo_scope?: UndoScope },
): Promise<{ message: string; ok: boolean; undoneCount?: number }> {
  const deps = asDeps(runtime)
  if (session.spec.meta.locked_at) {
    return { ok: false, message: 'Session is locked. No further edits allowed.' }
  }

  const undoScope = options?.undo_scope ?? 'LAST_CHANGE'
  const undoCountResult = resolveUndoCountByScope(session, undoScope, options?.count)
  if (!undoCountResult.ok) {
    return { ok: false, message: undoCountResult.message }
  }
  const undoCount = undoCountResult.count
  if (!undoCount || undoCount <= 0) {
    return { ok: false, message: 'No previous spec version is available to undo.' }
  }

  const undoneEntries = session.spec_history.slice(-undoCount)
  const targetEntry = undoneEntries[0]
  if (!targetEntry) {
    return { ok: false, message: 'No previous spec version is available to undo.' }
  }
  const previousHistory = [...session.spec_history]

  const currentSpec: Spec = JSON.parse(JSON.stringify(session.spec))
  session.spec_history = session.spec_history.slice(0, -undoCount)
  session.spec = JSON.parse(JSON.stringify(targetEntry.prev_spec))
  deps.syncPostSpecMutation(session, currentSpec)
  try {
    await persistSpecSnapshot(session.sessionId, session.spec)
  } catch (error) {
    session.spec = currentSpec
    session.spec_history = previousHistory
    deps.syncPostSpecMutation(session, targetEntry.prev_spec)
    return {
      ok: false,
      message: `Undo failed to persist snapshot: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (undoScope === 'LAST_USER_TURN') {
    deps.appendAgentReply(session, 'I undid the changes from your last message.')
  } else if (undoScope === 'COUNT') {
    deps.appendAgentReply(session, `I undid your last ${undoCount} updates.`)
  } else {
    deps.appendAgentReply(session, 'I undid the last update.')
  }
  return { ok: true, message: 'Undo completed.', undoneCount: undoCount }
}

export function getAllowedUploadedAssetIds(session: SessionState): string[] {
  return (session.cached_artifacts.uploaded_assets ?? []).map((asset) => asset.asset_id)
}

export function getScriptSource(session: SessionState): null | string {
  if (session.spec.visual_script.shots.length > 0) {
    const script = [...session.spec.visual_script.shots]
      .sort((a, b) => a.order - b.order)
      .map((shot) => shot.audio_vo?.trim())
      .filter((line): line is string => Boolean(line))
      .join('\n')
    if (script) {
      return script
    }
  }
  return session.cached_artifacts.working_script?.script ?? null
}

export function getUndescribedUploadedAssets(session: SessionState): UploadedAsset[] {
  const uploadedAssets = session.cached_artifacts.uploaded_assets ?? []
  if (uploadedAssets.length === 0) {
    return []
  }
  const describedIds = new Set(
    (session._loaded_asset_descriptions?.items ?? []).map((item) => item.asset_id),
  )
  return uploadedAssets.filter((asset) => !describedIds.has(asset.asset_id))
}

export function hasGlobalConstraintsArtifact(session: SessionState): boolean {
  const gc = session.spec.global_constraints
  return (
    Boolean(session.cached_artifacts.pending_global_constraints) ||
    Boolean(gc.topic?.trim()) ||
    Boolean(gc.video_type?.trim()) ||
    Boolean(gc.target_audience?.trim())
  )
}

export function hasScriptArtifact(session: SessionState): boolean {
  return (
    session.spec.visual_script.shots.some((shot) => Boolean(shot.audio_vo?.trim())) ||
    Boolean(session.cached_artifacts.working_script?.script?.trim())
  )
}

export function hasVisualScriptArtifact(session: SessionState): boolean {
  return (
    Boolean(session.cached_artifacts.pending_visual_script_shots?.length) ||
    session.spec.visual_script.shots.length > 0
  )
}

export function resolveUndoCountByScope(
  session: SessionState,
  undoScope: UndoScope,
  requestedCount?: number,
): { count?: number; message: string; ok: boolean } {
  const availableHistory = session.spec_history.length
  if (availableHistory === 0) {
    return { ok: false, message: 'No previous spec version is available to undo.' }
  }

  if (undoScope === 'LAST_CHANGE') {
    return { ok: true, count: 1, message: 'Undoing last change.' }
  }

  if (undoScope === 'COUNT') {
    if (!Number.isInteger(requestedCount) || (requestedCount ?? 0) <= 0) {
      return {
        ok: false,
        message: 'UNDO_LAST with undo_scope=COUNT requires count as a positive integer.',
      }
    }
    if ((requestedCount as number) > availableHistory) {
      return {
        ok: false,
        message: `Cannot undo ${requestedCount} updates; only ${availableHistory} version(s) available.`,
      }
    }
    return {
      ok: true,
      count: requestedCount,
      message: `Undoing ${requestedCount} recent update(s).`,
    }
  }

  const userMessages = session.transcript.filter((message) => message.role === 'user')
  if (userMessages.length < 2) {
    return {
      ok: false,
      message:
        'Cannot undo previous user turn because there is no prior user message in this session.',
    }
  }
  const currentUserTs = Date.parse(userMessages[userMessages.length - 1].timestamp)
  const prevUserTs = Date.parse(userMessages[userMessages.length - 2].timestamp)
  if (!Number.isFinite(currentUserTs) || !Number.isFinite(prevUserTs)) {
    return {
      ok: false,
      message: 'Cannot resolve previous user turn boundaries for undo.',
    }
  }

  let count = 0
  for (let index = session.spec_history.length - 1; index >= 0; index -= 1) {
    const entryTs = Date.parse(session.spec_history[index].timestamp)
    if (!Number.isFinite(entryTs)) {
      break
    }
    if (entryTs > prevUserTs && entryTs < currentUserTs) {
      count += 1
      continue
    }
    break
  }

  if (count === 0) {
    return {
      ok: false,
      message: 'No spec updates from the previous user turn are available to undo.',
    }
  }

  return {
    ok: true,
    count,
    message: `Undoing ${count} update(s) from previous user turn.`,
  }
}

export function shouldInjectUserDirectives(
  session: SessionState,
  tool: PlannerToolCall['tool'],
): boolean {
  switch (tool) {
    case 'generate_explainer_script': {
      return !hasScriptArtifact(session)
    }
    case 'generate_explainer_visual_script': {
      return !hasVisualScriptArtifact(session)
    }
    case 'generate_intent_context': {
      return !hasGlobalConstraintsArtifact(session)
    }
    default: {
      return true
    }
  }
}

export function toScopeSpec(params: PlannerToolParams): PlannerScopeSpec {
  return {
    anchor_ids: params.anchor_ids ?? undefined,
    scope: params.scope,
    shot_ids: params.shot_ids ?? undefined,
    from_shot_id: params.from_shot_id ?? undefined,
    to_shot_id: params.to_shot_id ?? undefined,
  }
}

function asDeps(runtime: object): SessionRuntimeDeps {
  return runtime as SessionRuntimeDeps
}
