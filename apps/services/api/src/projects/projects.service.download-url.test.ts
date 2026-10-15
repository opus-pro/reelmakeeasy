import { VIDEO_NOT_RENDERED_ERROR_CODE } from '@reelmakeeasy/common/long-take/video-not-rendered'
import { NotFoundException } from '@nestjs/common'

import { downloadFileExists } from './download-file.util'
import { ProjectService } from './projects.service'
import { recordProjectDownloadEvent } from './projects-query.util'

jest.mock('./download-file.util', () => ({
  ...jest.requireActual('./download-file.util'),
  downloadFileExists: jest.fn(),
}))

jest.mock('./projects-query.util', () => ({
  applyNoLipSyncDownloadVariant: jest.fn(),
  generateVideoDownloadUrl: jest.fn(() => ({
    filename: 'video.mp4',
    url: 'store://agent/workspace/p1/final_video.mp4',
  })),
  recordProjectDownloadEvent: jest.fn(),
  versionDownloadUrlByGeneration: jest.fn(async (url: string) => url),
}))

function makeService() {
  const prisma = {
    project: {
      findUnique: jest.fn().mockResolvedValue({
        name: 'Video',
        orgId: 'org',
        resultVideo: 'store://agent/workspace/p1/final_video.mp4',
        watermarkVideo: null,
      }),
    },
  }
  const unused = {} as never
  return new ProjectService(prisma as never, unused, unused, unused, unused, unused)
}

describe('ProjectService.generateVideoDownloadUrl', () => {
  const env = { ...process.env }
  beforeEach(() => {
    jest.clearAllMocks()
    delete process.env['PUBLIC_FILES_URL']
    delete process.env['PORT']
  })
  afterEach(() => {
    process.env = { ...env }
  })

  it('answers 404 VIDEO_NOT_RENDERED, recording no download, when the file is missing', async () => {
    jest.mocked(downloadFileExists).mockResolvedValue(false)
    const error = await makeService()
      .generateVideoDownloadUrl('p1', false)
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NotFoundException)
    expect((error as NotFoundException).getResponse()).toMatchObject({
      code: VIDEO_NOT_RENDERED_ERROR_CODE,
    })
    expect(recordProjectDownloadEvent).not.toHaveBeenCalled()
  })

  it('returns the link and records the download when the file is there', async () => {
    jest.mocked(downloadFileExists).mockResolvedValue(true)
    const result = await makeService().generateVideoDownloadUrl('p1', false)
    expect(result.url).toContain('final_video.mp4')
    expect(recordProjectDownloadEvent).toHaveBeenCalledTimes(1)
  })

  it('serves the saved address with ?download=, so the file saves instead of opening', async () => {
    // The browser ignores a link's `download` attribute cross-origin: the files route's
    // Content-Disposition (from ?download=) is what saves the file.
    jest.mocked(downloadFileExists).mockResolvedValue(true)
    const result = await makeService().generateVideoDownloadUrl('p1', false)
    expect(result).toEqual({
      filename: 'video.mp4',
      url: 'http://localhost:5017/api/files/agent/workspace/p1/final_video.mp4?download=video.mp4',
    })
  })
})
