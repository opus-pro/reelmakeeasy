import type { SessionState, TodoExecutorHint } from '../types'

import type { PlannerOutputLike } from './runtime.types'

export function areShotIdsContinuous(session: SessionState, shotIds: string[]): boolean {
  if (shotIds.length === 0) {
    return false
  }
  const order = session.spec.visual_script.shots.map((shot) => shot.shot_id)
  const indexes = shotIds.map((shotId) => order.indexOf(shotId))
  if (indexes.some((index) => index < 0)) {
    return false
  }
  const sorted = [...indexes].sort((a, b) => a - b)
  return sorted.slice(1).every((index, offset) => index - sorted[offset] === 1)
}

export function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function getEffectiveDirectiveItems(
  session: SessionState,
  output: PlannerOutputLike,
): Array<{
  executor_hint?: null | TodoExecutorHint
  id: string
  status: 'done' | 'pending'
  title: string
}> {
  const sourceItems =
    output.todo_snapshot?.items.map((item) => ({
      executor_hint: item.executor_hint ?? null,
      id: item.id,
      status: item.status,
      title: item.title,
    })) ??
    session.todo_state.items.map((item) => ({
      executor_hint: item.executor_hint ?? null,
      id: item.id,
      status: item.status,
      title: item.title,
    }))

  const byId = new Map(sourceItems.map((item) => [item.id, { ...item }] as const))
  for (const update of output.todo_update.set_item_status ?? []) {
    const existing = byId.get(update.id)
    if (!existing) {
      continue
    }
    byId.set(update.id, { ...existing, status: update.status })
  }

  return [...byId.values()]
}

export function hasExplicitRefinementSharedBatchGroup(
  session: SessionState,
  output: PlannerOutputLike,
): boolean {
  const effectiveItems = getEffectiveDirectiveItems(session, output)
  const pendingDirectiveItems = effectiveItems.filter(
    (item) =>
      item.status === 'pending' &&
      item.executor_hint?.executor_type === 'TOOL_CALLS' &&
      item.executor_hint.shared_batch_key?.trim(),
  )

  const itemsByKey = new Map<string, typeof pendingDirectiveItems>()
  for (const item of pendingDirectiveItems) {
    const sharedBatchKey = item.executor_hint?.shared_batch_key?.trim()
    if (!sharedBatchKey) {
      continue
    }
    const items = itemsByKey.get(sharedBatchKey) ?? []
    items.push(item)
    itemsByKey.set(sharedBatchKey, items)
  }

  for (const items of itemsByKey.values()) {
    const hasTargetedAnchorTool = items.some(
      (item) =>
        item.executor_hint?.executor_tool === 'generate_anchor_assets' &&
        normalizeText(item.executor_hint.scope_hint ?? '') === 'anchor_ids',
    )
    const hasFullAnchorTool = items.some(
      (item) =>
        item.executor_hint?.executor_tool === 'generate_anchor_assets' &&
        normalizeText(item.executor_hint.scope_hint ?? '') === 'full',
    )
    const hasVisualTool = items.some(
      (item) => item.executor_hint?.executor_tool === 'generate_explainer_visual_script',
    )
    const hasFullVisualTool = items.some(
      (item) =>
        item.executor_hint?.executor_tool === 'generate_explainer_visual_script' &&
        normalizeText(item.executor_hint.scope_hint ?? '') === 'full',
    )
    if ((hasTargetedAnchorTool && hasVisualTool) || (hasFullAnchorTool && hasFullVisualTool)) {
      return true
    }
  }

  return false
}

export function isDirectiveTodoId(id: string): boolean {
  return /^d\d+/i.test(id.trim())
}

export function isDirectiveTodoPhase(phase: SessionState['todo_state']['phase']): boolean {
  return phase === 'refinement' || phase === 'script_review'
}

export function isSupportedToolScopeHint(value: string): boolean {
  const normalized = normalizeText(value).toUpperCase()
  return (
    normalized === 'ANCHOR_IDS' ||
    normalized === 'FULL' ||
    normalized === 'SHOT_IDS' ||
    normalized === 'SHOT_RANGE'
  )
}

export function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}
