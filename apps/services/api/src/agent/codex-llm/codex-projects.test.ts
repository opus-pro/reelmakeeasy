import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { JobContext } from '@reelmakeeasy/common/job-context'
import { type ChatTransport, LLM_NOT_SET_UP_MESSAGE, LlmNotSetUpError } from '@reelmakeeasy/llm'
import { activityStorage, workflowStorage } from '@reelmakeeasy/workflow-engine/engine'
import type { LlmProvider } from '@shared/types/api/setup'

import {
  AgentProjects,
  currentLlmProjectId,
  makeChatEndpointPreference,
  makeLlmResolver,
} from './codex-projects'

const tmpFile = () =>
  path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'codex-projects-')),
    'agent',
    'codex-projects.json',
  )

const inActivity = <T>(workflowId: string, fn: () => T): T =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- only `info.workflowExecution` is read
  activityStorage.run({ info: { workflowExecution: { workflowId } } } as any, fn)

const inWorkflow = <T>(workflowId: string, fn: () => T): T =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- only `execution.workflowId` is read
  workflowStorage.run({ execution: { workflowId } } as any, fn)

describe('AgentProjects', () => {
  it('adds and checks project ids, persisted across instances', () => {
    const file = tmpFile()
    const projects = new AgentProjects(file)
    expect(projects.has('p1')).toBe(false)
    projects.add('p1')
    expect(projects.has('p1')).toBe(true)
    projects.add('p1') // already there: no duplicate
    expect(new AgentProjects(file).has('p1')).toBe(true)
    expect(new AgentProjects(file).has('p2')).toBe(false)
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ p1: 'codex' })
  })

  it('starts empty when the file is missing', () => {
    expect(new AgentProjects(tmpFile()).has('p1')).toBe(false)
  })

  it('starts empty, with a warning, when the file is corrupt', () => {
    const warn = jest.fn()
    const file = tmpFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, '{not json')
    const projects = new AgentProjects(file, { warn })
    expect(projects.has('p1')).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('codex-projects.json'))
    projects.add('p1')
    expect(new AgentProjects(file).has('p1')).toBe(true)
  })
})

describe('currentLlmProjectId', () => {
  it('returns the JobContext project id', () => {
    expect(JobContext.run({ projectId: 'p1' }, () => currentLlmProjectId())).toBe('p1')
  })

  it('prefers JobContext over the activity workflow id', () => {
    expect(
      inActivity('ao:p2:story-mode:long-take', () =>
        JobContext.run({ projectId: 'p1' }, () => currentLlmProjectId()),
      ),
    ).toBe('p1')
  })

  it("parses the project id from the running activity's workflow id", () => {
    expect(inActivity('ao:p2:story-mode:long-take', () => currentLlmProjectId())).toBe('p2')
    expect(
      inActivity('ao:p3:agent', () => JobContext.run({ userId: 'u' }, () => currentLlmProjectId())),
    ).toBe('p3')
  })

  it("falls back to the running workflow body's id, after JobContext and the activity", () => {
    expect(inWorkflow('ao:p4:story-mode:long-take', () => currentLlmProjectId())).toBe('p4')
    expect(
      inWorkflow('ao:p4:story-mode:long-take', () =>
        inActivity('ao:p2:story-mode:long-take', () => currentLlmProjectId()),
      ),
    ).toBe('p2')
    expect(
      inWorkflow('ao:p4:story-mode:long-take', () =>
        JobContext.run({ projectId: 'p1' }, () => currentLlmProjectId()),
      ),
    ).toBe('p1')
    expect(inWorkflow('ao:system', () => currentLlmProjectId())).toBeNull()
  })

  it('ignores workflow ids that are not project-scoped', () => {
    expect(inActivity('ao:system', () => currentLlmProjectId())).toBeNull()
    expect(inActivity('other:p2:x', () => currentLlmProjectId())).toBeNull()
    expect(inActivity('ao::x', () => currentLlmProjectId())).toBeNull()
  })

  it('returns null outside both', () => {
    expect(currentLlmProjectId()).toBeNull()
  })
})

describe('makeLlmResolver: agent projects', () => {
  const transport: ChatTransport = { name: 'codex', send: jest.fn() }
  const claude: ChatTransport = { name: 'claude', send: jest.fn() }
  const transports = { claude, codex: transport }

  it("returns the Codex transport only for a registered project's calls", () => {
    const projects = new AgentProjects(tmpFile())
    projects.add('agent-project')
    const resolve = makeLlmResolver({ currentLlm: () => 'gemini', projects, transports })
    expect(JobContext.run({ projectId: 'agent-project' }, resolve)).toBe(transport)
    expect(inActivity('ao:agent-project:story-mode:long-take', resolve)).toBe(transport)
    expect(JobContext.run({ projectId: 'normal-project' }, resolve)).toBeNull()
    expect(resolve()).toBeNull()
  })

  it('sees a project registered after the resolver was made', () => {
    const projects = new AgentProjects(tmpFile())
    const resolve = makeLlmResolver({ currentLlm: () => 'gemini', projects, transports })
    expect(JobContext.run({ projectId: 'later' }, resolve)).toBeNull()
    projects.add('later')
    expect(JobContext.run({ projectId: 'later' }, resolve)).toBe(transport)
  })
})

