import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { BadRequestException, ConflictException } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import type { HarnessStatus } from '@shared/types/api/agent'
import type { SetupStatus } from '@shared/types/api/setup'

import { LoopbackOnlyGuard } from '../agent/loopback-only.guard'

import { SetupController } from './setup.controller'
import { SetupSettingsService } from './setup-settings.service'

const READY: HarnessStatus = { available: true, binary: '/bin/codex', loggedIn: true, version: '1' }
const MISSING: HarnessStatus = {
  available: false,
  binary: null,
  loggedIn: false,
  reason: 'not-found',
  version: null,
}

const STATUS: SetupStatus = {
  generation: {
    effective: 'fal',
    options: [{ available: true, id: 'fal', label: 'fal' }],
    provider: null,
  },
  harnesses: { ...READY, claude: MISSING, codex: READY, defaultHarness: 'codex' },
  keys: { elevenlabs: false, endpoint: false, fal: true, gemini: false },
  llm: {
    effective: 'codex',
    options: [
      { available: false, id: 'claude', label: 'Claude Code', reason: 'Not installed' },
      { available: true, id: 'codex', label: 'Codex' },
      {
        available: false,
        id: 'gemini',
        label: 'Gemini',
        reason: 'Add GEMINI_API_KEY to .env, then restart',
      },
      {
        available: false,
        id: 'endpoint',
        label: 'Your own endpoint',
        reason: 'Set LLM_BASE_URL in .env, then restart',
      },
    ],
    provider: null,
  },
}

/** The controller over a fake settings service that always reports STATUS. */
function setup() {
  const settings = {
    currentStatus: jest.fn(async () => STATUS),
    refresh: jest.fn(async () => STATUS),
    setLlmProvider: jest.fn(),
  }
  const controller = new SetupController(settings as unknown as SetupSettingsService)
  return { controller, settings }
}

/** The controller over the real settings service, with a fake agents' probe (Codex ready, Claude
 *  Code not installed) and settings.json in a fresh temp folder. */
function withProbe() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-controller-'))
  const file = path.join(dir, 'settings.json')
  const probe = jest.fn(async () => STATUS.harnesses)
  const settings = new SetupSettingsService({ env: {}, file, probe, warn: jest.fn() })
  return { controller: new SetupController(settings), file, probe, settings }
}

describe('SetupController', () => {
  it('only answers requests from this computer', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, SetupController)).toEqual([LoopbackOnlyGuard])
  })

  it('answers a plain GET from the last probe, without re-checking the agents', async () => {
    const { controller, file, probe, settings } = withProbe()
    await settings.refresh()
    expect(probe).toHaveBeenCalledTimes(1)
    fs.writeFileSync(file, JSON.stringify({ llmProvider: 'claude' }))
    const status = await controller.status()
    expect(probe).toHaveBeenCalledTimes(1)
    // The choice saved since the probe is read again. Claude Code isn't installed, so the
    // choice is reported, not swapped.
    expect(status.llm).toMatchObject({ effective: null, provider: 'claude' })
  })

  it('re-checks the agents for refresh=1, bypassing their cache', async () => {
    const { controller, probe, settings } = withProbe()
    await settings.refresh()
    await expect(controller.status('1')).resolves.toMatchObject({ llm: { effective: 'codex' } })
    expect(probe).toHaveBeenCalledTimes(2)
    expect(probe).toHaveBeenLastCalledWith({ refresh: true })
  })

  it('re-checks the agents live once, then saves a ready AI and returns the new status', async () => {
    const { controller, settings } = setup()
    await expect(controller.setLlm({ provider: 'codex' })).resolves.toBe(STATUS)
    expect(settings.refresh).toHaveBeenCalledTimes(1)
    expect(settings.refresh).toHaveBeenCalledWith({ refresh: true })
    expect(settings.setLlmProvider).toHaveBeenCalledWith('codex')
    expect(settings.currentStatus).toHaveBeenCalledTimes(1)
  })

  it('refuses an unknown AI with 400', async () => {
    const { controller, settings } = setup()
    await expect(controller.setLlm({ provider: 'gpt' })).rejects.toBeInstanceOf(BadRequestException)
    await expect(controller.setLlm(undefined)).rejects.toBeInstanceOf(BadRequestException)
    expect(settings.refresh).not.toHaveBeenCalled()
    expect(settings.setLlmProvider).not.toHaveBeenCalled()
  })

  it("refuses an AI that isn't ready with 409, and says why", async () => {
    const { controller, settings } = setup()
    const call = controller.setLlm({ provider: 'claude' })
    await expect(call).rejects.toBeInstanceOf(ConflictException)
    await expect(call).rejects.toThrow("Claude Code isn't ready: Not installed")
    expect(settings.refresh).toHaveBeenLastCalledWith({ refresh: true })
    expect(settings.setLlmProvider).not.toHaveBeenCalled()
  })
})
