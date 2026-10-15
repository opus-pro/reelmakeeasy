import { JobContext } from '@reelmakeeasy/common/job-context'
import { setCurrentLlmProvider } from '@reelmakeeasy/llm'

import { analyzeVoiceProfileFromAudioUri } from './voice-profile.util'

const mockCompletion = jest.fn()
jest.mock('@reelmakeeasy/common/llm/completion', () => ({
  completion: (...args: unknown[]) => mockCompletion(...args),
}))

const ORIGINAL_ENV = { ...process.env }
const ANALYSIS = {
  ageRange: '30s',
  perceivedGender: 'female',
  rawDescription: 'warm narrator',
  tags: ['warm'],
}
const CLONE = { audioUri: 'store://clone.mp3', sourceKind: 'voice_clone' } as const

/** The AI the LLM call was pinned to, read inside the call. */
function pinNow(): unknown {
  try {
    return JobContext.getByKey('llmProvider', null)
  } catch {
    return null
  }
}

describe('analyzeVoiceProfileFromAudioUri', () => {
  let pins: unknown[] = []

  beforeEach(() => {
    pins = []
    mockCompletion.mockReset().mockImplementation(async () => {
      pins.push(pinNow())
      return ANALYSIS
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
      const profile = await analyzeVoiceProfileFromAudioUri(CLONE)
      expect(profile).toMatchObject({ perceivedGender: 'female' })
    }
    expect(pins).toEqual(['gemini', 'gemini'])
  })

  it('skips the analysis on Codex or Claude Code without a Gemini key', async () => {
    delete process.env['GEMINI_API_KEY']
    for (const provider of ['codex', 'claude'] as const) {
      setCurrentLlmProvider(provider)
      await expect(analyzeVoiceProfileFromAudioUri(CLONE)).resolves.toBeNull()
    }
    expect(mockCompletion).not.toHaveBeenCalled()
  })

  it('keeps the usual route on your own endpoint, even with a Gemini key', async () => {
    setCurrentLlmProvider('endpoint')
    process.env['GEMINI_API_KEY'] = 'test-key'
    await analyzeVoiceProfileFromAudioUri(CLONE)
    delete process.env['GEMINI_API_KEY']
    await analyzeVoiceProfileFromAudioUri(CLONE)
    expect(pins).toEqual([null, null])
  })
})
