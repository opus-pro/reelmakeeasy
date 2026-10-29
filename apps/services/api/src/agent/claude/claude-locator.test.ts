import type { HarnessStatus } from '@shared/types/api/agent'

import {
  findClaudeBinary,
  getClaudeStatus,
  probeClaude,
  resetClaudeStatusCacheForTesting,
  resolveClaudeBinaryOrThrow,
} from './claude-locator'

const exists = (paths: string[]) => (p: string) => paths.includes(p)

describe('findClaudeBinary', () => {
  it('prefers CLAUDE_BIN, then PATH, then the installer locations', () => {
    const platform = 'darwin'
    expect(
      findClaudeBinary({
        env: { CLAUDE_BIN: '/x/claude' },
        exists: exists(['/x/claude']),
        platform,
      }),
    ).toBe('/x/claude')
    expect(
      findClaudeBinary({ env: { CLAUDE_BIN: '/missing' }, exists: exists([]), platform }),
    ).toBeNull()
    expect(
      findClaudeBinary({ env: { PATH: '/a:/b' }, exists: exists(['/b/claude']), platform }),
    ).toBe('/b/claude')
    expect(
      findClaudeBinary({
        env: { HOME: '/h', PATH: '' },
        exists: exists(['/h/.claude/local/claude']),
        platform,
      }),
    ).toBe('/h/.claude/local/claude')
    expect(
      findClaudeBinary({
        env: { HOME: '/h', PATH: '' },
        exists: exists(['/h/.local/bin/claude']),
        platform,
      }),
    ).toBe('/h/.local/bin/claude')
    expect(findClaudeBinary({ env: { PATH: '' }, exists: exists([]), platform })).toBeNull()
  })

  it('on Windows finds claude.exe on Path (any case) or in USERPROFILE, never a .cmd shim', () => {
    const platform = 'win32'
    expect(
      findClaudeBinary({
        env: { Path: 'C:\\a;C:\\b' },
        exists: exists(['C:\\b\\claude.exe']),
        platform,
      }),
    ).toBe('C:\\b\\claude.exe')
    // A bare `claude` or an npm `claude.cmd` can't be started without a shell.
    expect(
      findClaudeBinary({
        env: { PATH: 'C:\\npm' },
        exists: exists(['C:\\npm\\claude', 'C:\\npm\\claude.cmd']),
        platform,
      }),
    ).toBeNull()
    const installed = 'C:\\Users\\a b\\.local\\bin\\claude.exe'
    expect(
      findClaudeBinary({
        env: { PATH: '', USERPROFILE: 'C:\\Users\\a b' },
        exists: exists([installed]),
        platform,
      }),
    ).toBe(installed)
  })
})

describe('probeClaude', () => {
  const run =
    (version: string, auth: string, authCode = 0) =>
    async (args: string[]) =>
      args[0] === '--version' ? { code: 0, out: version } : { code: authCode, out: auth }

  it('reads the version and the login', async () => {
    await expect(
      probeClaude(
        '/c',
        run('2.1.281 (Claude Code)\n', '{"loggedIn":true,"authMethod":"claude.ai"}'),
        {},
      ),
    ).resolves.toEqual({ available: true, binary: '/c', loggedIn: true, version: '2.1.281' })
  })

  it('is signed out without a login or an API key (auth status exits non-zero)', async () => {
    await expect(
      probeClaude('/c', run('2.1.281 (Claude Code)', '{"loggedIn":false}', 1), {}),
    ).resolves.toEqual({
      available: false,
      binary: '/c',
      loggedIn: false,
      reason: 'not-logged-in',
      version: '2.1.281',
    })
  })

  it('counts ANTHROPIC_API_KEY as signed in', async () => {
    const s = await probeClaude('/c', run('2.1.281', '{"loggedIn":false}'), {
      ANTHROPIC_API_KEY: 'k',
    })
    expect(s).toMatchObject({ available: true, loggedIn: true })
  })

  it('reports a binary that does not answer', async () => {
    const dead = async () => ({ code: 1, out: '' })
    await expect(probeClaude('/c', dead, {})).resolves.toMatchObject({
      available: false,
      reason: 'probe-failed',
    })
  })
})

describe('getClaudeStatus', () => {
  it('is not-found without a binary, and caches for 30 s unless refreshed', async () => {
    const probe = jest.fn(async () => ({
      available: true,
      binary: '/c',
      loggedIn: true,
      version: '1',
    }))
    await expect(getClaudeStatus({ refresh: true }, { find: () => null })).resolves.toMatchObject({
      reason: 'not-found',
    })
    await getClaudeStatus({ refresh: true }, { find: () => '/c', probe })
    await getClaudeStatus({}, { find: () => '/c', probe })
    expect(probe).toHaveBeenCalledTimes(1)
  })
})

