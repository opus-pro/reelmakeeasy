import { getLogger } from '../logger'
import { recordProjectNotificationCost } from '../pricing/project-notification-cost'
import { ensureError } from '../utils/error-handler'

import type { TTSModel } from './minimax-text'

const logger = getLogger('tts-reporter')

/**
 * Providers `reportTTSCost` accepts. Extracted verbatim from its former inline
 * signature, so `'11labs'` is kept as-is: it has no caller (ElevenLabs reports
 * through `elevenlabs-audio-pipeline.util.ts`, not here) and renaming it to the
 * `'elevenlabs'` spelling used by `voice-tools`' separate `TtsProvider` type would
 * be a rename of dead code with no behavior change. Whoever wires up ElevenLabs
 * cost should align the spelling then.
 */
export type TtsCostProvider = '11labs' | 'fal' | 'minimax'

/**
 * MiniMax T2A **published pay-as-you-go** rates, in nano-USD per character,
 * pinned 2026-08-03: HD $100 / 1M characters, Turbo $60 / 1M characters
 * (https://openrouter.ai/minimax/speech-2.8-hd; the same two figures appear in
 * LiteLLM's model price table for `minimax/speech-02-hd|turbo` and
 * `minimax/speech-2.6-hd|turbo`).
 *
 * These are LIST rates. A list rate is an upper bound, so `audioCostUsd` can
 * overstate but never understate the bill, which is the safe direction. Swap
 * the numbers here (and re-date this comment) if the rates change.
 *
 * Typed as a total `Record<TTSModel, ...>` so adding a MiniMax model id without a
 * rate is a compile error rather than a silently unpriced code path.
 */
const MINIMAX_NANO_PER_CHARACTER: Record<TTSModel, number> = {
  'speech-01-hd': 100_000,
  'speech-01-turbo': 60_000,
  'speech-02-hd': 100_000,
  'speech-02-turbo': 60_000,
  'speech-2.6-hd': 100_000,
  'speech-2.6-turbo': 60_000,
  'speech-2.8-hd': 100_000,
}
const TTS_TASK = 'voiceover'

const warnedUnpricedModels = new Set<string>()

/**
 * Nano-USD cost of a TTS generation, or `undefined` when the model has no pinned
 * rate. 11labs has no caller, so only MiniMax is priced today.
 *
 * `'fal'` is fal-hosted MiniMax and prices off the SAME per-character
 * table. fal publishes $0.10 / 1k characters for `fal-ai/minimax/speech-2.8-hd`,
 * which is exactly the pinned MiniMax HD list rate below, so the vendor move is
 * cost-neutral at list and a single table keeps it that way. If fal's rate ever
 * diverges from MiniMax's, split this into a per-provider table rather than
 * letting one of the two price its traffic wrongly in silence.
 */
export function ttsCostNano(
  provider: TtsCostProvider,
  model: string,
  characters: number,
): number | undefined {
  if (
    (provider !== 'minimax' && provider !== 'fal') ||
    !Number.isFinite(characters) ||
    characters <= 0
  ) {
    return undefined
  }
  // `model` is a free-form string off the API response, so the total-Record lookup
  // still has to be treated as possibly-missing.
  const nanoPerCharacter: number | undefined = MINIMAX_NANO_PER_CHARACTER[model as TTSModel]
  if (nanoPerCharacter === undefined) {
    return undefined
  }
  return characters * nanoPerCharacter
}

/**
 * Report one TTS generation: usage always, cost when the model is priced.
 *
 * Cost lives here rather than in the story-loader `tts-asr.ts` wrapper because
 * every provider client calls this function, while that wrapper sits on a single
 * code path carrying only ~12% of delivered characters.
 *
 * `projectId` is threaded explicitly instead of read from the ambient
 * `JobContext`: nothing on the long-take voiceover path populates it, so
 * `recordProjectNotificationCost` would return early and drop the roll-up write
 * silently, skipping the per-project attribution.
 *
 * Best-effort throughout -- telemetry must never fail a generation.
 *
 * @param characters - Character count. The metric is named `words_used` for
 * historical reasons but every caller passes a `.length`; reading it as words
 * understates volume ~5x. Renaming the metric is a separate,
 * dashboard-breaking change.
 */
export function reportTTSCost(
  provider: TtsCostProvider,
  model: string,
  characters: number,
  options: { projectId?: string } = {},
) {
  try {
    const costNano = ttsCostNano(provider, model, characters)
    if (costNano === undefined) {
      // Warn once per model so a newly-rolled-out voice model shows up as a
      // known gap instead of silently dropping out of the cost total.
      if (
        (provider === 'minimax' || provider === 'fal') &&
        !warnedUnpricedModels.has(`${provider}:${model}`)
      ) {
        warnedUnpricedModels.add(`${provider}:${model}`)
        logger.warn(
          `[tts-cost] no pinned per-character rate for provider=${provider} model=${model}`,
        )
      }
      return
    }
    // `biz` is deliberately not forwarded -- the roll-up keys on
    // `{task}|{model}|{provider}` and ignores it.
    recordProjectNotificationCost({
      costNano,
      model,
      projectId: options.projectId,
      provider,
      task: TTS_TASK,
    })
  } catch (err) {
    try {
      logger.warn(
        `[tts-cost] skipped cost for provider=${provider} model=${model}: ${ensureError(err).message}`,
      )
    } catch {
      /* ignore */
    }
  }
}
