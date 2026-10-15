import { falOutputUrl } from './generic'
import type { MusicAdapter } from './types'
import { endpointFor, withEntryInput } from './types'

/** The lengths `cassetteai/music-generator` composes to, in whole seconds. */
const MIN_SEC = 10
const MAX_SEC = 180
const DEFAULT_SEC = 30

/**
 * CassetteAI on fal: composes a piece to the asked length (so a bed needs no loop) for
 * about $0.02 per minute of output. It has no instrumental switch or negative prompt, so
 * the prompt itself carries the "Instrumental" cue (the BGM director always adds it).
 */
export const cassetteaiMusic: MusicAdapter = {
  buildRequest(model, _mode, o) {
    const duration = Math.min(MAX_SEC, Math.max(MIN_SEC, Math.ceil(o.durationSec ?? DEFAULT_SEC)))
    return {
      endpoint: endpointFor(model, 'generate'),
      input: withEntryInput(model, { duration, prompt: o.prompt }),
    }
  },
  parseOutput: falOutputUrl,
}
