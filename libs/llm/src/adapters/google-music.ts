import type { ResolvedModel } from '../registry/resolve'

import type { GoogleRequest, MusicRequestOptions } from './types'
import { endpointFor, withEntryInput } from './types'

/**
 * Lyria 3 Clip on the Gemini API: one 30-second piece from a text prompt. It
 * has no length or instrumental setting, so "Instrumental only, no vocals"
 * goes in the prompt (Google's own advice); longer videos loop the clip.
 */
export function buildLyriaRequest(model: ResolvedModel, o: MusicRequestOptions): GoogleRequest {
  const tags = o.tags?.trim()
  const described = tags ? `${o.prompt.trim()} Style: ${tags}.` : o.prompt.trim()
  const instrumental = /no vocals|instrumental only/i.test(described)
    ? described
    : `${described} Instrumental only, no vocals.`
  const avoid = o.negativePrompt?.trim()
  return {
    body: withEntryInput(model, {
      contents: [
        {
          parts: [{ text: avoid ? `${instrumental} Avoid: ${avoid}.` : instrumental }],
          role: 'user',
        },
      ],
    }),
    model: endpointFor(model, 'generate'),
  }
}
