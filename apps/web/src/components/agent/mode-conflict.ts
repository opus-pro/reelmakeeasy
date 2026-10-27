import type { AgentHarnessName } from '@shared/types/api/agent'

import { HARNESS_LABEL } from './agent-harness'

/** Reasons the API gives (409) for a tool this account or agent can't run, said as they are. */
const SAID_AS_IS = /^(Motion Reel needs|Claude Animation needs|Claude Animation runs only on)/

/** The notice for a 409 on choosing a mode: the agent isn't ready, the tool can't run here (the
 *  API's own words), or a mode was already chosen. */
export function modeConflictNotice(message: string, harness: AgentHarnessName | undefined): string {
  if (/not ready/.test(message))
    return `${HARNESS_LABEL[harness ?? 'codex']} isn't ready. Check it is installed and signed in, then try again.`
  if (SAID_AS_IS.test(message)) return message
  return 'A mode was already chosen.'
}
