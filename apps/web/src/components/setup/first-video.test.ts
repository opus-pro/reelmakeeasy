import {
  costLine,
  easyHarness,
  FIRST_VIDEO_ANSWERED_KEY,
  firstVideoAnswered,
  rememberFirstVideoAnswered,
  setupComplete,
  shouldAskFirstVideo,
  VIDEO_COST,
} from './first-video'
import { ready, setupStatus } from './setup-status.fixtures'

/** Set up: Claude Code writes, fal makes the videos. */
const COMPLETE = setupStatus({ claude: ready, fal: true })

describe('shouldAskFirstVideo', () => {
  const base = { answered: false, cardShowing: false, hasProjects: false, status: COMPLETE }

  it('asks a new user once setup is complete and there is no video yet', () => {
    expect(shouldAskFirstVideo(base)).toBe(true)
  })

  it('waits while the setup status loads, and while setup is not complete', () => {
    expect(shouldAskFirstVideo({ ...base, status: null })).toBe(false)
    // Nothing can write (no agent, no Gemini key).
    expect(shouldAskFirstVideo({ ...base, status: setupStatus({ fal: true }) })).toBe(false)
    // Nothing can make the videos (no fal or Gemini key).
    expect(shouldAskFirstVideo({ ...base, status: setupStatus({ claude: ready }) })).toBe(false)
  })

  it('stays away when there is a video already, or while that is not known yet', () => {
    expect(shouldAskFirstVideo({ ...base, hasProjects: true })).toBe(false)
    expect(shouldAskFirstVideo({ ...base, hasProjects: undefined })).toBe(false)
  })

  it('stays away once answered in this browser', () => {
    expect(shouldAskFirstVideo({ ...base, answered: true })).toBe(false)
  })

  it('never shows while the Get set up card is showing', () => {
    expect(shouldAskFirstVideo({ ...base, cardShowing: true })).toBe(false)
  })
})

describe('setupComplete', () => {
  it('needs an AI that writes and a video service, both in effect', () => {
    expect(setupComplete(null)).toBe(false)
    expect(setupComplete(setupStatus({ fal: true }))).toBe(false)
    expect(setupComplete(setupStatus({ claude: ready }))).toBe(false)
    expect(setupComplete(COMPLETE)).toBe(true)
    // Gemini alone both writes and makes the videos.
    expect(setupComplete(setupStatus({ gemini: true }))).toBe(true)
  })
})

describe('costLine', () => {
  it('says about what a 30-second video costs on the video service in effect', () => {
    expect(costLine('fal')).toBe('A 30-second video costs about $0.70 on fal.')
    expect(costLine('google')).toBe('A 30-second video costs about $3 on Gemini.')
  })

  it('takes its numbers from one place', () => {
    expect(costLine('fal')).toContain(VIDEO_COST.fal)
    expect(costLine('google')).toContain(VIDEO_COST.google)
  })
})

describe('easyHarness', () => {
  it('uses the agent picked to write when it is Codex or Claude Code', () => {
    const both = { claude: ready, codex: ready, fal: true }
    expect(easyHarness(setupStatus({ ...both, savedLlm: 'claude' }))).toBe('claude')
    expect(easyHarness(setupStatus({ ...both, savedLlm: 'codex' }))).toBe('codex')
  })

  it('with Gemini writing, uses the first ready agent, Codex first', () => {
    expect(
      easyHarness(setupStatus({ claude: ready, codex: ready, gemini: true, savedLlm: 'gemini' })),
    ).toBe('codex')
    expect(easyHarness(setupStatus({ claude: ready, gemini: true, savedLlm: 'gemini' }))).toBe(
      'claude',
    )
  })

  it('is null when neither Codex nor Claude Code is ready', () => {
    expect(easyHarness(setupStatus({ gemini: true }))).toBeNull()
  })
})

describe('the answered flag', () => {
  afterEach(() => {
    jest.restoreAllMocks()
    localStorage.clear()
  })

  it('is remembered in this browser', () => {
    expect(firstVideoAnswered()).toBe(false)
    rememberFirstVideoAnswered()
    expect(localStorage.getItem(FIRST_VIDEO_ANSWERED_KEY)).toBe('1')
    expect(firstVideoAnswered()).toBe(true)
  })

  it('reads as not answered, and saving does nothing, when storage is blocked', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(firstVideoAnswered()).toBe(false)
    expect(() => rememberFirstVideoAnswered()).not.toThrow()
  })
})
