import type { MusicAdapter } from './types'
import { endpointFor, withEntryInput } from './types'

/** Google Lyria on fal. */
export const lyria: MusicAdapter = {
  buildRequest(model, _mode, o) {
    return {
      endpoint: endpointFor(model, 'generate'),
      input: withEntryInput(model, {
        prompt: o.prompt,
        ...(o.negativePrompt ? { negative_prompt: o.negativePrompt } : {}),
      }),
    }
  },
}
