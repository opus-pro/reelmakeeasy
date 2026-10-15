/**
 * Correlates pre-project analytics events (e.g. the model selector shown before
 * a project exists) with the project eventually created from that same visit:
 * the selector events carry this id, the creation event carries the
 * same id, and a query can join the two.
 *
 * A module-level variable, not sessionStorage: a tab opened with `window.open`
 * (an opener) gets sessionStorage CLONED from its opener,
 * which would fuse two independent creation sessions under one id.
 */

let creationSessionId = ''

export function getCreationSessionId(): string {
  if (!creationSessionId) {
    creationSessionId = crypto.randomUUID()
  }
  return creationSessionId
}

export function resetCreationSessionId(): void {
  creationSessionId = ''
}
