import type { CodexStatus } from '@shared/types/api/agent'

import {
  findCodexBinary,
  getCodexStatus,
  probeCodex,
  resetCodexStatusCacheForTesting,
} from './codex-locator'

const CHATGPT = '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'

describe('findCodexBinary', () => {
  it('prefers CODEX_BIN, then PATH, then Codex.app, then ChatGPT.app', () => {
    const exists = (p: string) => ['/opt/codex', '/usr/local/bin/codex', CHATGPT].includes(p)
    expect(
      findCodexBinary({ env: { CODEX_BIN: '/opt/codex', PATH: '/usr/local/bin' }, exists }),
    ).toBe('/opt/codex')
    expect(findCodexBinary({ env: { PATH: '/usr/local/bin' }, exists })).toBe(
      '/usr/local/bin/codex',
    )
    expect(findCodexBinary({ env: { PATH: '/nowhere' }, exists })).toBe(CHATGPT)
  })

  it('returns null when nothing exists', () => {
    expect(findCodexBinary({ env: { PATH: '/nowhere' }, exists: () => false })).toBeNull()
  })
})

describe('probeCodex', () => {
  it('reports available when version and login succeed', async () => {
    const run = async (args: string[]) =>
      args[0] === '--version'
        ? { code: 0, out: 'codex-cli 0.158.0\n' }
        : { code: 0, out: 'Logged in using ChatGPT\n' }
    await expect(probeCodex('/x/codex', run)).resolves.toEqual({
      available: true,
      binary: '/x/codex',
      loggedIn: true,
      version: '0.158.0',
    })
  })

  it('reports not-logged-in with the binary and version', async () => {
    const run = async (args: string[]) =>
      args[0] === '--version'
        ? { code: 0, out: 'codex-cli 0.158.0' }
        : { code: 1, out: 'Not logged in' }
    await expect(probeCodex('/x/codex', run)).resolves.toMatchObject({
      available: false,
      loggedIn: false,
      reason: 'not-logged-in',
      version: '0.158.0',
    })
  })

  it('reports probe-failed when --version fails', async () => {
    const run = async () => ({ code: 127, out: '' })
    await expect(probeCodex('/x/codex', run)).resolves.toMatchObject({
      available: false,
      reason: 'probe-failed',
    })
  })
})

describe('getCodexStatus caching', () => {
  const find = () => '/x/codex'
  const makeProbe =
    (calls: { count: number }) =>
    async (binary: string): Promise<CodexStatus> => {
      calls.count += 1
      return { available: true, binary, loggedIn: true, version: '1.0.0' }
    }

  it('serves the second call from cache, but `refresh: true` always probes again', async () => {
    const calls = { count: 0 }
    const probe = makeProbe(calls)

    await getCodexStatus({}, { find, probe })
    await getCodexStatus({}, { find, probe })
    expect(calls.count).toBe(1)

    await getCodexStatus({ refresh: true }, { find, probe })
    await getCodexStatus({ refresh: true }, { find, probe })
    expect(calls.count).toBe(3)

    // A plain call right after the refreshed ones is served from the cache
    // the last refresh just wrote, not a fourth probe.
    await getCodexStatus({}, { find, probe })
    expect(calls.count).toBe(3)
  })
})

describe('getCodexStatus probe environment', () => {
  it('probes with the agent Codex home and without ReelMakeEasy secrets, like a session', async () => {
    const envs: NodeJS.ProcessEnv[] = []
    const calls: string[][] = []
    process.env['GEMINI_API_KEY'] = 'test-not-a-key'
    try {
      const status = await getCodexStatus(
        { refresh: true },
        {
          find: () => '/x/codex',
          home: () => '/tmp/reelmakeeasy-agent-home',
          runner: (binary, env) => {
            envs.push(env)
            return async (args) => {
              calls.push([binary, ...args])
              return args[0] === '--version'
                ? { code: 0, out: 'codex-cli 0.158.0\n' }
                : { code: 0, out: 'Logged in using ChatGPT\n' }
            }
          },
        },
      )
      expect(status).toMatchObject({ available: true, loggedIn: true })
    } finally {
      delete process.env['GEMINI_API_KEY']
    }
    expect(calls).toContainEqual(['/x/codex', 'login', 'status'])
    expect(envs.length).toBeGreaterThan(0)
    for (const env of envs) {
      expect(env['CODEX_HOME']).toBe('/tmp/reelmakeeasy-agent-home')
      expect(env['GEMINI_API_KEY']).toBeUndefined()
      expect(env['PATH']).toBe(process.env['PATH'])
    }
  })
})

describe('getCodexStatus when the agent home cannot be prepared', () => {
  beforeEach(() => resetCodexStatusCacheForTesting())

  it('reports probe-failed instead of throwing', async () => {
    await expect(
      getCodexStatus(
        { refresh: true },
        {
          find: () => '/x/codex',
          home: () => {
            throw new Error('EACCES')
          },
          runner: () => async () => ({ code: 0, out: '' }),
        },
      ),
    ).resolves.toMatchObject({ available: false, reason: 'probe-failed' })
  })
})

describe('a check that does not answer in time (a busy computer)', () => {
  const READY: CodexStatus = {
    available: true,
    binary: '/x/codex',
    loggedIn: true,
    version: '1.0.0',
  }
  const FAILED: CodexStatus = {
    available: false,
    binary: '/x/codex',
    loggedIn: false,
    reason: 'probe-failed',
    version: null,
  }

  beforeEach(() => resetCodexStatusCacheForTesting())
  afterEach(() => jest.useRealTimers())

  it('reads a timed-out login check as a failed check, not a sign-out', async () => {
    const run = async (args: string[]) =>
      args[0] === '--version'
        ? { code: 0, out: 'codex-cli 0.158.0' }
        : { code: 1, out: '', timedOut: true }
    await expect(probeCodex('/x/codex', run)).resolves.toMatchObject({
      available: false,
      reason: 'probe-failed',
    })
  })

  it('keeps the last good answer for up to 5 minutes, then reports the failed check', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
      now: 1_000_000,
    })
    const probe = jest.fn(async (): Promise<CodexStatus> => FAILED).mockResolvedValueOnce(READY)
    const deps = { find: () => '/x/codex', probe }
    await getCodexStatus({ refresh: true }, deps)
    await expect(getCodexStatus({ refresh: true }, deps)).resolves.toEqual(READY)
    jest.setSystemTime(1_000_000 + 5 * 60_000)
    await expect(getCodexStatus({ refresh: true }, deps)).resolves.toEqual(FAILED)
  })

  it('takes a finished check that says signed out at once', async () => {
    const signedOut: CodexStatus = { ...FAILED, reason: 'not-logged-in', version: '1.0.0' }
    const probe = jest.fn(async (): Promise<CodexStatus> => signedOut).mockResolvedValueOnce(READY)
    const deps = { find: () => '/x/codex', probe }
    await getCodexStatus({ refresh: true }, deps)
    await expect(getCodexStatus({ refresh: true }, deps)).resolves.toEqual(signedOut)
  })
})
