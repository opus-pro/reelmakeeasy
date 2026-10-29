import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildCheck,
  buildPlan,
  buildStamp,
  outputSignature,
  parseBuildStamp,
  planSummary,
  pnpmCommand,
  runPorts,
  sourceFingerprint,
  webBuildSettings,
} from './reelmakeeasy-build.mjs'

const git = { diff: '', head: 'a'.repeat(40) }

/** The state of a finished build of `git`, with both outputs in place. */
function built(over = {}) {
  return {
    outputs: { api: '100:1', web: '200:2' },
    settings: webBuildSettings({}),
    source: sourceFingerprint(git),
    ...over,
  }
}

describe('runPorts', () => {
  it('uses 5017 and 3000 and leaves the web app on its default API address', () => {
    assert.deepEqual(runPorts({}), { apiPort: 5017, webDefaults: {}, webPort: 3000 })
  })

  it('points the web app at an API moved off 5017', () => {
    assert.deepEqual(runPorts({ PORT: '5117', WEB_PORT: '3100' }), {
      apiPort: 5117,
      webDefaults: {
        DEV_API_PROXY_TARGET: 'http://localhost:5117',
        NEXT_PUBLIC_API_ORIGIN: 'http://localhost:5117',
      },
      webPort: 3100,
    })
  })

  it('keeps an API address the env already sets', () => {
    const ports = runPorts({ NEXT_PUBLIC_API_ORIGIN: 'http://127.0.0.1:6000', PORT: '6000' })
    assert.deepEqual(ports.webDefaults, { DEV_API_PROXY_TARGET: 'http://localhost:6000' })
  })
})

describe('sourceFingerprint', () => {
  it('is null without git', () => {
    assert.equal(sourceFingerprint(null), null)
    assert.equal(sourceFingerprint({ diff: '', head: '' }), null)
  })

  it('changes with the commit and with uncommitted changes, and nothing else', () => {
    assert.equal(sourceFingerprint(git), sourceFingerprint({ ...git }))
    assert.notEqual(sourceFingerprint(git), sourceFingerprint({ ...git, head: 'b'.repeat(40) }))
    assert.notEqual(sourceFingerprint(git), sourceFingerprint({ ...git, diff: '+edit\n' }))
    assert.equal(
      sourceFingerprint({ ...git, diff: Buffer.from('+edit\n') }),
      sourceFingerprint({ ...git, diff: '+edit\n' }),
    )
  })
})

describe('webBuildSettings', () => {
  it('follows what the web build bakes in, and ignores everything else', () => {
    const base = webBuildSettings({ FAL_KEY: 'k', PORT: '5017' })
    assert.equal(base, webBuildSettings({}))
    assert.equal(base, webBuildSettings({ NEXT_PUBLIC_API_ORIGIN: '' }))
    assert.notEqual(base, webBuildSettings({ NEXT_PUBLIC_API_ORIGIN: 'http://localhost:5117' }))
    assert.notEqual(base, webBuildSettings({ DEV_API_PROXY_TARGET: 'http://localhost:5117' }))
    assert.notEqual(base, webBuildSettings({ NEXT_PUBLIC_WASM_PATH: '/engine.wasm' }))
    assert.equal(
      webBuildSettings({ NEXT_PUBLIC_A: '1', NEXT_PUBLIC_B: '2' }),
      webBuildSettings({ NEXT_PUBLIC_B: '2', NEXT_PUBLIC_A: '1' }),
    )
  })

  it('does not keep the values themselves', () => {
    assert.doesNotMatch(webBuildSettings({ NEXT_PUBLIC_TOKEN: 'secret' }), /secret/)
  })
})

describe('outputSignature', () => {
  it('is null for a missing file, else its size and time', () => {
    assert.equal(outputSignature(undefined), null)
    assert.equal(outputSignature({ mtimeMs: 1234.6, size: 99 }), '99:1235')
  })
})

