import { falOutputUrl } from './generic'
import type { MusicAdapter } from './types'
import { endpointFor, withEntryInput } from './types'

/** The lengths `fal-ai/elevenlabs/music` composes to, in milliseconds. */
const MIN_LENGTH_MS = 3000
const MAX_LENGTH_MS = 600_000

/**
 * ElevenLabs Music on fal: composes a piece to the asked length (so a bed needs no loop),
 * always instrumental. Billed per started minute of output; there is no negative prompt.
 */
export const elevenlabsMusic: MusicAdapter = {
  buildRequest(model, _mode, o) {
    const ms =
      o.durationSec === undefined
        ? undefined
        : Math.min(MAX_LENGTH_MS, Math.max(MIN_LENGTH_MS, Math.round(o.durationSec * 1000)))
    return {
      endpoint: endpointFor(model, 'generate'),
      input: withEntryInput(model, {
        force_instrumental: true,
        ...(ms === undefined ? {} : { music_length_ms: ms }),
        output_format: 'mp3_44100_128',
        prompt: o.prompt,
      }),
    }
  },
  parseOutput: falOutputUrl,
}
