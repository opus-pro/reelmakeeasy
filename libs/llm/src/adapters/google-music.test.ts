import { createModelResolver, type ResolvedModel } from '../registry/resolve'
import { parseModelRegistry } from '../registry/schema'
import { rawDefaults } from '../registry/test-helpers'

import { buildLyriaRequest } from './google-music'

const lyria = createModelResolver(parseModelRegistry(rawDefaults()), {
  generationProvider: () => 'google',
}).resolveRole('music') as ResolvedModel

describe('Lyria 3 Clip on the Gemini API', () => {
  it('asks for an instrumental clip with the style and what to avoid', () => {
    const r = buildLyriaRequest(lyria, {
      negativePrompt: 'drums',
      prompt: 'Calm piano bed.',
      tags: 'lo-fi, warm',
    })
    expect(r.model).toBe('lyria-3-clip-preview')
    expect(r.body).toEqual({
      contents: [
        {
          parts: [
            {
              text: 'Calm piano bed. Style: lo-fi, warm. Instrumental only, no vocals. Avoid: drums.',
            },
          ],
          role: 'user',
        },
      ],
    })
  })

  it('does not repeat an instrumental note the prompt already has', () => {
    const r = buildLyriaRequest(lyria, { prompt: 'Upbeat synth. Instrumental only, no vocals.' })
    expect(JSON.stringify(r.body)).not.toMatch(/no vocals.*no vocals/)
  })
})
