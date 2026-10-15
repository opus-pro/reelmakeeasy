import type { UipSessionState } from './uip-timeline-types'

const isJsonEqual = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

export function buildStatePatch(
  previous: UipSessionState,
  next: UipSessionState,
): Partial<UipSessionState> {
  const patch: Partial<UipSessionState> = {}

  for (const [key, value] of Object.entries(next) as Array<
    [keyof UipSessionState, UipSessionState[keyof UipSessionState]]
  >) {
    if (value === undefined) {
      continue
    }
    if (!isJsonEqual(previous[key], value)) {
      ;(patch as Record<string, unknown>)[key] = value
    }
  }

  return patch
}
