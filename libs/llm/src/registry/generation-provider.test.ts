import {
  assertGenerationReady,
  currentGenerationProvider,
  GENERATION_NOT_SET_UP_MESSAGE,
  generationNotReadyMessage,
  GenerationNotSetUpError,
  generationProviderReady,
  resetGenerationProviderForTesting,
  setGenerationProvider,
  setGenerationProviderPin,
  setGenerationUnavailable,
} from './generation-provider'

const GEMINI_KEY_GONE =
  'Gemini is chosen in Setup but GEMINI_API_KEY is missing: add it to .env and restart, or pick fal'

describe('generation provider', () => {
  afterEach(() => resetGenerationProviderForTesting())

  it('is fal and ready until the API sets it (scripts, tests)', () => {
    expect(currentGenerationProvider()).toBe('fal')
    expect(generationProviderReady()).toBe(true)
    expect(() => assertGenerationReady()).not.toThrow()
  })

  it('follows the Setup choice', () => {
    setGenerationProvider('google')
    expect(currentGenerationProvider()).toBe('google')
    expect(generationProviderReady()).toBe(true)
  })

  it('stays on a chosen provider that cannot run, and says why instead of swapping', () => {
    setGenerationProvider('google')
    setGenerationUnavailable(GEMINI_KEY_GONE)
    expect(currentGenerationProvider()).toBe('google')
    expect(generationProviderReady()).toBe(false)
    expect(generationNotReadyMessage()).toBe(`${GENERATION_NOT_SET_UP_MESSAGE}. ${GEMINI_KEY_GONE}`)
    expect(() => assertGenerationReady()).toThrow(GenerationNotSetUpError)
    expect(() => assertGenerationReady()).toThrow(GEMINI_KEY_GONE)
  })

  it('names Setup when no provider has a key', () => {
    setGenerationProvider(null)
    setGenerationUnavailable('Add FAL_KEY or GEMINI_API_KEY to .env, then restart')
    expect(currentGenerationProvider()).toBe('fal')
    expect(generationNotReadyMessage()).toMatch(/open Setup\. Add FAL_KEY or GEMINI_API_KEY/)
  })

  it("prefers the run's pinned provider over the Setup choice", () => {
    setGenerationProvider('fal')
    setGenerationProviderPin(() => 'google')
    expect(currentGenerationProvider()).toBe('google')
    setGenerationProviderPin(() => undefined)
    expect(currentGenerationProvider()).toBe('fal')
  })
})
