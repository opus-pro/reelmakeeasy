import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { detectCuts } from './motion-reference'
import { renderReel, renderStills } from './motion-render'
import { run } from './motion-runtime'

const mockRuntime = { dir: '' }
jest.mock('./motion-runtime', () => ({
  ...jest.requireActual('./motion-runtime'),
  runtimeDir: () => mockRuntime.dir,
  run: jest.fn(async (cmd: string, args: string[]) => {
    // ffprobe: the video's audio stream, then its length.
    if (cmd === 'ffprobe') return args.includes('format=duration') ? '31.5\n' : '0\n'
    return ''
  }),
}))
jest.mock('./motion-reference', () => ({
  ...jest.requireActual('./motion-reference'),
  detectCuts: jest.fn(async () => []),
  remotionBrowserPath: () => null,
}))

describe('rendering an animation', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'render-animation-'))
    mockRuntime.dir = dir
    jest.mocked(run).mockClear()
  })
  afterEach(() => fs.rmSync(dir, { force: true, recursive: true }))

  it('renders its own composition, with no beat check, posted from near the end', async () => {
    const result = await renderReel(dir, { composition: 'Animation', name: 'animation', sync: false })
    const calls = jest.mocked(run).mock.calls
    expect(calls[0]?.[1].slice(0, 4)).toEqual([
      'render',
      'src/index.ts',
      'Animation',
      path.join(dir, 'out', 'raw.mp4'),
    ])
    expect(result.file).toBe(path.join(dir, 'out', 'animation.mp4'))
    expect(result.report).toBeUndefined()
    expect(result.sync).toBeUndefined()
    expect(detectCuts).not.toHaveBeenCalled()
    const poster = calls.find((c) => c[1].includes('-frames:v'))
    expect(poster?.[1][poster[1].indexOf('-ss') + 1]).toBe('30.5')
  })

  it('renders stills of the composition it is given', async () => {
    await renderStills(dir, [0, 375], path.join(dir, 'stills'), 'Animation')
    const call = jest.mocked(run).mock.calls[0]
    expect(call?.[1].slice(1)).toEqual([dir, path.join(dir, 'stills'), 'Animation', '0', '375'])
  })
})
