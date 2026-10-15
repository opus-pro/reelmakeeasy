import { resolveChatModels } from './chat'
import { chatEndpoint, setChatEndpointPreference } from './config'

const ORIGINAL_ENV = { ...process.env }
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai'

describe('chatEndpoint preference', () => {
  beforeEach(() => {
    process.env['LLM_BASE_URL'] = 'https://my-llm.test/v1/'
    process.env['LLM_API_KEY'] = 'endpoint-key'
    process.env['GEMINI_API_KEY'] = 'gemini-key'
  })

  afterEach(() => {
    setChatEndpointPreference(null)
    process.env = { ...ORIGINAL_ENV }
  })

  it('keeps the env rule without a preference: LLM_BASE_URL wins over Gemini', () => {
    expect(chatEndpoint()).toEqual({
      apiKey: 'endpoint-key',
      baseUrl: 'https://my-llm.test/v1',
      name: 'my-llm.test',
    })
  })

  it('uses Gemini when Gemini is preferred, even with LLM_BASE_URL set', () => {
    setChatEndpointPreference('gemini')
    expect(chatEndpoint()).toEqual({
      apiKey: 'gemini-key',
      baseUrl: GEMINI_BASE_URL,
      name: 'gemini',
    })
    expect(resolveChatModels(['gemini-2.5-pro'])).toEqual(['gemini-2.5-pro'])
  })

  it('uses the custom endpoint when it is preferred', () => {
    setChatEndpointPreference('endpoint')
    expect(chatEndpoint().name).toBe('my-llm.test')
  })

  it('reads a preference function on every call', () => {
    let preference: 'endpoint' | 'gemini' = 'endpoint'
    setChatEndpointPreference(() => preference)
    expect(chatEndpoint().name).toBe('my-llm.test')
    preference = 'gemini'
    expect(chatEndpoint().name).toBe('gemini')
  })

  it('says which setting is missing for the preferred endpoint', () => {
    delete process.env['GEMINI_API_KEY']
    setChatEndpointPreference('gemini')
    expect(() => chatEndpoint()).toThrow(
      'Gemini is chosen for writing and planning, but GEMINI_API_KEY is not set',
    )
    delete process.env['LLM_BASE_URL']
    setChatEndpointPreference('endpoint')
    expect(() => chatEndpoint()).toThrow(
      'Your own endpoint is chosen for writing and planning, but LLM_BASE_URL is not set',
    )
  })

  it('still falls back to Gemini without LLM_BASE_URL and no preference', () => {
    delete process.env['LLM_BASE_URL']
    expect(chatEndpoint()).toEqual({
      apiKey: 'gemini-key',
      baseUrl: GEMINI_BASE_URL,
      name: 'gemini',
    })
  })

  it('never sends the Gemini key to a custom endpoint, only to Google', () => {
    delete process.env['LLM_API_KEY']
    setChatEndpointPreference('endpoint')
    expect(chatEndpoint()).toEqual({
      apiKey: '',
      baseUrl: 'https://my-llm.test/v1',
      name: 'my-llm.test',
    })
    process.env['LLM_BASE_URL'] = GEMINI_BASE_URL
    expect(chatEndpoint().apiKey).toBe('gemini-key')
  })
})
