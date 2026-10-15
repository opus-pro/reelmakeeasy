import type { Session } from './api-types'

export interface AdapterRuntime {
  applySession: (session: Session) => void
  dispose: () => void
  start: () => void
}
