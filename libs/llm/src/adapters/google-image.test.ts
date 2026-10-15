import { createModelResolver } from '../registry/resolve'
import { parseModelRegistry } from '../registry/schema'
import { rawDefaults } from '../registry/test-helpers'

import { buildGeminiImageRequest, geminiImageBase64 } from './google-image'

const resolver = createModelResolver(parseModelRegistry(rawDefaults()), {
  generationProvider: () => 'google',
})
const pro = resolver.resolveModel('image', '', { role: 'image.edit' })
const lite = resolver.resolveModel('image', '', { role: 'image.agentPreview' })

describe('Nano Banana on the Gemini API', () => {
  it('makes a keyframe at the asked ratio and size', () => {
    const r = buildGeminiImageRequest(pro, {
      aspectRatio: '9:16',
      prompt: 'a fox',
      resolution: '2K',
    })
    expect(r.model).toBe('gemini-3-pro-image')
    expect(r.body).toEqual({
      contents: [{ parts: [{ text: 'a fox' }], role: 'user' }],
      generationConfig: {
        imageConfig: { aspectRatio: '9:16', imageSize: '2K' },
        responseModalities: ['IMAGE'],
      },
    })
  })

  it('edits with reference pictures as inline parts', () => {
    const r = buildGeminiImageRequest(pro, {
      prompt: 'the same fox at night',
      referenceImageUrls: ['data:image/png;base64,QUFB'],
    })
    expect(r.body['contents']).toEqual([
      {
        parts: [
          { text: 'the same fox at night' },
          { inlineData: { data: 'QUFB', mimeType: 'image/png' } },
        ],
        role: 'user',
      },
    ])
  })

  it('sends no size to Lite and drops ratios a model lacks', () => {
    const r = buildGeminiImageRequest(lite, {
      aspectRatio: 'adaptive',
      prompt: 'p',
      resolution: '4K',
    })
    expect(r.model).toBe('gemini-3.1-flash-lite-image')
    expect(r.body['generationConfig']).toEqual({ responseModalities: ['IMAGE'] })
  })

  it('reads the final picture', () => {
    expect(
      geminiImageBase64({
        candidates: [
          { content: { parts: [{ inlineData: { data: 'IMG', mimeType: 'image/png' } }] } },
        ],
      }),
    ).toBe('IMG')
  })
})
