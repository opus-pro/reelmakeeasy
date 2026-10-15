import { PATH_METADATA } from '@nestjs/common/constants'

import { MediaController } from './media.controller'

function routePaths(): string[] {
  const proto = MediaController.prototype as unknown as Record<string, unknown>
  return Object.getOwnPropertyNames(proto)
    .filter((name) => name !== 'constructor' && typeof proto[name] === 'function')
    .map((name) => Reflect.getMetadata(PATH_METADATA, proto[name] as object) as string | undefined)
    .filter((path): path is string => typeof path === 'string')
}

describe('MediaController routes', () => {
  it('serves project files and offers no custom-style or tree routes', () => {
    const paths = routePaths()
    expect(paths).toContain('file/:projectId')
    for (const removed of [
      'analyze-style',
      'analyze-style-from-video',
      'extract-video-frames',
      'refine-style',
      'style-scene-samples/:sessionId/start',
      'style-scene-samples/:sessionId/stream',
      'tree/:projectId',
    ]) {
      expect(paths).not.toContain(removed)
    }
  })
})
