import { SourceFailure, TimelineItem } from './types'

export function bottomTs<T extends TimelineItem>(items: readonly T[]): null | number {
  if (items.length === 0) {
    return null
  }
  return items[items.length - 1].createdAt
}

export function hasIdOverlap<T extends TimelineItem>(
  left: readonly T[],
  right: readonly T[],
): boolean {
  if (left.length === 0 || right.length === 0) {
    return false
  }
  const ids = new Set(right.map((item) => item.id))
  for (const item of left) {
    if (ids.has(item.id)) {
      return true
    }
  }
  return false
}

export function mergeById<T extends TimelineItem>(prev: readonly T[], next: readonly T[]): T[] {
  if (next.length === 0) {
    return [...prev]
  }

  const byId = new Map<string, T>()
  for (const item of prev) {
    byId.set(item.id, item)
  }
  for (const item of next) {
    byId.set(item.id, item)
  }
  return sortDesc([...byId.values()])
}

export function normalizeItems<T extends TimelineItem>(items: readonly T[]): T[] {
  return mergeById([], items)
}

export function sortDesc<T extends TimelineItem>(items: T[]): T[] {
  return items.sort((a, b) => {
    const byCreatedAt = b.createdAt - a.createdAt
    if (byCreatedAt !== 0) {
      return byCreatedAt
    }
    return b.id.localeCompare(a.id)
  })
}

export function toOperationError(operation: string, failures: readonly SourceFailure[]): Error {
  const sourceSummary = failures.map((item) => item.sourceKey).join(', ')
  const error = new Error(`[timeline.${operation}] failed sources: ${sourceSummary}`)
  ;(error as Error & { failures?: readonly SourceFailure[] }).failures = failures
  return error
}

export function topTs<T extends TimelineItem>(items: readonly T[]): null | number {
  if (items.length === 0) {
    return null
  }
  return items[0].createdAt
}
