import { workflowInfo } from '@reelmakeeasy/workflow-engine/workflow'

import type { ContinueAsNewSignals } from './compaction'

/**
 * Handoff signals for the 7i continueAsNew check: the event count plus the
 * BYTE-SIZE dimension (`historySize`), so a run large by bytes but small by
 * event count still hands off.
 */
export function continueAsNewSignals(): ContinueAsNewSignals {
  const info = workflowInfo()
  return {
    historyLength: info.historyLength,
    historySize: info.historySize,
  }
}
