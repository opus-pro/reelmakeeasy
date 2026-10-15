import { ProjectService } from './projects.service'

const FILES = 'http://localhost:5017/api/files'

function makeService() {
  const update = jest.fn(async () => ({ orgId: null }))
  const prisma = { project: { update } }
  const unused = {} as never
  return {
    service: new ProjectService(prisma as never, unused, unused, unused, unused, unused),
    update,
  }
}

describe('ProjectService.internalUpdateProject', () => {
  const env = { ...process.env }
  beforeEach(() => {
    delete process.env['PUBLIC_FILES_URL']
    delete process.env['PORT']
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it('saves addresses, never a served URL with a host or port', async () => {
    const { service, update } = makeService()
    await service.internalUpdateProject(
      'p1',
      {
        previewThumbnail: `${FILES}/agent/workspace/p1/_thumbnail/final_video.mp4.jpg?v=3`,
        resultVideo: `${FILES}/agent/workspace/p1/final_video.mp4`,
        styleThumbnailUrl: 'https://example.test/style.webp',
      },
      'system',
    )
    expect(update).toHaveBeenCalledWith({
      data: {
        previewThumbnail: 'store://agent/workspace/p1/_thumbnail/final_video.mp4.jpg',
        resultVideo: 'store://agent/workspace/p1/final_video.mp4',
        styleThumbnailUrl: 'https://example.test/style.webp',
      },
      where: { id: 'p1' },
    })
  })
})

describe('ProjectService.updateProject', () => {
  const env = { ...process.env }
  beforeEach(() => {
    delete process.env['PUBLIC_FILES_URL']
    delete process.env['PORT']
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it("keeps an upload's tag in the prompt as the file's address", async () => {
    const update = jest.fn(async () => ({ id: 'p1' }))
    const prisma = {
      project: {
        findUnique: jest.fn(async () => ({ id: 'p1', isCustomName: true, orgId: 'o1' })),
        update,
      },
    }
    const unused = {} as never
    const service = new ProjectService(prisma as never, unused, unused, unused, unused, unused)
    await service.updateProject('p1', 'o1', {
      initialText: `A video of @img[Hero](upload_1|${FILES}/projects/p1/user_uploaded/hero.png)`,
    } as never)
    expect(update).toHaveBeenCalledWith({
      data: {
        initPrompt: 'A video of @img[Hero](upload_1|store://projects/p1/user_uploaded/hero.png)',
      },
      where: { id: 'p1', orgId: 'o1' },
    })
  })
})
