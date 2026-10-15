import sharp from 'sharp'

import { prepareVideoFrames } from '../adapters'
import { imageSizeOf, nearestFrameSize } from '../frame-fit'

import { createModelResolver } from './resolve'
import { parseModelRegistry } from './schema'
import { rawDefaults } from './test-helpers'

async function png(width: number, height: number): Promise<string> {
  const buffer = await sharp({
    create: { background: { b: 40, g: 120, r: 200 }, channels: 3, height, width },
  })
    .png()
    .toBuffer()
  return `data:image/png;base64,${buffer.toString('base64')}`
}

describe('H3 first/last frame fitting', () => {
  const resolver = createModelResolver(parseModelRegistry(rawDefaults()))
  const h3 = resolver.resolveModel('video', 'minimax-h3-max-turbo', { mode: 'firstLast' })

  it('fits a carried frame and a keyframe of different sizes to the same 768p canvas', async () => {
    const frames = await prepareVideoFrames(
      h3,
      { endImageUrl: await png(768, 1360), startImageUrl: await png(768, 1344) },
      { resolution: '768p' },
    )
    expect(await imageSizeOf(frames.startImageUrl ?? '')).toEqual({ height: 1344, width: 768 })
    expect(await imageSizeOf(frames.endImageUrl ?? '')).toEqual({ height: 1344, width: 768 })
  })

  it('uses the frame size for the chosen resolution', async () => {
    const frames = await prepareVideoFrames(
      h3,
      { endImageUrl: await png(768, 1376), startImageUrl: await png(768, 1360) },
      { resolution: '1080p' },
    )
    expect(await imageSizeOf(frames.startImageUrl ?? '')).toEqual({ height: 1912, width: 1080 })
    expect(await imageSizeOf(frames.endImageUrl ?? '')).toEqual({ height: 1912, width: 1080 })
  })

  it('leaves a frame that is already the right size untouched', async () => {
    const start = await png(1344, 768)
    const frames = await prepareVideoFrames(h3, { startImageUrl: start }, { resolution: '768p' })
    expect(frames.startImageUrl).toBe(start)
  })

  it('fits the last frame to the first when the shape has no listed size', async () => {
    const frames = await prepareVideoFrames(
      h3,
      { endImageUrl: await png(1000, 1000), startImageUrl: await png(1024, 1024) },
      { resolution: '768p' },
    )
    expect(await imageSizeOf(frames.endImageUrl ?? '')).toEqual({ height: 1024, width: 1024 })
  })

  it('matches shapes within 15%', () => {
    const sizes = { '16:9': [1344, 768], '9:16': [768, 1344] } as Record<string, [number, number]>
    expect(nearestFrameSize(sizes, 768, 1376)).toEqual([768, 1344])
    expect(nearestFrameSize(sizes, 1000, 1000)).toBeUndefined()
  })
})
