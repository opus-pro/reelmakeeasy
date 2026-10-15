import fs from 'node:fs'
import path from 'node:path'

import { Logger } from '@reelmakeeasy/common/logger'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { LLM_NOT_SET_UP_MESSAGE } from '@reelmakeeasy/llm'
import {
  GENERATION_NOT_SET_UP_MESSAGE,
  setGenerationProvider as setLlmGenerationProvider,
  setGenerationUnavailable,
} from '@reelmakeeasy/llm/registry'
import { Injectable, type OnModuleDestroy, type OnModuleInit, Optional } from '@nestjs/common'
import type { AgentStatusResponse, HarnessStatus } from '@shared/types/api/agent'
import type {
  DictationSetting,
  GenerationProvider,
  LlmProvider,
  SetupStatus,
} from '@shared/types/api/setup'

import { defaultHarness } from '../agent/claude/claude-config'
import { getClaudeStatus } from '../agent/claude/claude-locator'
import { getCodexStatus } from '../agent/codex/codex-locator'

import {
  buildSetupStatus,
  generationTarget,
  generationUnavailableReason,
  isDictationSetting,
  isGenerationProvider,
  isLlmProvider,
  llmNotSetUpMessage,
  parseGenerationProvider,
  readKeys,
  type SetupStored,
} from './setup-status'

/** How often Codex and Claude Code are re-checked, so a sign-in or sign-out is noticed. */
const REFRESH_EVERY_MS = 60_000

/** An agent the probe couldn't check: not ready, so Gemini and your own endpoint still work. */
const PROBE_FAILED: HarnessStatus = {
  available: false,
  binary: null,
  loggedIn: false,
  reason: 'probe-failed',
  version: null,
}

/** What the service reads; tests replace all of it. */
export interface SetupSettingsDeps {
  env?: NodeJS.ProcessEnv
  /** Default: `<dataDir()>/settings.json`. */
  file?: string
  /** Replaces the Codex / Claude Code probe. */
  probe?: (options: { refresh?: boolean }) => Promise<AgentStatusResponse>
  warn?: (message: string) => void
}

/** Where the Setup choices are kept: `<dataDir()>/settings.json`. */
export function defaultSetupSettingsFile(): string {
  return path.join(dataDir(), 'settings.json')
}

/** Both agents' status, as `GET /api/agent/status` reports it; `refresh: true` bypasses the
 *  locators' 30 s cache. */
export async function probeHarnesses(
  options: { refresh?: boolean },
  env: NodeJS.ProcessEnv = process.env,
): Promise<AgentStatusResponse> {
  const [codex, claude] = await Promise.all([getCodexStatus(options), getClaudeStatus(options)])
  return { ...codex, claude, codex, defaultHarness: defaultHarness(env) }
}

/**
 * The Setup choices (which AI writes and plans, who generates) and what can be used now.
 * Choices are saved in `<dataDir()>/settings.json` (written atomically) and win over the `.env`
 * default (`LLM_PROVIDER`). `currentLlm()` is synchronous for the LLM resolver: it reads the
 * last status. `refresh()` probes the agents and rebuilds it at startup (before the API
 * listens), every minute, on `GET /api/setup/status?refresh=1` and in `PUT /api/setup/llm`'s
 * check. A plain `GET /api/setup/status` (`currentStatus()`) and a saved choice rebuild it from
 * the last probe, without running the CLIs.
 */
@Injectable()
export class SetupSettingsService implements OnModuleDestroy, OnModuleInit {
  private readonly env: NodeJS.ProcessEnv
  private readonly file: string
  /** The last agents' probe, reused when a saved choice rebuilds the status. */
  private harnesses: AgentStatusResponse | null = null
  /** The unreadable settings.json content last warned about, so each version warns once. */
  private lastBadSettings: null | string = null
  private readonly logger = new Logger(SetupSettingsService.name)
  private readonly probe: NonNullable<SetupSettingsDeps['probe']>
  private snapshot: null | SetupStatus = null
  private timer: NodeJS.Timeout | null = null
  private readonly warn: (message: string) => void

  constructor(@Optional() deps?: SetupSettingsDeps) {
    this.env = deps?.env ?? process.env
    this.file = deps?.file ?? defaultSetupSettingsFile()
    this.probe = deps?.probe ?? ((options) => probeHarnesses(options, this.env))
    this.warn = deps?.warn ?? ((message) => this.logger.warn(message))
    const fromEnv = this.env['LLM_PROVIDER']?.trim()
    if (fromEnv && !isLlmProvider(fromEnv.toLowerCase())) {
      this.warn(`Ignoring LLM_PROVIDER=${fromEnv}: use claude, codex, gemini or endpoint`)
    }
    const generationFromEnv = this.env['GENERATION_PROVIDER']?.trim()
    if (generationFromEnv && !parseGenerationProvider(generationFromEnv)) {
      this.warn(`Ignoring GENERATION_PROVIDER=${generationFromEnv}: use fal or google`)
    }
  }

  /** The generation provider in use, or null when none is ready. */
  currentGeneration(): GenerationProvider | null {
    return this.snapshot?.generation.effective ?? null
  }

  /** The AI LLM calls run on, or null when none is ready (or before the first refresh). */
  currentLlm(): LlmProvider | null {
    return this.snapshot?.llm.effective ?? null
  }

  /** What a plain `GET /api/setup/status` answers: the last agents' probe, with the keys and the
   *  choices read again, so loading the home page never waits on the Codex and Claude Code CLIs.
   *  Probes only when nothing has been probed yet (startup always probes first). */
  currentStatus(): Promise<SetupStatus> {
    return this.harnesses ? Promise.resolve(this.rebuild(this.harnesses)) : this.refresh()
  }

