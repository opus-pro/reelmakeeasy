const mockCompletion = jest.fn()
jest.mock('@reelmakeeasy/common/llm', () => ({
  completion: (...args: unknown[]) => mockCompletion(...args),
}))

import { generateLongTakeScriptPreview } from './long-take-script'

/** Phase 1's words for a saved AI that isn't ready (`llmNotSetUpMessage`). */
const STALE = "Claude Code can't write and plan right now (Not installed): open Setup"
/** libs/llm's error, as the transport throws it. */
const notSetUp = () => Object.assign(new Error(STALE), { name: 'LlmNotSetUpError' })

describe('generateLongTakeScriptPreview when no AI is set up', () => {
  beforeEach(() => mockCompletion.mockReset())

  it('lets the no-AI error through, so the API answers 409 with its reason', async () => {
    mockCompletion.mockRejectedValue(notSetUp())
    await expect(
      generateLongTakeScriptPreview({ rawInput: 'A short video about morning tea', userId: 'u' }),
    ).rejects.toThrow(STALE)
  })

  it('finds it under a wrapping error too', async () => {
    mockCompletion.mockRejectedValue(new Error('chat failed', { cause: notSetUp() }))
    await expect(
      generateLongTakeScriptPreview({ rawInput: 'A short video about morning tea', userId: 'u' }),
    ).rejects.toThrow('chat failed')
  })

  it('still falls back to the brief for any other failure', async () => {
    mockCompletion.mockRejectedValue(new Error('upstream 500'))
    await expect(
      generateLongTakeScriptPreview({ rawInput: 'A short   video about tea', userId: 'u' }),
    ).resolves.toMatchObject({
      finalScriptSource: 'normalized_raw_input',
      hasError: true,
      script: 'A short video about tea',
    })
  })
})
