import {
  asksGeneration,
  harnessRows,
  initialChoices,
  keyRows,
  needsSetup,
  savePlan,
  staleChoiceMessages,
  videoKeyMissing,
  writerMissing,
} from './setup-status'
import { missing, ready, setupStatus } from './setup-status.fixtures'

describe('needsSetup', () => {
  it('stays hidden while the status loads, and once everything has an answer', () => {
    expect(needsSetup(null)).toBe(false)
    expect(needsSetup(setupStatus({ claude: ready, fal: true }))).toBe(false)
  })

  it('shows when nothing can write, or nothing can make the videos', () => {
    expect(needsSetup(setupStatus({ fal: true }))).toBe(true)
    expect(needsSetup(setupStatus({ claude: ready }))).toBe(true)
  })

  it('shows with both video keys until a video maker is saved', () => {
    expect(needsSetup(setupStatus({ claude: ready, fal: true, gemini: true }))).toBe(true)
    expect(
      needsSetup(
        setupStatus({ claude: ready, fal: true, gemini: true, savedGeneration: 'google' }),
      ),
    ).toBe(false)
  })

  it('treats a .env default the API reports as provider like a saved pick', () => {
    // GENERATION_PROVIDER=fal in .env with both keys: no question is pending, so no card.
    const fromEnv = setupStatus({ claude: ready, fal: true, gemini: true, savedGeneration: 'fal' })
    expect(needsSetup(fromEnv)).toBe(false)
    expect(staleChoiceMessages(fromEnv)).toEqual([])
  })

  it('shows when a saved choice stopped working', () => {
    expect(
      needsSetup(setupStatus({ claude: ready, codex: missing, fal: true, savedLlm: 'codex' })),
    ).toBe(true)
  })
})

describe('keyRows', () => {
  it('marks fal and Gemini, and says how ElevenLabs runs', () => {
    expect(keyRows(setupStatus({ fal: true }), 'fal')).toEqual([
      { id: 'fal', label: 'fal', tone: 'ok', value: '✓' },
      { id: 'gemini', label: 'Gemini', tone: 'muted', value: '–' },
      { id: 'elevenlabs', label: 'ElevenLabs', tone: 'ok', value: 'Through fal' },
    ])
    expect(keyRows(setupStatus({ elevenlabs: true, fal: true }), 'fal')[2].value).toBe('Your key')
    expect(keyRows(setupStatus({ fal: true, gemini: true }), 'google')[2].value).toBe('Not needed')
    expect(keyRows(setupStatus({ gemini: true }), 'google')[2].value).toBe('Not needed')
  })
})

describe('the questions', () => {
  it('asks who makes the videos only when fal and Gemini are both usable, or a saved one broke', () => {
    expect(asksGeneration(setupStatus({ fal: true }))).toBe(false)
    expect(asksGeneration(setupStatus({ fal: true, gemini: true }))).toBe(true)
    expect(asksGeneration(setupStatus({ fal: true, savedGeneration: 'google' }))).toBe(true)
  })

  it('starts from the choices in effect, else the first usable option', () => {
    expect(
      initialChoices(setupStatus({ claude: ready, codex: ready, fal: true, savedLlm: 'codex' })),
    ).toEqual({ generation: 'fal', llm: 'codex' })
    expect(initialChoices(setupStatus({ codex: ready, fal: true, savedLlm: 'claude' }))).toEqual({
      generation: 'fal',
      llm: 'codex',
    })
    expect(initialChoices(setupStatus())).toEqual({ generation: null, llm: null })
  })

  it('knows when a question has no usable answer', () => {
    expect(videoKeyMissing(setupStatus({ claude: ready }))).toBe(true)
    expect(videoKeyMissing(setupStatus({ gemini: true }))).toBe(false)
    expect(writerMissing(setupStatus({ fal: true }))).toBe(true)
    expect(writerMissing(setupStatus({ gemini: true }))).toBe(false)
  })
})

describe('savePlan', () => {
  it('stores the writer, and the video maker only when the card asked', () => {
    expect(
      savePlan(setupStatus({ claude: ready, fal: true }), { generation: 'fal', llm: 'claude' }),
    ).toEqual({ llm: 'claude' })
    expect(
      savePlan(setupStatus({ claude: ready, fal: true, gemini: true }), {
        generation: 'google',
        llm: 'claude',
      }),
    ).toEqual({ generation: 'google', llm: 'claude' })
  })

  it('never sends an option that is not usable', () => {
    expect(savePlan(setupStatus({ fal: true }), { generation: 'fal', llm: 'codex' })).toEqual({})
  })
})

describe('staleChoiceMessages', () => {
  it('reports a saved choice that stopped working, with the reason', () => {
    const status = setupStatus({ fal: true, savedGeneration: 'google', savedLlm: 'codex' })
    status.llm.options[1] = {
      ...status.llm.options[1],
      reason: 'Sign in: open ChatGPT and sign in to Codex',
    }
    expect(staleChoiceMessages(status)).toEqual([
      "Codex was picked to write and plan, but it isn't available now (Sign in: open ChatGPT and sign in to Codex). Pick another below, or fix it and Check again.",
      "Gemini was picked to make the videos, but it isn't available now. Pick another below, or fix it and Check again.",
    ])
    expect(
      staleChoiceMessages(setupStatus({ claude: ready, fal: true, savedLlm: 'claude' })),
    ).toEqual([])
  })
})

describe('harnessRows', () => {
  it('reuses the Agent dialog rows', () => {
    expect(harnessRows(null).map((r) => r.state)).toEqual(['checking', 'checking'])
    expect(harnessRows(setupStatus({ claude: ready })).map((r) => [r.harness, r.state])).toEqual([
      ['codex', 'unavailable'],
      ['claude', 'ready'],
    ])
  })
})
