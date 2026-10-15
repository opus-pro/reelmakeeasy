import { buildImageRequest } from '../adapters'

import { createModelResolver } from './resolve'
import { parseModelRegistry } from './schema'
import { rawDefaults } from './test-helpers'

describe('nano-banana-lite (agent chat previews)', () => {
  const resolver = createModelResolver(parseModelRegistry(rawDefaults()))
  const model = resolver.resolveModel('image', '', { role: 'image.agentPreview' })

  it('is the agent preview role', () => {
    expect(model.key).toBe('nano-banana-lite')
    expect(model.adapter).toBe('nano-banana')
  })

  it('makes a vertical picture, and edits with a reference', () => {
    expect(buildImageRequest(model, { aspectRatio: '9:16', prompt: 'fox' })).toMatchObject({
      endpoint: 'google/nano-banana-lite',
      input: { aspect_ratio: '9:16', output_format: 'png', prompt: 'fox' },
    })
    const edit = buildImageRequest(model, {
      prompt: 'warmer',
      referenceImageUrls: ['data:image/png;base64,AA'],
    })
    expect(edit.endpoint).toBe('google/nano-banana-lite/edit')
    expect(edit.input).toMatchObject({ image_urls: ['data:image/png;base64,AA'] })
    expect(edit.input).not.toHaveProperty('resolution')
  })

  it('leaves the keyframe roles on their own models', () => {
    expect(resolver.resolveModel('image', '', { role: 'image.generate' }).key).not.toBe(
      'nano-banana-lite',
    )
  })
})

describe('image.agentPreview in an older models file', () => {
  it('is optional: a file without it still loads, with the role off', () => {
    const raw = rawDefaults()
    delete raw['roles']['image.agentPreview']
    const registry = parseModelRegistry(raw)
    expect(registry.roles['image.agentPreview']).toBeNull()
  })
})