describe('getClaudeStatus without a sandbox', () => {
  it('is not ready where the shell sandbox is missing (Linux without bubblewrap)', async () => {
    const probe = async () => ({ available: true, binary: '/c', loggedIn: true, version: '1' })
    await expect(
      getClaudeStatus({ refresh: true }, { find: () => '/c', probe, sandboxReady: () => false }),
    ).resolves.toMatchObject({ available: false, loggedIn: true, reason: 'no-sandbox' })
  })
})

describe('resolveClaudeBinaryOrThrow without a sandbox', () => {
  it('gives planning calls the binary, and still refuses agent chats', async () => {
    const probe = async () => ({ available: true, binary: '/c', loggedIn: true, version: '1' })
    await getClaudeStatus({ refresh: true }, { find: () => '/c', probe, sandboxReady: () => false })
    await expect(resolveClaudeBinaryOrThrow({ sandbox: false })).resolves.toBe('/c')
    await expect(resolveClaudeBinaryOrThrow()).rejects.toThrow(
      'Claude Code is not available (no-sandbox)',
    )
  })

  it('never gives planning calls a signed-out Claude Code', async () => {
    const probe = async () => ({
      available: false,
      binary: '/c',
      loggedIn: false,
      reason: 'not-logged-in' as const,
      version: '1',
    })
    await getClaudeStatus({ refresh: true }, { find: () => '/c', probe })
    await expect(resolveClaudeBinaryOrThrow({ sandbox: false })).rejects.toThrow(
      'Claude Code is not available (not-logged-in)',
    )
  })
})

describe('a check that does not answer in time (a busy computer)', () => {
  const READY: HarnessStatus = { available: true, binary: '/c', loggedIn: true, version: '1' }
  const FAILED: HarnessStatus = {
    available: false,
    binary: '/c',
    loggedIn: false,
    reason: 'probe-failed',
    version: null,
  }
  const depsFor = (probe: () => Promise<HarnessStatus>) => ({
    find: () => '/c',
    probe,
    sandboxReady: () => true,
  })

  beforeEach(() => resetClaudeStatusCacheForTesting())
  afterEach(() => jest.useRealTimers())

  it('reads a timed-out sign-in check as a failed check, not a sign-out', async () => {
    const run = async (args: string[]) =>
      args[0] === '--version' ? { code: 0, out: '2.1.281' } : { code: 1, out: '', timedOut: true }
    await expect(probeClaude('/c', run, {})).resolves.toMatchObject({
      available: false,
      reason: 'probe-failed',
    })
  })

  it('keeps the last good answer for up to 5 minutes, then reports the failed check', async () => {
    jest.useFakeTimers({
      doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'],
      now: 1_000_000,
    })
    const deps = depsFor(jest.fn(async () => FAILED).mockResolvedValueOnce(READY))
    await getClaudeStatus({ refresh: true }, deps)
    await expect(getClaudeStatus({ refresh: true }, deps)).resolves.toEqual(READY)
    jest.setSystemTime(1_000_000 + 5 * 60_000)
    await expect(getClaudeStatus({ refresh: true }, deps)).resolves.toEqual(FAILED)
  })

  it('takes a finished check that says signed out at once', async () => {
    const signedOut: HarnessStatus = { ...FAILED, reason: 'not-logged-in', version: '1' }
    const deps = depsFor(jest.fn(async () => signedOut).mockResolvedValueOnce(READY))
    await getClaudeStatus({ refresh: true }, deps)
    await expect(getClaudeStatus({ refresh: true }, deps)).resolves.toEqual(signedOut)
  })

  it('keeps a signed-in answer that only lacks the sandbox, which planning calls still use', async () => {
    const probe = jest.fn(async () => FAILED).mockResolvedValueOnce(READY)
    const deps = { find: () => '/c', probe, sandboxReady: () => false }
    const noSandbox = await getClaudeStatus({ refresh: true }, deps)
    expect(noSandbox).toMatchObject({ loggedIn: true, reason: 'no-sandbox' })
    await expect(getClaudeStatus({ refresh: true }, deps)).resolves.toEqual(noSandbox)
    await expect(resolveClaudeBinaryOrThrow({ sandbox: false })).resolves.toBe('/c')
  })
})
