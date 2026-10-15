import { USER_OPERATION_COUNTDOWN_DELAY_MS } from '@reelmakeeasy/common/workflow/uip-v2-deadline-policy'

export { USER_OPERATION_COUNTDOWN_DELAY_MS }

/**
 * Returns the ISO timestamp when the countdown should become visible after a user operation.
 * Computed as: latest operate_at timestamp + delay.
 * Returns undefined if all entries are outside the delay window (show immediately).
 */
export function computeCountdownShowAt(
  operateAt: Record<string, string> | undefined,
  nowMs = Date.now(),
): string | undefined {
  if (!operateAt) {
    return undefined
  }
  let latestTs: null | number = null
  for (const timestamp of Object.values(operateAt)) {
    const tsMs = new Date(timestamp).getTime()
    if (Number.isFinite(tsMs)) {
      latestTs = latestTs === null ? tsMs : Math.max(latestTs, tsMs)
    }
  }
  if (latestTs === null) {
    return undefined
  }
  const showAtMs = latestTs + USER_OPERATION_COUNTDOWN_DELAY_MS
  if (showAtMs <= nowMs) {
    return undefined
  }
  return new Date(showAtMs).toISOString()
}
