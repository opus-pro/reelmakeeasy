import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CLI = path.join(ROOT, 'scripts/reelmakeeasy.mjs')

describe('doctor --json', () => {
  it(
    'blocks on a video key and a writer, and only warns about single keys',
    { timeout: 120_000 },
    () => {
      const run = spawnSync(process.execPath, [CLI, 'doctor', '--json'], {
        cwd: ROOT,
        encoding: 'utf8',
        timeout: 120_000,
      })
      const report = JSON.parse(run.stdout)
      const byName = new Map(report.checks.map((c) => [c.name, c]))
      for (const name of ['Video key', 'Writing and planning']) {
        assert.equal(byName.get(name)?.blocking, true, `${name} should block`)
      }
      for (const name of [
        'FAL_KEY',
        'GEMINI_API_KEY',
        'ELEVENLABS_API_KEY',
        'Local voices',
        'Local captions',
      ]) {
        assert.equal(byName.get(name)?.blocking, false, `${name} should only warn`)
      }
      assert.equal(report.checks.filter((c) => c.name === 'Agent: Codex').length, 1)
      assert.equal(
        report.ok,
        report.checks.every((c) => c.ok || !c.blocking),
      )
    },
  )
})

describe('doctor output', () => {
  it('never prints the database password, or the home folder', { timeout: 120_000 }, () => {
    const run = spawnSync(process.execPath, [CLI, 'doctor', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
      // Empty values unset what .env holds, so doctor makes no network calls.
      env: {
        ...process.env,
        DATABASE_URL:
          'mongodb://reelmakeeasy-user:hunter2%40secret@127.0.0.1:9/reelmakeeasy?replicaSet=rs0',
        ELEVENLABS_API_KEY: '',
        GEMINI_API_KEY: '',
        LLM_BASE_URL: '',
      },
      timeout: 120_000,
    })
    assert.doesNotMatch(run.stdout, /hunter2|reelmakeeasy-user/)
    assert.ok(!run.stdout.includes(os.homedir()), 'home folder paths should print as ~')
    const mongo = JSON.parse(run.stdout).checks.find((c) => c.name === 'MongoDB')
    assert.match(mongo.detail, /mongodb:\/\/\*\*\*@127\.0\.0\.1:9\/reelmakeeasy/)
  })
})

describe('start and dev', () => {
  it('listen on 127.0.0.1 unless HOST opts in', () => {
    // Static: running them builds the app and starts MongoDB.
    const cli = fs.readFileSync(CLI, 'utf8')
    assert.match(cli, /return env\.HOST \|\| '127\.0\.0\.1'/)
    assert.match(cli, /'start', '--port', String\(webPort\), '--hostname', listenHost\(env\)/)
    assert.match(cli, /`--hostname=\$\{listenHost\(env\)\}`/)
    const api = fs.readFileSync(path.join(ROOT, 'apps/services/api/src/main.ts'), 'utf8')
    assert.match(api, /process\.env\.HOST \|\| '127\.0\.0\.1'/)
    assert.match(api, /app\.listen\(port, host\)/)
  })
})

describe('setup --llm, --generation, --local-tts and --local-captions', () => {
  it('refuses an unknown choice before touching .env', { timeout: 60_000 }, () => {
    const envFile = path.join(ROOT, '.env')
    const fingerprint = () =>
      fs.existsSync(envFile)
        ? createHash('sha256').update(fs.readFileSync(envFile)).digest('hex')
        : null
    const before = fingerprint()
    // An empty PATH stops a CLI that ignores these flags at `pnpm`, before it changes anything.
    const run = spawnSync(
      process.execPath,
      [
        CLI,
        'setup',
        '--yes',
        '--llm=gpt',
        '--generation=veo',
        '--local-tts=most',
        '--local-captions=maybe',
      ],
      { cwd: ROOT, encoding: 'utf8', env: { ...process.env, PATH: '' }, timeout: 60_000 },
    )
    assert.equal(run.status, 1)
    assert.match(run.stderr, /--generation must be fal or google/)
    assert.match(run.stderr, /--llm must be claude, codex, gemini or endpoint/)
    assert.match(run.stderr, /--local-tts must be all, kokoro, qwen or off/)
    assert.match(run.stderr, /--local-captions must be on or off/)
    assert.equal(fingerprint(), before)
  })
})

describe('<command> --help', () => {
  it(
    "prints that command's usage and exits 0 without running anything",
    { timeout: 60_000 },
    () => {
      const envFile = path.join(ROOT, '.env')
      const fingerprint = () =>
        fs.existsSync(envFile)
          ? createHash('sha256').update(fs.readFileSync(envFile)).digest('hex')
          : null
      const before = fingerprint()
      for (const command of ['setup', 'doctor', 'start', 'build', 'dev']) {
        for (const flag of ['--help', '-h']) {
          // An empty PATH stops a command that runs anyway at its first tool (pnpm, ffmpeg).
          const run = spawnSync(process.execPath, [CLI, command, '--yes', flag], {
            cwd: ROOT,
            encoding: 'utf8',
            env: { ...process.env, PATH: '' },
            timeout: 20_000,
          })
          assert.equal(run.status, 0, `${command} ${flag} exited ${run.status}: ${run.stderr}`)
          assert.match(run.stdout, new RegExp(`^Usage: pnpm reelmakeeasy ${command}\\b`))
          assert.equal(run.stderr, '')
        }
      }
      assert.equal(fingerprint(), before)
    },
  )
})
