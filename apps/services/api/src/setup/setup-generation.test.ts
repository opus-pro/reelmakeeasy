import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  currentGenerationProvider,
  generationNotReadyMessage,
  generationProviderReady,
  resetGenerationProviderForTesting,
} from '@reelmakeeasy/llm/registry'
import { BadRequestException, ConflictException } from '@nestjs/common'
import type { AgentStatusResponse, HarnessStatus } from '@shared/types/api/agent'
import type { SetupKeys, SetupStatus } from '@shared/types/api/setup'

import { SetupController } from './setup.controller'
import { SetupSettingsService } from './setup-settings.service'
import {
  effectiveGeneration,
  generationOptions,
  generationUnavailableReason,
  parseGenerationProvider,
} from './setup-status'

const MISSING: HarnessStatus = {
  available: false,
  binary: null,
  loggedIn: false,
  reason: 'not-found',
  version: null,
}
const NO_AGENTS: AgentStatusResponse = {
  ...MISSING,
  claude: MISSING,
  codex: MISSING,
  defaultHarness: 'codex',
}
/** Distinctive placeholders, so a leak into the status would show up. */
const FAL = 'fal-PLACEHOLDER-8731'
const GEMINI = 'gemini-PLACEHOLDER-4402'

const keys = (set: Partial<SetupKeys>): SetupKeys => ({
  elevenlabs: false,
  endpoint: false,
  fal: false,
  gemini: false,
  ...set,
})
const settingsFile = () =>
  path.join(mkdtempSync(path.join(os.tmpdir(), 'setup-gen-')), 'settings.json')

/** The service over a fake agents' probe; nothing touches the real data folder. */
function service(env: NodeJS.ProcessEnv, file = settingsFile()) {
  return new SetupSettingsService({ env, file, probe: async () => NO_AGENTS, warn: jest.fn() })
}

afterEach(() => resetGenerationProviderForTesting())

describe('generation options', () => {
  it('need FAL_KEY for fal and GEMINI_API_KEY for Gemini', () => {
    expect(generationOptions(keys({ gemini: true }))).toEqual([
      { available: false, id: 'fal', label: 'fal', reason: 'Add FAL_KEY to .env, then restart' },
      { available: true, id: 'google', label: 'Gemini' },
    ])
  })

  it('keep an available stored choice, report an unavailable one, else take fal then Gemini', () => {
    const both = generationOptions(keys({ fal: true, gemini: true }))
    const geminiOnly = generationOptions(keys({ gemini: true }))
    expect(effectiveGeneration('google', both)).toBe('google')
    expect(effectiveGeneration('fal', geminiOnly)).toBeNull()
    expect(effectiveGeneration(undefined, both)).toBe('fal')
    expect(effectiveGeneration(undefined, geminiOnly)).toBe('google')
    expect(effectiveGeneration(undefined, generationOptions(keys({})))).toBeNull()
  })

  it('say why generation cannot run', () => {
    const geminiOnly = generationOptions(keys({ gemini: true }))
    expect(
      generationUnavailableReason({ effective: null, options: geminiOnly, provider: 'fal' }),
    ).toBe(
      'fal is chosen in Setup but FAL_KEY is missing: add it to .env and restart, or pick Gemini',
    )
    expect(
      generationUnavailableReason({
        effective: null,
        options: generationOptions(keys({})),
        provider: null,
      }),
    ).toBe('Add FAL_KEY or GEMINI_API_KEY to .env, then restart')
    expect(
      generationUnavailableReason({ effective: 'google', options: geminiOnly, provider: null }),
    ).toBeNull()
  })

  it('read GENERATION_PROVIDER, taking gemini as google', () => {
    expect(parseGenerationProvider(' Gemini ')).toBe('google')
    expect(parseGenerationProvider('google')).toBe('google')
    expect(parseGenerationProvider('fal')).toBe('fal')
    expect(parseGenerationProvider('replicate')).toBeUndefined()
  })
})

describe('SetupSettingsService generation', () => {
  it('defaults from GENERATION_PROVIDER and switches libs/llm', async () => {
    const settings = service({
      FAL_KEY: FAL,
      GEMINI_API_KEY: GEMINI,
      GENERATION_PROVIDER: 'gemini',
    })
    await settings.refresh()
    expect(settings.currentGeneration()).toBe('google')
    expect(currentGenerationProvider()).toBe('google')
    expect(generationProviderReady()).toBe(true)
  })

  it('stores a choice in settings.json and switches at once', async () => {
    const file = settingsFile()
    const settings = service({ FAL_KEY: FAL, GEMINI_API_KEY: GEMINI }, file)
    await settings.refresh()
    expect(currentGenerationProvider()).toBe('fal')
    settings.setGenerationProvider('google')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ generationProvider: 'google' })
    expect(settings.currentGeneration()).toBe('google')
    expect(currentGenerationProvider()).toBe('google')
  })

  it('keeps a stored provider whose key is gone, says why, and never swaps', async () => {
    const file = settingsFile()
    writeFileSync(file, JSON.stringify({ generationProvider: 'fal' }))
    const status = await service({ GEMINI_API_KEY: GEMINI }, file).refresh()
    expect(status.generation).toMatchObject({ effective: null, provider: 'fal' })
    expect(currentGenerationProvider()).toBe('fal')
    expect(generationProviderReady()).toBe(false)
    expect(generationNotReadyMessage()).toMatch(
      /fal is chosen in Setup but FAL_KEY is missing: add it to \.env and restart, or pick Gemini/,
    )
  })

  it('never puts key values in the status', async () => {
    const status = await service({ FAL_KEY: FAL, GEMINI_API_KEY: GEMINI }).refresh()
    const json = JSON.stringify(status)
    expect(json).not.toContain(FAL)
    expect(json).not.toContain(GEMINI)
    expect(status.keys).toMatchObject({ fal: true, gemini: true })
  })
})

describe('PUT /api/setup/generation', () => {
  const STATUS = {
    generation: {
      effective: 'google',
      options: generationOptions(keys({ gemini: true })),
      provider: null,
    },
  } as unknown as SetupStatus

  /** Only the keys matter here, so the controller reads the last probe (`currentStatus()`) and
   *  never re-probes Codex and Claude Code (`refresh()`). */
  function setup() {
    const settings = {
      currentStatus: jest.fn(async () => STATUS),
      refresh: jest.fn(async () => STATUS),
      setGenerationProvider: jest.fn(),
    }
    return {
      controller: new SetupController(settings as unknown as SetupSettingsService),
      settings,
    }
  }

  it('saves an available provider and returns the new status, without probing the agents', async () => {
    const { controller, settings } = setup()
    await expect(controller.setGeneration({ provider: 'google' })).resolves.toBe(STATUS)
    expect(settings.setGenerationProvider).toHaveBeenCalledWith('google')
    expect(settings.currentStatus).toHaveBeenCalledTimes(2)
    expect(settings.refresh).not.toHaveBeenCalled()
  })

  it('answers 400 for an unknown id and 409, with the reason, for one without its key', async () => {
    const { controller, settings } = setup()
    await expect(controller.setGeneration({ provider: 'replicate' })).rejects.toBeInstanceOf(
      BadRequestException,
    )
    const missingKey = controller.setGeneration({ provider: 'fal' })
    await expect(missingKey).rejects.toBeInstanceOf(ConflictException)
    await expect(missingKey).rejects.toThrow("fal can't be used: Add FAL_KEY to .env, then restart")
    expect(settings.setGenerationProvider).not.toHaveBeenCalled()
    expect(settings.refresh).not.toHaveBeenCalled()
  })
})