describe('AgentProjects harness', () => {
  it('reads an old list of ids as Codex projects, and keeps the harness of new ones', () => {
    const file = tmpFile()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(['p1']))
    const projects = new AgentProjects(file)
    expect(projects.harnessOf('p1')).toBe('codex')
    projects.add('p2', 'claude')
    const reread = new AgentProjects(file)
    expect(reread.harnessOf('p2')).toBe('claude')
    expect(reread.harnessOf('p1')).toBe('codex')
    expect(reread.harnessOf('p3')).toBeNull()
    expect(reread.all().sort()).toEqual(['p1', 'p2'])
  })

  it("routes a project's calls to its harness's transport", () => {
    const codex: ChatTransport = { name: 'codex', send: jest.fn() }
    const claude: ChatTransport = { name: 'claude', send: jest.fn() }
    const projects = new AgentProjects(tmpFile())
    projects.add('c1', 'codex')
    projects.add('k1', 'claude')
    const resolve = makeLlmResolver({
      currentLlm: () => 'gemini',
      projects,
      transports: { claude, codex },
    })
    expect(JobContext.run({ projectId: 'k1' }, resolve)).toBe(claude)
    expect(JobContext.run({ projectId: 'c1' }, resolve)).toBe(codex)
    expect(JobContext.run({ projectId: 'other' }, resolve)).toBeNull()
  })
})

describe('makeLlmResolver: order', () => {
  const codex: ChatTransport = { name: 'codex', send: jest.fn() }
  const claude: ChatTransport = { name: 'claude', send: jest.fn() }
  const transports = { claude, codex }

  /** A resolver whose app-wide AI is `current`, with `claude-project` made in a Claude chat. */
  function resolverWith(current: LlmProvider | null, notSetUpMessage?: () => string) {
    const projects = new AgentProjects(tmpFile())
    projects.add('claude-project', 'claude')
    return makeLlmResolver({ currentLlm: () => current, notSetUpMessage, projects, transports })
  }

  it('sends a pinned call where it is pinned, ahead of the agent project and the app-wide AI', () => {
    const resolve = resolverWith('codex')
    expect(
      JobContext.run({ llmProvider: 'gemini', projectId: 'claude-project' }, resolve),
    ).toBeNull()
    expect(JobContext.run({ llmProvider: 'endpoint' }, resolve)).toBeNull()
    expect(JobContext.run({ llmProvider: 'claude' }, resolve)).toBe(claude)
    expect(JobContext.run({ llmProvider: 'codex', projectId: 'claude-project' }, resolve)).toBe(
      codex,
    )
  })

  it("sends an agent project's call to its chat's harness, whatever AI is chosen", () => {
    for (const current of ['codex', 'gemini', null] as const) {
      expect(JobContext.run({ projectId: 'claude-project' }, resolverWith(current))).toBe(claude)
    }
  })

  it('sends every other call to the AI chosen in Setup', () => {
    expect(resolverWith('codex')()).toBe(codex)
    expect(resolverWith('claude')()).toBe(claude)
    expect(JobContext.run({ projectId: 'normal-project' }, resolverWith('claude'))).toBe(claude)
    expect(resolverWith('gemini')()).toBeNull()
    expect(resolverWith('endpoint')()).toBeNull()
  })

  it('fails a call with LlmNotSetUpError when no AI is ready', async () => {
    const transport = resolverWith(null)()
    expect(transport?.name).toBe('not-set-up')
    const sent = transport!.send({ messages: [], model: 'not-set-up' }, 1000)
    await expect(sent).rejects.toBeInstanceOf(LlmNotSetUpError)
    await expect(sent).rejects.toThrow(LLM_NOT_SET_UP_MESSAGE)
  })

  it("fails with the chosen AI's reason when it isn't ready", async () => {
    const reason = "Claude Code can't write and plan right now (Not installed): open Setup"
    const transport = resolverWith(null, () => reason)()
    await expect(transport!.send({ messages: [], model: 'not-set-up' }, 1000)).rejects.toThrow(
      reason,
    )
  })
})

describe('makeChatEndpointPreference', () => {
  it('prefers Gemini for a call pinned to it, else follows the AI chosen in Setup', () => {
    expect(makeChatEndpointPreference(() => 'endpoint')()).toBe('endpoint')
    expect(makeChatEndpointPreference(() => 'gemini')()).toBe('gemini')
    expect(
      JobContext.run(
        { llmProvider: 'gemini' },
        makeChatEndpointPreference(() => 'endpoint'),
      ),
    ).toBe('gemini')
    expect(makeChatEndpointPreference(() => 'codex')()).toBeNull()
    expect(makeChatEndpointPreference(() => null)()).toBeNull()
  })
})
