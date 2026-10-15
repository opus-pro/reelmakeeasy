import fs from 'node:fs'

import { JobContext } from '@reelmakeeasy/common/job-context'
import { setCurrentLlmProvider } from '@reelmakeeasy/llm'

import { buildClassificationAudioAnalysis } from './classification-audio-summary'

const mockRunCompletion = jest.fn()
jest.mock('../long-take-generation-record', () => ({
  runLongTakeCompletionWithRecord: (...args: unknown[]) => mockRunCompletion(...args),
}))
const mockDownload = jest.fn()
jest.mock('./common', () => ({
  ...jest.requireActual('./common'),
  downloadAssetToLocal: (...args: unknown[]) => mockDownload(...args),
}))
jest.mock('./storage', () => ({
  ...jest.requireActual('./storage'),
  createLongTakeStorage: () => ({ getFullPath: (p: string) => `store://${p}` }),
}))

const ORIGINAL_ENV = { ...process.env }

/** The AI the LLM call was pinned to, read inside the call. */
function pinNow(): unknown {
  try {
    return JobContext.getByKey('llmProvider', null)
  } catch {
    return null
  }
}

describe('buildClassificationAudioAnalysis', () => {
  let pins: unknown[] = []

  beforeEach(() => {
    process.env['LLM_SKIP_CACHE'] = '1'
    pins = []
    mockDownload.mockReset().mockImplementation(async (_uri: string, dest: string) => {
      await fs.promises.writeFile(dest, 'mp3')
    })
    mockRunCompletion.mockReset().mockImplementation(async () => {
      pins.push(pinNow())
      return { is_music: false }
    })
  })

  afterEach(() => {
    setCurrentLlmProvider(null)
    process.env = { ...ORIGINAL_ENV }
  })

  it('pins the call to Gemini on Codex or Claude Code when its key is set', async () => {
    process.env['GEMINI_API_KEY'] = 'test-key'
    for (const provider of ['codex', 'claude'] as const) {
      setCurrentLlmProvider(provider)
      await expect(
        buildClassificationAudioAnalysis({ projectId: 'p1', userId: 'u1' }),
      ).resolves.toBe('is_music: false')
    }
    expect(pins).toEqual(['gemini', 'gemini'])
  })

  it('goes straight to the text-only fallback on Codex or Claude Code without a Gemini key', async () => {
    delete process.env['GEMINI_API_KEY']
    for (const provider of ['codex', 'claude'] as const) {
      setCurrentLlmProvider(provider)
      await expect(
        buildClassificationAudioAnalysis({ projectId: 'p1', userId: 'u1' }),
      ).resolves.toBeUndefined()
    }
    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockRunCompletion).not.toHaveBeenCalled()
  })

  it('keeps the usual route on your own endpoint, even with a Gemini key', async () => {
    setCurrentLlmProvider('endpoint')
    process.env['GEMINI_API_KEY'] = 'test-key'
    await buildClassificationAudioAnalysis({ projectId: 'p1', userId: 'u1' })
    delete process.env['GEMINI_API_KEY']
    await buildClassificationAudioAnalysis({ projectId: 'p1', userId: 'u1' })
    expect(pins).toEqual([null, null])
  })
})
