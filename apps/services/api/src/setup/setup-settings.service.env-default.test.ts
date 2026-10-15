import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { SetupSettingsService } from './setup-settings.service'

const mockNotFound = {
  available: false,
  binary: null,
  loggedIn: false,
  reason: 'not-found',
  version: null,
}
jest.mock('../agent/codex/codex-locator', () => ({
  ...jest.requireActual('../agent/codex/codex-locator'),
  getCodexStatus: async () => mockNotFound,
}))
jest.mock('../agent/claude/claude-locator', () => ({
  ...jest.requireActual('../agent/claude/claude-locator'),
  getClaudeStatus: async () => mockNotFound,
}))

const BOTH_KEYS = { FAL_KEY: 'k', GEMINI_API_KEY: 'k' }

describe('SetupSettingsService and the .env defaults', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ly-setup-'))
  })
  afterEach(() => fs.rmSync(dir, { force: true, recursive: true }))

  it('reports GENERATION_PROVIDER as the pick while nothing is saved', async () => {
    const setup = new SetupSettingsService({
      env: { ...BOTH_KEYS, GENERATION_PROVIDER: 'google' },
      file: path.join(dir, 'settings.json'),
    })
    expect((await setup.refresh()).generation).toMatchObject({
      effective: 'google',
      provider: 'google',
    })
  })

  it('lets a choice saved in Setup win over it', async () => {
    const setup = new SetupSettingsService({
      env: { ...BOTH_KEYS, GENERATION_PROVIDER: 'google' },
      file: path.join(dir, 'settings.json'),
    })
    setup.setGenerationProvider('fal')
    expect((await setup.refresh()).generation).toMatchObject({ effective: 'fal', provider: 'fal' })
  })
})
