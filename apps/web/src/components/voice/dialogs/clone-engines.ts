import type { TtsEnginesResponse } from '@shared/types/api/voice-over'

/** The voice clone dialog's engines: ElevenLabs (or MiniMax on fal), and Qwen3. */
export type CloneEngine = 'qwen3' | 'standard'

/** The clone engine to preselect: the current one when it works, else the first that does. */
export function pickCloneEngine(
  available: Record<CloneEngine, boolean>,
  current: CloneEngine,
): CloneEngine {
  if (available[current]) return current
  return (['standard', 'qwen3'] as const).find((engine) => available[engine]) ?? current
}

/** Why the Qwen3 row can't be used, from GET /api/voice-over/engines (undefined while it loads or when it can). */
export function qwen3CloneDisabledReason(
  engines: Pick<TtsEnginesResponse, 'qwen3Clone'> | undefined,
): string | undefined {
  return engines && !engines.qwen3Clone.available ? engines.qwen3Clone.reason : undefined
}
