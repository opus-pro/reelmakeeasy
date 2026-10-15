import { buildImageRequest, gptImageSize } from '../adapters'

import { createModelResolver } from './resolve'
import { parseModelRegistry } from './schema'
import { rawDefaults } from './test-helpers'

describe('gpt-image adapter', () => {
  const resolver = createModelResolver(parseModelRegistry(rawDefaults()))
  const model = resolver.resolveModel('image', 'gpt-image-2.5-flare')

  it('sizes images inside fal limits: multiples of 16, at most 3840 px, 655,360 to 8,294,400 pixels', () => {
    for (const tier of ['1K', '2K', '4K'] as const) {
      for (const ratio of ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']) {
        const { height, width } = gptImageSize(tier, ratio)
        expect(width % 16).toBe(0)
        expect(height % 16).toBe(0)
        expect(Math.max(width, height)).toBeLessThanOrEqual(3840)
        expect(width * height).toBeGreaterThanOrEqual(655_360)
        expect(width * height).toBeLessThanOrEqual(8_294_400)
      }
    }
    expect(gptImageSize('1K', '9:16')).toEqual({ height: 1360, width: 768 })
  })

  it('sends reference images to /edit with an explicit size', () => {
    expect(model.adapter).toBe('gpt-image')
    const request = buildImageRequest(model, {
      aspectRatio: '9:16',
      prompt: 'a bee on a honeycomb',
      referenceImageUrls: ['https://example.com/anchor.png'],
    })
    expect(request.endpoint).toBe('openai/gpt-image-2.5/flare/edit')
    expect(request.input).toMatchObject({
      image_size: { height: 1360, width: 768 },
      image_urls: ['https://example.com/anchor.png'],
      quality: 'medium',
    })
  })

  it('uses text-to-image without reference images', () => {
    const request = buildImageRequest(model, { aspectRatio: '16:9', prompt: 'a hive at dawn' })
    expect(request.endpoint).toBe('openai/gpt-image-2.5/flare/text-to-image')
    expect(request.input).not.toHaveProperty('image_urls')
  })
})
