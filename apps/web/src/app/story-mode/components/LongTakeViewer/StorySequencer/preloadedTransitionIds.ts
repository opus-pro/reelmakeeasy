/**
 * Returns the set of transition IDs that should have preload="auto".
 * Contains only the active transition and the one immediately after it.
 * All other mounted transitions use preload="none" to avoid wasting
 * network and decode resources on already-watched or far-ahead segments.
 */
export function computePreloadedTransitionIds(
  transitionIds: string[],
  activeTransitionIndex: number,
): Set<string> {
  const center = Math.max(0, activeTransitionIndex)
  const set = new Set<string>()
  if (center < transitionIds.length) {
    set.add(transitionIds[center])
  }
  if (center + 1 < transitionIds.length) {
    set.add(transitionIds[center + 1])
  }
  return set
}
