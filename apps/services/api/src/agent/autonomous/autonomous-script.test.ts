import { generateLongTakeScriptPreview } from '../../long-take/long-take-script'
import { currentLlmProjectId } from '../codex-llm/codex-projects'

import { writeScriptOnCodex } from './autonomous.service'

jest.mock('../../long-take/long-take-script', () => ({
  generateLongTakeScriptPreview: jest.fn(),
}))

const preview = jest.mocked(generateLongTakeScriptPreview)
const PARAMS = { brief: 'A comet tonight.', durationSeconds: 30, projectId: 'p1', userId: 'u' }

describe('writeScriptOnCodex', () => {
  it('writes the script with every LLM call attributed to the (Codex) project', async () => {
    let seen: null | string = 'unset'
    preview.mockImplementation(async () => {
      // What the Codex chat resolver reads to route the call (R5).
      seen = currentLlmProjectId()
      return { finalScriptSource: 'generated', script: 'Look up tonight.' } as never
    })

    await expect(writeScriptOnCodex(PARAMS)).resolves.toBe('Look up tonight.')

    expect(seen).toBe('p1')
    expect(preview).toHaveBeenCalledWith(
      expect.objectContaining({
        contextId: 'p1',
        rawInput: 'A comet tonight.',
        targetDurationSeconds: 30,
        userId: 'u',
      }),
    )
  })

  it('fails rather than read the brief aloud when no script was generated', async () => {
    preview.mockResolvedValue({
      finalScriptSource: 'normalized_raw_input',
      script: 'A comet tonight.',
    } as never)

    await expect(writeScriptOnCodex(PARAMS)).rejects.toThrow(/could not write the voice-over/)
  })
})