  /** What an LLM call fails with while `currentLlm()` is null. */
  llmNotSetUpMessage(): string {
    return this.snapshot ? llmNotSetUpMessage(this.snapshot.llm) : LLM_NOT_SET_UP_MESSAGE
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Checks once before the API listens, so the first LLM call already knows its AI. The probe
   *  runs two CLI commands per agent, one after the other: about 10 s at worst. */
  async onModuleInit(): Promise<void> {
    await this.refreshQuietly()
    this.timer = setInterval(() => {
      void this.refreshQuietly()
    }, REFRESH_EVERY_MS)
    this.timer.unref()
  }

  /** Re-probes Codex and Claude Code (`refresh: true` bypasses their 30 s cache), re-reads the
   *  keys and the choices, and updates what `currentLlm()` returns. */
  async refresh(options: { refresh?: boolean } = {}): Promise<SetupStatus> {
    this.harnesses = await this.probe(options)
    return this.rebuild(this.harnesses)
  }

  setGenerationProvider(provider: GenerationProvider): void {
    this.save({ generationProvider: provider })
  }

  setLlmProvider(provider: LlmProvider): void {
    this.save({ llmProvider: provider })
  }

  setDictation(setting: DictationSetting): void {
    this.save({ dictation: setting })
  }

  /** The saved choices, over the `.env` defaults (`LLM_PROVIDER`, `GENERATION_PROVIDER`). */
  stored(): SetupStored {
    const saved = this.readFile()
    const fromEnv = this.env['LLM_PROVIDER']?.trim().toLowerCase()
    const llmProvider = saved.llmProvider ?? (isLlmProvider(fromEnv) ? fromEnv : undefined)
    const generationProvider =
      saved.generationProvider ?? parseGenerationProvider(this.env['GENERATION_PROVIDER'])
    const fromEnvDictation = this.env['DICTATION']?.trim().toLowerCase()
    const dictation =
      saved.dictation ?? (isDictationSetting(fromEnvDictation) ? fromEnvDictation : undefined)
    return {
      ...(dictation ? { dictation } : {}),
      ...(generationProvider ? { generationProvider } : {}),
      ...(llmProvider ? { llmProvider } : {}),
    }
  }

  /** The choices in settings.json: none for a missing file, none with a warning (once per
   *  content) for an unreadable one; unknown values are dropped. */
  private readFile(): SetupStored {
    let raw: string
    try {
      raw = fs.readFileSync(this.file, 'utf8')
    } catch {
      return {}
    }
    try {
      const parsed: unknown = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not a JSON object')
      }
      const { dictation, generationProvider, llmProvider } = parsed as Record<string, unknown>
      return {
        ...(isDictationSetting(dictation) ? { dictation } : {}),
        ...(isGenerationProvider(generationProvider) ? { generationProvider } : {}),
        ...(isLlmProvider(llmProvider) ? { llmProvider } : {}),
      }
    } catch (error) {
      if (raw !== this.lastBadSettings) {
        this.lastBadSettings = raw
        this.warn(
          `Ignoring unreadable ${this.file} (${ensureError(error).message}); using the defaults`,
        )
      }
      return {}
    }
  }

  /** Rebuilds the status from this probe, the keys and the choices; logs when the AI in use
   *  changes. */
  private rebuild(harnesses: AgentStatusResponse): SetupStatus {
    const status = buildSetupStatus({ harnesses, keys: readKeys(this.env), stored: this.stored() })
    if (status.llm.effective !== this.snapshot?.llm.effective) {
      const label = status.llm.options.find((o) => o.id === status.llm.effective)?.label
      this.logger.log(
        label ? `Writing and planning run on ${label}` : llmNotSetUpMessage(status.llm),
      )
    }
    this.syncGeneration(status.generation)
    this.snapshot = status
    return status
  }

  /** A refresh for startup and the timer: a failure is logged, never thrown. Without an earlier
   *  probe to fall back on, both agents count as not ready, so Gemini and your own endpoint
   *  still work. */
  private async refreshQuietly(): Promise<void> {
    try {
      await this.refresh()
    } catch (error) {
      this.warn(`Couldn't check Codex and Claude Code: ${ensureError(error).message}`)
      this.harnesses ??= {
        ...PROBE_FAILED,
        claude: PROBE_FAILED,
        codex: PROBE_FAILED,
        defaultHarness: defaultHarness(this.env),
      }
      this.rebuild(this.harnesses)
    }
  }

  /** Writes the choices atomically (temp file, then rename), keeping the other one, and
   *  rebuilds the status so `currentLlm()` follows at once. */
  private save(patch: SetupStored): void {
    const next: SetupStored = { ...this.readFile(), ...patch }
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`)
    fs.renameSync(tmp, this.file)
    if (this.harnesses) this.rebuild(this.harnesses)
  }

  /**
   * Points libs/llm at the chosen generation provider and, when it can't run, at why: calls
   * then fail with that reason instead of moving to the other provider. Runs already started
   * keep the provider they started with (the workflow engine pins it).
   */
  private syncGeneration(generation: SetupStatus['generation']): void {
    const reason = generationUnavailableReason(generation)
    if (generation.effective !== this.snapshot?.generation.effective) {
      const label = generation.options.find((o) => o.id === generation.effective)?.label
      this.logger.log(
        label
          ? `Pictures, clips and voices run on ${label}`
          : `${GENERATION_NOT_SET_UP_MESSAGE}. ${reason}`,
      )
    }
    setLlmGenerationProvider(generationTarget(generation))
    setGenerationUnavailable(reason)
  }
}
