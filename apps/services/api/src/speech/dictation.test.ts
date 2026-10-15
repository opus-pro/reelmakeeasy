import { dictationEngine, type DictationInputs, dictationOptions } from './dictation'

const inputs = (overrides: Partial<DictationInputs> = {}): DictationInputs => ({
  keys: { fal: false, gemini: false },
  local: null,
  localAsrOff: false,
  setting: 'auto',
  ...overrides,
})
const fastLocal = { device: 'mlx', transcribe: true }

describe('voice typing engine', () => {
  it('auto picks Gemini, then fast local Whisper, then fal, then the browser', () => {
    const all = inputs({ keys: { fal: true, gemini: true }, local: fastLocal })
    expect(dictationEngine(all)).toBe('gemini')
    expect(dictationEngine({ ...all, keys: { fal: true, gemini: false } })).toBe('local')
    expect(dictationEngine(inputs({ keys: { fal: true, gemini: false } }))).toBe('fal')
    expect(dictationEngine(inputs())).toBe('browser')
  })

  it('auto skips Whisper on a CPU, which is slow, but the user can still pick it', () => {
    const cpu = inputs({ local: { device: 'cpu', transcribe: true } })
    expect(dictationEngine(cpu)).toBe('browser')
    expect(dictationEngine({ ...cpu, setting: 'local' })).toBe('local')
  })

  it('uses a chosen engine only when it is available, never another one', () => {
    expect(dictationEngine(inputs({ keys: { fal: true, gemini: true }, setting: 'fal' }))).toBe(
      'fal',
    )
    expect(dictationEngine(inputs({ setting: 'gemini' }))).toBeNull()
    expect(dictationEngine(inputs({ setting: 'browser' }))).toBe('browser')
  })

  it('is off when turned off', () => {
    expect(
      dictationEngine(inputs({ keys: { fal: true, gemini: true }, setting: 'off' })),
    ).toBeNull()
  })

  it('says why an engine cannot be used', () => {
    const reasons = Object.fromEntries(
      dictationOptions(inputs({ localAsrOff: true })).map((o) => [o.id, o.reason ?? 'ok']),
    )
    expect(reasons).toEqual({
      browser: 'ok',
      fal: 'Add FAL_KEY to .env',
      gemini: 'Add GEMINI_API_KEY to .env',
      local: 'LOCAL_ASR is off in .env',
    })
    const notInstalled = dictationOptions(inputs({ local: { device: 'mlx', transcribe: false } }))
    expect(notInstalled.find((o) => o.id === 'local')?.reason).toMatch(/pnpm reelmakeeasy setup/)
    const noServer = dictationOptions(inputs())
    expect(noServer.find((o) => o.id === 'local')?.reason).toBe(
      "The local voice server isn't running",
    )
  })
})
