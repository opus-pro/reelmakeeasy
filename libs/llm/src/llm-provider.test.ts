import { z } from 'zod'

import {
  audioLlmRoute,
  currentLlmProvider,
  LLM,
  LLM_NOT_SET_UP_MESSAGE,
  llmCanHearAudio,
  LlmNotSetUpError,
  setChatTransportResolver,
  setCurrentLlmProvider,
} from './index'

describe('the app-wide LLM provider', () => {
  afterEach(() => setCurrentLlmProvider(null))

  it('is null until the API registers one, and reads a registered function on every call', () => {
    expect(currentLlmProvider()).toBeNull()
    let provider: 'codex' | 'gemini' = 'codex'
    setCurrentLlmProvider(() => provider)
    expect(currentLlmProvider()).toBe('codex')
    provider = 'gemini'
    expect(currentLlmProvider()).toBe('gemini')
    setCurrentLlmProvider('claude')
    expect(currentLlmProvider()).toBe('claude')
  })

  it('knows Codex and Claude Code cannot hear audio', () => {
    for (const provider of ['codex', 'claude'] as const) {
      setCurrentLlmProvider(provider)
      expect(llmCanHearAudio()).toBe(false)
    }
    for (const provider of ['gemini', 'endpoint', null] as const) {
      setCurrentLlmProvider(provider)
      expect(llmCanHearAudio()).toBe(true)
    }
  })

  it('pins audio calls to Gemini only when the chosen AI cannot hear audio', () => {
    setCurrentLlmProvider('codex')
    expect(audioLlmRoute({ GEMINI_API_KEY: 'k' })).toBe('gemini')
    expect(audioLlmRoute({ GEMINI_API_KEY: ' ' })).toBe('skip')
    expect(audioLlmRoute({})).toBe('skip')
    setCurrentLlmProvider('endpoint')
    expect(audioLlmRoute({ GEMINI_API_KEY: 'k' })).toBe('default')
    expect(audioLlmRoute({})).toBe('default')
    setCurrentLlmProvider('gemini')
    expect(audioLlmRoute({ GEMINI_API_KEY: 'k' })).toBe('default')
  })
})

describe('LlmNotSetUpError', () => {
  afterEach(() => {
    setChatTransportResolver(null)
    jest.restoreAllMocks()
  })

  it('says, in plain words, that no AI is set up', () => {
    const error = new LlmNotSetUpError()
    expect(error.message).toBe(LLM_NOT_SET_UP_MESSAGE)
    expect(error.message).toBe('No AI is set up for writing and planning: open Setup')
    expect(error.name).toBe('LlmNotSetUpError')
  })

  it('fails a completion on its first attempt and keeps its class', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined)
    const send = jest.fn(() => Promise.reject(new LlmNotSetUpError()))
    setChatTransportResolver(() => ({ name: 'not-set-up', send }))
    const call = LLM.completion({
      models: ['flash', 'pro'],
      prompt: 'hi',
      responseFormat: z.string(),
      task: 'test',
    })
    await expect(call).rejects.toBeInstanceOf(LlmNotSetUpError)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
