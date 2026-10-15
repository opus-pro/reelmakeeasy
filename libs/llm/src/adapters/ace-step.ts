import { falOutputUrl } from './generic'
import type { MusicAdapter } from './types'
import { endpointFor, withEntryInput } from './types'

const MIN_SEC = 5
const MAX_SEC = 240
const DEFAULT_SEC = 60

/**
 * ACE-Step on fal: composes to the asked length from comma-separated style tags, with an
 * explicit instrumental mode (`[instrumental]` as the lyrics), about $0.0002 a second.
 * The BGM director writes the tags beside its prose prompt; a prompt typed by the user
 * is sent as the tags when there are none.
 */
export const aceStep: MusicAdapter = {
  buildRequest(model, _mode, o) {
    const duration = Math.min(MAX_SEC, Math.max(MIN_SEC, Math.ceil(o.durationSec ?? DEFAULT_SEC)))
    return {
      endpoint: endpointFor(model, 'generate'),
      input: withEntryInput(model, {
        duration,
        lyrics: '[instrumental]',
        tags: o.tags?.trim() || o.prompt,
      }),
    }
  },
  parseOutput: falOutputUrl,
}
