import fs from 'node:fs'

import { JobContext } from '@reelmakeeasy/common/job-context'
import { setCurrentLlmProvider } from '@reelmakeeasy/llm'

import { analyzeLongTakeVoiceCharacter } from './voice-character'

const mockRunCompletion = jest.fn()
jest.mock('../long-take-generation-record', () => ({
  runLongTakeCompletionWithRecord: (...args: unknown[]) => mockRunCompletion(...args),
}))
const mockDownload = jest.fn()
jest.mock('./common', () => ({
  ...jest.requireActual('./common'),
  downloadAssetToLocal: (...args: unknown[]) => mockDownload(...args),
  getVideoDurationSeconds: async () => 12,
}))
jest.mock('./storage', () => ({
  ...jest.requireActual('./storage'),
  createLongTakeStorage: () => ({
    ensureDir: async () => undefined,
    getFullPath: (p: string) => `store://${p}`,
    writeJsonFile: async () => undefined,
  }),
}))

const ORIGINAL_ENV = { ...process.env }
const ANALYSIS = {
  voice_character: 'warm baritone',
  voice_profile: {
    ageRange: '30s',
    perceivedGender: 'male',
    rawDescription: 'warm baritone',
    tags: ['warm'],
  },
}
const SKIPPED = { outputPath: '', voiceCharacter: '' }

/** The AI the LLM call was pinned to, read inside the call. */
function pinNow(): unknown {
  try {
    return JobContext.getByKey('llmProvider', null)
  } catch {
    return null
  }
}

describe('analyzeLongTakeVoiceCharacter', () => {
  let pins: unknown[] = []

  beforeEach(() => {
    process.env['LLM_SKIP_CACHE'] = '1'
    pins = []
    mockDownload.mockReset().mockImplementation(async (_uri: string, dest: string) => {
      await fs.promises.writeFile(dest, 'mp3')
    })
    mockRunCompletion.mockReset().mockImplementation(async () => {
      pins.push(pinNow())
      return ANALYSIS
    })
  })

  afterEach(() => {
    setCurrentLlmProvider(null)
    process.env = { ...ORIGINAL_ENV }
  })

  it('pins the analysis to Gemini on Codex or Claude Code when its key is set', async () => {
    process.env['GEMINI_API_KEY'] = 'test-key'
    for (const provider of ['codex', 'claude'] as const) {
      setCurrentLlmProvider(provider)
      await expect(
        analyzeLongTakeVoiceCharacter({ projectId: 'p1', userId: 'u1' }),
      ).resolves.toMatchObject({
        voiceCharacter: 'warm baritone',
        voiceProfile: { perceivedGender: 'male' },
      })
    }
    expect(pins).toEqual(['gemini', 'gemini'])
  })

  it('skips without downloading or calling the LLM on Codex or Claude Code without a Gemini key', async () => {
    delete process.env['GEMINI_API_KEY']
    for (const provider of ['codex', 'claude'] as const) {
      setCurrentLlmProvider(provider)
      await expect(
        analyzeLongTakeVoiceCharacter({ projectId: 'p1', userId: 'u1' }),
      ).resolves.toEqual(SKIPPED)
    }
    expect(mockDownload).not.toHaveBeenCalled()
    expect(mockRunCompletion).not.toHaveBeenCalled()
  })

  it('keeps the usual route on Gemini or your own endpoint, even with a Gemini key', async () => {
    process.env['GEMINI_API_KEY'] = 'test-key'
    for (const provider of ['gemini', 'endpoint', null] as const) {
      setCurrentLlmProvider(provider)
      await expect(
        analyzeLongTakeVoiceCharacter({ projectId: 'p1', userId: 'u1' }),
      ).resolves.toMatchObject({ voiceCharacter: 'warm baritone' })
    }
    expect(pins).toEqual([null, null, null])
  })

  it('treats an agent-mode run like Codex or Claude Code, whatever AI is chosen in Setup', async () => {
    const agentRun = { agentHarnessRun: true, projectId: 'p1', userId: 'u1' }
    process.env['GEMINI_API_KEY'] = 'test-key'
    setCurrentLlmProvider('gemini')
    await analyzeLongTakeVoiceCharacter(agentRun)
    expect(pins).toEqual(['gemini'])

    delete process.env['GEMINI_API_KEY']
    setCurrentLlmProvider('endpoint')
    await expect(analyzeLongTakeVoiceCharacter(agentRun)).resolves.toEqual(SKIPPED)
    expect(mockRunCompletion).toHaveBeenCalledTimes(1)
  })
})
