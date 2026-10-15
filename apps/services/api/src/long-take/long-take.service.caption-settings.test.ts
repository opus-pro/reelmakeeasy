const start = jest.fn(async () => undefined)
jest.mock('@reelmakeeasy/common/workflow/client', () => ({
  createClient: async () => ({ workflow: { start } }),
}))

import { BadRequestException, UnauthorizedException } from '@nestjs/common'

import { LongTakeService } from './long-take.service'

const USER = { email: 'you@reelmakeeasy.local', orgId: 'o', sub: 'u', userId: 'u' }
const STATUS_CACHE_KEY = 'long-take:status-cache:p1'

function makeService(project: null | Record<string, unknown>, { canVisit = true } = {}) {
  const projectsService = {
    canVisitProject: jest.fn(async () => canVisit),
    getProject: jest.fn(async () => project),
    internalUpdateProject: jest.fn(async () => undefined),
  }
  const kv = { del: jest.fn(async () => undefined) }
  const svc = new LongTakeService(
    projectsService as never,
    {} as never,
    kv as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { kv, projectsService, svc }
}

describe('updateCaptionSettings', () => {
  beforeEach(() => start.mockClear())

  it('saves the caption look on the project and drops the cached status', async () => {
    const { kv, projectsService, svc } = makeService({ captionStyle: null, id: 'p1' })
    const r = await svc.updateCaptionSettings(
      'p1',
      { accent: '#ffe500', position: 66, preset: 'punch', size: 120 },
      USER as never,
    )
    const captionStyle = { accent: '#FFE500', position: 66, preset: 'punch', size: 120 }
    expect(r).toEqual({ captionStyle })
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith('p1', { captionStyle }, 'u')
    expect(kv.del).toHaveBeenCalledWith(STATUS_CACHE_KEY)
  })

  it('changes only the fields sent, and null puts one back to its default', async () => {
    const { projectsService, svc } = makeService({
      captionStyle: { accent: '#FF3EA5', position: 40, preset: 'explainer', size: 90 },
      id: 'p1',
    })
    const r = await svc.updateCaptionSettings('p1', { position: null, size: 140 }, USER as never)
    const captionStyle = { accent: '#FF3EA5', position: null, preset: 'explainer', size: 140 }
    expect(r).toEqual({ captionStyle })
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith('p1', { captionStyle }, 'u')
  })

  it('clamps the height and size into range', async () => {
    const { svc } = makeService({ id: 'p1' })
    const r = await svc.updateCaptionSettings('p1', { position: 0, size: 900 }, USER as never)
    expect(r.captionStyle).toEqual({ position: 10, size: 160 })
  })

  it('drops a malformed saved field rather than keeping it', async () => {
    const { svc } = makeService({ captionStyle: { accent: 'green', preset: 'punch' }, id: 'p1' })
    const r = await svc.updateCaptionSettings('p1', { size: 100 }, USER as never)
    expect(r.captionStyle).toEqual({ preset: 'punch', size: 100 })
  })

  it.each([
    [{ preset: 'fancy' }, 'Caption style must be classic, punch or explainer'],
    [{ accent: 'green' }, 'Caption highlight must be a colour like #04F827'],
    [{ positionY: 50 }, 'Unknown caption setting: positionY'],
    [{}, 'Send at least one of preset, accent, position, size or font'],
    ['punch', 'Caption settings must be an object'],
  ])('answers 400 for %j and saves nothing', async (body, message) => {
    const { projectsService, svc } = makeService({ id: 'p1' })
    const call = svc.updateCaptionSettings('p1', body, USER as never)
    await expect(call).rejects.toThrow(BadRequestException)
    await expect(call).rejects.toThrow(message)
    expect(projectsService.internalUpdateProject).not.toHaveBeenCalled()
  })

  it('answers 400 for a project that does not exist', async () => {
    const { projectsService, svc } = makeService(null)
    await expect(svc.updateCaptionSettings('p1', { size: 100 }, USER as never)).rejects.toThrow(
      BadRequestException,
    )
    expect(projectsService.internalUpdateProject).not.toHaveBeenCalled()
  })

  it('refuses a project the caller cannot open', async () => {
    const { projectsService, svc } = makeService({ id: 'p1' }, { canVisit: false })
    await expect(svc.updateCaptionSettings('p1', { size: 100 }, USER as never)).rejects.toThrow(
      UnauthorizedException,
    )
    expect(projectsService.internalUpdateProject).not.toHaveBeenCalled()
  })

  it('starts no workflow: the preview shows the change and the next export draws it', async () => {
    const { svc } = makeService({ id: 'p1', resultVideo: 'final_video.mp4' })
    await svc.updateCaptionSettings('p1', { preset: 'classic' }, USER as never)
    expect(start).not.toHaveBeenCalled()
  })
})