describe('buildPlan', () => {
  it('builds nothing when the stamp matches the code, the settings and the outputs', () => {
    const current = built()
    assert.deepEqual(buildPlan({ current, stamp: buildStamp(current) }), { api: null, web: null })
  })

  it('builds a missing output, even without git', () => {
    const current = built({ outputs: { api: '100:1', web: null }, source: null })
    assert.deepEqual(buildPlan({ current, stamp: undefined }), {
      api: null,
      web: 'not built yet',
    })
  })

  it('builds both after a pull or a local edit', () => {
    const stamp = buildStamp(built())
    const current = built({ source: sourceFingerprint({ ...git, diff: '+edit\n' }) })
    assert.deepEqual(buildPlan({ current, stamp }), {
      api: 'the code changed since the last build',
      web: 'the code changed since the last build',
    })
  })

  it('builds the web app alone when PORT moved the API address it bakes in', () => {
    const stamp = buildStamp(built())
    const current = built({
      settings: webBuildSettings({ NEXT_PUBLIC_API_ORIGIN: 'http://localhost:5117' }),
    })
    assert.deepEqual(buildPlan({ current, stamp }), {
      api: null,
      web: 'its settings changed (PORT or a NEXT_PUBLIC_ value)',
    })
  })

  it('builds an output another command rebuilt since, as it may hold other code', () => {
    const stamp = buildStamp(built())
    const current = built({ outputs: { api: '150:9', web: '200:2' } })
    assert.deepEqual(buildPlan({ current, stamp }), {
      api: 'another command rebuilt it since',
      web: null,
    })
  })

  it('builds both with git but no record of the last build', () => {
    assert.deepEqual(buildPlan({ current: built(), stamp: undefined }), {
      api: 'no record of the last build',
      web: 'no record of the last build',
    })
  })

  it('without git, builds only what is missing or set up differently', () => {
    const current = built({ source: null })
    assert.deepEqual(buildPlan({ current, stamp: undefined }), { api: null, web: null })
    const stamp = buildStamp(current)
    assert.deepEqual(
      buildPlan({ current: { ...current, outputs: { api: '150:9', web: '200:2' } }, stamp }),
      { api: null, web: null },
    )
    assert.deepEqual(
      buildPlan({ current: { ...current, settings: webBuildSettings({ PORT_X: '1' }) }, stamp }),
      { api: null, web: null },
    )
    assert.deepEqual(
      buildPlan({
        current: { ...current, settings: webBuildSettings({ NEXT_PUBLIC_X: '1' }) },
        stamp,
      }),
      { api: null, web: 'its settings changed (PORT or a NEXT_PUBLIC_ value)' },
    )
  })
})

describe('build stamp', () => {
  it('round-trips, and reads a missing or broken stamp as none', () => {
    const stamp = buildStamp(built(), new Date('2026-10-10T00:00:00Z'))
    assert.equal(stamp.builtAt, '2026-10-10T00:00:00.000Z')
    assert.deepEqual(parseBuildStamp(JSON.stringify(stamp)), stamp)
    assert.equal(parseBuildStamp(''), undefined)
    assert.equal(parseBuildStamp('{not json'), undefined)
    assert.equal(parseBuildStamp('[]'), undefined)
    assert.equal(parseBuildStamp('{"version":99}'), undefined)
  })
})

describe('planSummary and buildCheck', () => {
  it('say what will be built and why, in plain words', () => {
    assert.equal(planSummary({ api: null, web: null }), null)
    assert.equal(
      planSummary({ api: 'not built yet', web: 'not built yet' }),
      'the API (not built yet) and the web app (not built yet)',
    )
    assert.equal(
      planSummary({ api: null, web: 'the code changed since the last build' }),
      'the web app (the code changed since the last build)',
    )
  })

  it("is doctor's non-blocking Build line", () => {
    assert.deepEqual(buildCheck({ api: null, web: null }), {
      blocking: false,
      detail: 'built and up to date',
      name: 'Build',
      ok: true,
    })
    assert.deepEqual(buildCheck({ api: 'not built yet', web: null }), {
      blocking: false,
      detail: 'needs a build: the API (not built yet). `pnpm reelmakeeasy start` builds it',
      name: 'Build',
      ok: false,
    })
  })
})

describe('pnpmCommand', () => {
  const node = 'C:\\Program Files\\nodejs\\node.exe'
  const win = (npm_execpath) => ({
    env: npm_execpath ? { npm_execpath } : {},
    execPath: node,
    platform: 'win32',
  })

  it('runs pnpm from PATH off Windows', () => {
    const args = ['exec', 'nx', 'run', 'api:build']
    assert.deepEqual(
      pnpmCommand(args, {
        env: { npm_execpath: '/x/pnpm.mjs' },
        execPath: '/n',
        platform: 'darwin',
      }),
      { args, command: 'pnpm', shell: false },
    )
  })

  it("on Windows runs pnpm's own script with this Node, or its pnpm.exe, without a shell", () => {
    const script = 'C:\\Users\\a b\\AppData\\Local\\node\\corepack\\pnpm\\11.18.0\\bin\\pnpm.mjs'
    for (const self of [script, script.replace('.mjs', '.cjs')]) {
      assert.deepEqual(pnpmCommand(['exec', 'prisma'], win(self)), {
        args: [self, 'exec', 'prisma'],
        command: node,
        shell: false,
      })
    }
    const exe = 'C:\\Users\\a\\.local\\pnpm-exe\\PNPM.EXE'
    assert.deepEqual(pnpmCommand(['exec', 'prisma'], win(exe)), {
      args: ['exec', 'prisma'],
      command: exe,
      shell: false,
    })
  })

  it('on Windows falls back to pnpm.cmd through cmd.exe, quoting arguments with spaces', () => {
    // npm sets npm_execpath to itself under `npm run`: that is not pnpm.
    for (const self of [undefined, 'C:\\nodejs\\node_modules\\npm\\bin\\npm-cli.js']) {
      assert.deepEqual(
        pnpmCommand(
          ['exec', 'prisma', 'generate', '--schema=C:\\Users\\First Last\\s.prisma'],
          win(self),
        ),
        {
          args: [],
          command: 'pnpm.cmd exec prisma generate "--schema=C:\\Users\\First Last\\s.prisma"',
          shell: true,
        },
      )
    }
  })
})
