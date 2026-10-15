import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'

import { VIDEO_COST } from './reelmakeeasy-setup-ui.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (name) => fs.readFileSync(path.join(ROOT, name), 'utf8')

describe('.env.example', () => {
  it('lists every variable setup and doctor read, once, and says one video key is enough', () => {
    const example = read('.env.example')
    for (const name of [
      'FAL_KEY',
      'GEMINI_API_KEY',
      'ELEVENLABS_API_KEY',
      'LLM_PROVIDER',
      'GENERATION_PROVIDER',
      'LLM_BASE_URL',
      'PORT',
      'WEB_PORT',
      'HOST',
      'LOCAL_TTS',
      'LOCAL_ASR',
      'LOCAL_ASR_MODEL',
      'LOCAL_ALIGN_MODEL',
    ]) {
      const lines = example.match(new RegExp(`^#? ?${name}=`, 'gm')) ?? []
      assert.equal(lines.length, 1, `${name} should appear once in .env.example`)
    }
    assert.match(example, /Required: FAL_KEY or GEMINI_API_KEY/)
  })
})

describe('AGENTS.md', () => {
  it('says a server has no access control and listens on 127.0.0.1 unless HOST is set', () => {
    const agents = read('AGENTS.md')
    const server = agents.slice(
      agents.indexOf('## Running on a server'),
      agents.indexOf('## Common failures'),
    )
    assert.match(server, /no access control/)
    assert.match(server, /`127\.0\.0\.1` unless `HOST`/)
  })

  it('asks for a fal or Gemini key and an AI to write, and shows the new flags', () => {
    const agents = read('AGENTS.md')
    assert.match(agents, /`FAL_KEY` or `GEMINI_API_KEY`/)
    assert.match(agents, /--generation=fal\|google/)
    assert.match(agents, /--llm=claude\|codex\|gemini\|endpoint/)
    assert.doesNotMatch(agents, /Ask for these three keys/)
  })
})

/** The text of a numbered step (`5. **Start.**`) up to the next one. */
function step(markdown, title) {
  const start = markdown.indexOf(title)
  assert.notEqual(start, -1, `${title} should exist`)
  const next = markdown.slice(start + title.length).search(/^\d+\. \*\*/m)
  return next === -1 ? markdown.slice(start) : markdown.slice(start, start + title.length + next)
}

describe('starting ReelMakeEasy', () => {
  it('AGENTS.md starts it with `pnpm reelmakeeasy start`, keeping `pnpm dev` for changing the code', () => {
    const agents = read('AGENTS.md')
    const start = step(agents, '5. **Start.**')
    assert.match(start, /pnpm reelmakeeasy start/)
    assert.match(start, /pnpm dev[^\n]*changing the code|changing the code[^\n]*pnpm dev/)
    assert.match(step(agents, '7. **Start it**'), /Step 5/)
    for (const line of agents.split('\n').filter((l) => l.includes('pnpm dev'))) {
      assert.match(
        line,
        /changing the code/,
        `only "for changing the code" may use pnpm dev: ${line}`,
      )
    }
  })

  it('README quick start ends with `pnpm reelmakeeasy start`', () => {
    const readme = read('README.md')
    const quickStart = readme.slice(
      readme.indexOf('## Quick start'),
      readme.indexOf('## How it works'),
    )
    const commands = quickStart.match(/```bash\n([\s\S]*?)```/)?.[1] ?? ''
    assert.match(commands.trim().split('\n').at(-1), /^pnpm reelmakeeasy start /)
    assert.doesNotMatch(commands, /^pnpm dev/m)
  })
})

describe('setup questions in the docs', () => {
  it('README quotes the same video costs as the setup screen, and AGENTS.md the qwen choice', () => {
    const readme = read('README.md')
    assert.ok(readme.includes(`about ${VIDEO_COST.fal} for a 30-second video`))
    assert.ok(readme.includes(`Google Gemini (about ${VIDEO_COST.gemini}`))
    assert.match(read('AGENTS.md'), /--local-tts=qwen/)
  })
})

describe('local captions in the docs', () => {
  it('AGENTS.md shows --local-captions=off, says it is apart from the voices, and gives the sizes', () => {
    const agents = read('AGENTS.md')
    const configure = step(agents, '3. **Configure.**')
    assert.match(configure, /--local-captions=off/)
    assert.match(configure, /`--local-tts=off`/)
    assert.match(configure, /about 2 GB/)
    assert.match(configure, /0\.9 GB on a CPU/)
    assert.match(step(agents, '5. **Install and configure**'), /--local-captions=off/)
    assert.match(agents, /`Local captions`/)
  })

  it('README and .env.example say how to skip or turn off local captions', () => {
    const readme = read('README.md')
    assert.match(readme, /--local-captions=off/)
    assert.match(readme, /about 2 GB/)
    assert.match(readme, /`LOCAL_ASR`/)
    const example = read('.env.example')
    assert.match(example, /--local-captions=off/)
    assert.match(example, /^# LOCAL_ASR=off$/m)
  })
})

describe('the preset pack in the docs', () => {
  it('AGENTS.md gives the size presets/pack.json pins, rounded as setup shows it', () => {
    const { bytes } = JSON.parse(read('presets/pack.json'))
    const configure = step(read('AGENTS.md'), '3. **Configure.**')
    assert.match(
      configure,
      new RegExp(`preset pack \\([^)]*~${(bytes / 1024 / 1024).toFixed(0)} MB\\)`),
    )
  })

  it('presets/README.md and NOTICE list the camera samples the pack ships', () => {
    const readme = read('presets/README.md')
    const pack = readme.slice(readme.indexOf('## Preset pack'))
    assert.match(pack, /`camera-samples\/`/)
    const notice = read('NOTICE')
    const inPack = notice.slice(notice.indexOf('## In the preset pack'))
    assert.match(inPack.slice(0, inPack.indexOf('\n## ', 1)), /`camera-samples\//)
  })
})
