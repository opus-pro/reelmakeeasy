export function maxIsoTimestamp(...values: Array<null | string | undefined>): null | string {
  let next: null | string = null
  for (const value of values) {
    if (!value) {
      continue
    }
    if (!next || value > next) {
      next = value
    }
  }
  return next
}

export function resolveSessionStatus(
  currentStatus: string,
  alreadyTerminal: boolean,
  state: {
    _cancelled?: boolean
    _failed?: boolean
    _timed_out?: boolean
    lockedAt?: null | string
  },
): string {
  if (alreadyTerminal) {
    return currentStatus
  }
  if (state.lockedAt) {
    return 'completed'
  }
  if (state._failed) {
    return 'failed'
  }
  if (state._cancelled) {
    return 'cancelled'
  }
  if (state._timed_out) {
    return 'timed_out'
  }
  return 'active'
}
