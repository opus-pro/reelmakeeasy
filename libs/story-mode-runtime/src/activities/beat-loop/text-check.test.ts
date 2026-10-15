const completion = jest.fn()
jest.mock('@reelmakeeasy/common/llm', () => ({
  ...jest.requireActual('@reelmakeeasy/common/llm'),
  completion: (options: unknown) => completion(options),
}))

import { checkBeatLoopClipText, findBeatLoopText } from './text-check'

beforeEach(() => completion.mockReset())

describe('the loop text check', () => {
  it('asks a vision model about any letters or numbers anywhere, not only titles', async () => {
    completion.mockResolvedValue({ detail: '"1969" on a sign, top left', hasText: true })
    const verdict = await findBeatLoopText('/tmp/f1.png')
    expect(verdict).toEqual({ detail: '"1969" on a sign, top left', hasText: true })
    const options = completion.mock.calls[0][0] as {
      contents: { imageUrl: string; type: string }[]
      systemPrompt: string
    }
    expect(options.contents).toEqual([{ imageUrl: '/tmp/f1.png', type: 'image_url' }])
    expect(options.systemPrompt).toMatch(/numbers/)
    expect(options.systemPrompt).toMatch(/anywhere/)
  })

  it('checks a clip by its frame strip, one picture for the whole clip', async () => {
    completion.mockResolvedValue({ detail: null, hasText: false })
    const verdict = await checkBeatLoopClipText({
      clipPath: '/tmp/s1.mp4',
      frames: [{ path: '/tmp/frame_001.jpg', timeS: 0 }],
      stripPath: '/tmp/s1_qa_strip.jpg',
    })
    expect(verdict).toEqual({ hasText: false })
    expect(completion).toHaveBeenCalledTimes(1)
    expect(completion.mock.calls[0][0]).toMatchObject({
      contents: [{ imageUrl: '/tmp/s1_qa_strip.jpg', type: 'image_url' }],
    })
  })
})
