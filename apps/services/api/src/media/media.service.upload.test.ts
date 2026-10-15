import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { fileStore } from '@reelmakeeasy/common/storage/file-store'
import { BadRequestException } from '@nestjs/common'

import { MediaService } from './media.service'

// The service answers with addresses; the served URLs are built when the answer is sent.
const THUMBNAIL_URL = 'store://agent/workspace/p1/user_uploaded/preview_videos/clip.jpg'

// The retrying download races a timeout it never clears; download directly so no
// timer outlives the test.
jest.mock('@reelmakeeasy/common/storage/stored-files', () => {
  const actual = jest.requireActual<typeof import('@reelmakeeasy/common/storage/stored-files')>(
    '@reelmakeeasy/common/storage/stored-files',
  )
  return {
    ...actual,
    downloadStoredFileWithRetry: (fileUri: string, localPath: string) =>
      actual.downloadStoredFile(fileUri, localPath),
  }
})

jest.mock('../util/create-thumbnail/create', () => {
  const nodeFs = jest.requireActual<typeof import('node:fs')>('node:fs')
  const nodeOs = jest.requireActual<typeof import('node:os')>('node:os')
  const nodePath = jest.requireActual<typeof import('node:path')>('node:path')
  const scratch = async () => {
    const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'thumb-'))
    const thumbnailPath = nodePath.join(dir, 'clip.jpg')
    nodeFs.writeFileSync(thumbnailPath, 'jpg')
    return { thumbnailPath }
  }
  return {
    cleanupThumbnailScratch: jest.fn(),
    createThumbnailFromImageToScratch: jest.fn(scratch),
    createThumbnailFromVideoToScratch: jest.fn(scratch),
    uploadThumbnailAndCleanup: jest.fn(async () => THUMBNAIL_URL),
  }
})

describe('MediaService.uploadFile', () => {
  const env = { ...process.env }
  let dataDir: string
  let service: MediaService

  beforeEach(async () => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelmakeeasy-media-'))
    process.env['DATA_DIR'] = dataDir
    await fileStore
      .file('projects/p1/user_uploaded/clip.mp4')
      .write(Buffer.from('not really a video'))
    const prisma = { projectAttachment: { create: jest.fn().mockResolvedValue({ id: 'a1' }) } }
    service = new MediaService(prisma as never)
  })

  afterEach(() => {
    process.env = { ...env }
    fs.rmSync(dataDir, { force: true, recursive: true })
  })

  it('returns the uploaded video itself as the editor preview', async () => {
    const result = await service.uploadFile('p1', {
      fileContentType: 'video/mp4',
      fileUri: 'store://projects/p1/user_uploaded/clip.mp4',
      fileName: 'clip.mp4',
      generateVideoPreview: true,
      thumbnailPreset: 'editor',
      uploadToCdn: true,
    })

    expect(result.cdnUrl).toBe('store://agent/workspace/p1/user_uploaded/clip.mp4')
    expect(result.previewCdnUrl).toBe(result.cdnUrl)
    expect(result.thumbnailCdnUrl).toBe(THUMBNAIL_URL)
  })

  it('returns the still thumbnail as the preview when no video preview is asked for', async () => {
    const result = await service.uploadFile('p1', {
      fileContentType: 'video/mp4',
      fileUri: 'store://projects/p1/user_uploaded/clip.mp4',
      fileName: 'clip.mp4',
      uploadToCdn: true,
    })

    expect(result.previewCdnUrl).toBe(THUMBNAIL_URL)
  })

  it('refuses a source outside the stored files', async () => {
    fs.writeFileSync(path.join(dataDir, 'file-signing.key'), 'secret')

    await expect(
      service.uploadFile('p1', {
        fileContentType: 'text/plain',
        fileUri: 'store://../file-signing.key',
        fileName: 'key.txt',
      }),
    ).rejects.toThrow(BadRequestException)
  })
})
