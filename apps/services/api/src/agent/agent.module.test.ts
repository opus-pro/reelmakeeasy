import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { JobContext } from '@reelmakeeasy/common/job-context'
import {
  type ChatTransportResolver,
  setChatEndpointPreference,
  setChatTransportResolver,
  setCurrentLlmProvider,
} from '@reelmakeeasy/llm'
import type { LlmProvider } from '@shared/types/api/setup'

import type { SetupSettingsService } from '../setup/setup-settings.service'

import type { ClaudeLlmService } from './claude/claude-llm.service'
import type { CodexLlmService } from './codex-llm/codex-llm.service'
import { AgentProjects } from './codex-llm/codex-projects'
import { AgentModule } from './agent.module'

jest.mock('@reelmakeeasy/llm', () => ({
  LlmNotSetUpError: class LlmNotSetUpError extends Error {},
  setChatEndpointPreference: jest.fn(),
  setChatTransportResolver: jest.fn(),
  setCurrentLlmProvider: jest.fn(),
}))

/** `fillAgentFields: jest.fn().mockResolvedValue(0)`, for tests that don't care about the fill. */
const NO_FILL = { fillAgentFields: jest.fn().mockResolvedValue(0) } as never
/** `listSessions: () => []`, for tests that don't care about the fill. */
const NO_SESSIONS = { listSessions: () => [] } as never

/** A settings service whose AI in use is `llm`. */
function setupWith(llm: LlmProvider | null): SetupSettingsService {
  return {
    currentLlm: () => llm,
    llmNotSetUpMessage: () => 'No AI is set up',
  } as unknown as SetupSettingsService
}

/** The module, with `agent-project` made in a Codex chat and `claude-project` in a Claude one. */
function moduleWith(llm: LlmProvider | null) {
  const codex = { name: 'codex', send: jest.fn() }
  const claude = { name: 'claude', send: jest.fn() }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-module-'))
  const projects = new AgentProjects(path.join(dir, 'codex-projects.json'))
  projects.add('agent-project')
  projects.add('claude-project', 'claude')
  const mod = new AgentModule(
    { transport: codex } as unknown as CodexLlmService,
    { transport: claude } as unknown as ClaudeLlmService,
    projects,
    NO_SESSIONS,
    NO_FILL,
    setupWith(llm),
  )
  return { claude, codex, mod }
}

/** What the last `onModuleInit` registered with libs/llm. */
function registered() {
  return {
    current: jest.mocked(setCurrentLlmProvider).mock.calls.at(-1)![0] as () => unknown,
    preference: jest.mocked(setChatEndpointPreference).mock.calls.at(-1)![0] as () => unknown,
    resolver: jest.mocked(setChatTransportResolver).mock.calls.at(-1)![0] as ChatTransportResolver,
  }
}

describe('AgentModule', () => {
  it('registers the LLM routing on init and clears it on destroy', () => {
    const { claude, codex, mod } = moduleWith('gemini')
    mod.onModuleInit()
    const { current, preference, resolver } = registered()
    expect(JobContext.run({ projectId: 'agent-project' }, resolver)).toBe(codex)
    expect(JobContext.run({ projectId: 'claude-project' }, resolver)).toBe(claude)
    expect(JobContext.run({ projectId: 'other' }, resolver)).toBeNull()
    expect(preference()).toBe('gemini')
    expect(current()).toBe('gemini')

    mod.onModuleDestroy()
    expect(setChatTransportResolver).toHaveBeenLastCalledWith(null)
    expect(setChatEndpointPreference).toHaveBeenLastCalledWith(null)
    expect(setCurrentLlmProvider).toHaveBeenLastCalledWith(null)
  })

  it('sends every other call to the AI chosen in Setup', () => {
    const { claude, mod } = moduleWith('claude')
    mod.onModuleInit()
    const { current, preference, resolver } = registered()
    expect(JobContext.run({ projectId: 'other' }, resolver)).toBe(claude)
    expect(resolver()).toBe(claude)
    expect(preference()).toBeNull()
    expect(current()).toBe('claude')
  })

  it('fails calls when no AI is set up', async () => {
    const { mod } = moduleWith(null)
    mod.onModuleInit()
    const transport = registered().resolver()
    expect(transport?.name).toBe('not-set-up')
    await expect(transport!.send({ messages: [], model: 'x' }, 1000)).rejects.toThrow(
      'No AI is set up',
    )
  })

  it('fills agent project fields at startup without blocking it, and survives a failure', async () => {
    const fillAgentFields = jest.fn().mockRejectedValue(new Error('db down'))
    const mod = new AgentModule(
      {} as never,
      {} as never,
      { all: () => ['p1'] } as never,
      { listSessions: () => [{ id: 's1', projectId: 'p1' }] } as never,
      { fillAgentFields } as never,
      {} as never,
    )
    expect(() => mod.onModuleInit()).not.toThrow()
    await new Promise((r) => setImmediate(r))
    expect(fillAgentFields).toHaveBeenCalledWith({
      agentProjectIds: ['p1'],
      sessionByProject: new Map([['p1', 's1']]),
    })
  })
})
