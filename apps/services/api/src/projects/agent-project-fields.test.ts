import { agentProjectFields, fillAgentFields, unsetOrNull } from './agent-project-fields'
import { ProjectController } from './projects.controller'

describe('agentProjectFields', () => {
  it('marks the project as agent-made and links its chat', () => {
    expect(agentProjectFields('s1')).toEqual({ agentSessionId: 's1', createdVia: 'agent' })
  })
  it('adds nothing without a chat', () => {
    expect(agentProjectFields(undefined)).toEqual({})
  })
})

describe('unsetOrNull', () => {
  it('matches a missing field as well as an explicit null', () => {
    expect(unsetOrNull('createdVia')).toEqual({
      OR: [{ createdVia: null }, { createdVia: { isSet: false } }],
    })
  })
})

describe('fillAgentFields', () => {
  it('only writes fields that are not set, and counts the rows it changed', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 })
    const changed = await fillAgentFields({ project: { updateMany } } as never, {
      agentProjectIds: ['p1', 'p2'],
      sessionByProject: new Map([['p1', 's1']]),
    })
    expect(updateMany).toHaveBeenCalledWith({
      data: { createdVia: 'agent' },
      where: { AND: [{ id: { in: ['p1', 'p2'] } }, unsetOrNull('createdVia')] },
    })
    expect(updateMany).toHaveBeenCalledWith({
      data: { agentSessionId: 's1' },
      where: { AND: [{ id: 'p1' }, unsetOrNull('agentSessionId')] },
    })
    expect(changed).toBe(2)
  })

  it('does nothing when there is nothing to fill', async () => {
    const updateMany = jest.fn()
    expect(
      await fillAgentFields({ project: { updateMany } } as never, {
        agentProjectIds: [],
        sessionByProject: new Map(),
      }),
    ).toBe(0)
    expect(updateMany).not.toHaveBeenCalled()
  })
})

describe('POST /api/project', () => {
  it('passes only the body to createProject, so a body cannot set the agent fields', async () => {
    const createProject = jest.fn().mockResolvedValue({ id: 'p1' })
    const controller = new ProjectController({ createProject } as never, {} as never, {} as never)
    await controller.createProject({
      agentSessionId: 's1',
      createdVia: 'agent',
      isLongTake: true,
    } as never)
    expect(createProject).toHaveBeenCalledTimes(1)
    expect(createProject.mock.calls[0]).toHaveLength(1)
  })
})
