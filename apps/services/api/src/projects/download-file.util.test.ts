import { filesBaseUrl } from '@reelmakeeasy/common/storage/address'

import { downloadFileExists } from './download-file.util'

const fileUrl = `${filesBaseUrl()}/agent/workspace/p1/final_video.mp4`

describe('downloadFileExists', () => {
  it('reports a stored file that is missing', async () => {
    const exists = jest.fn().mockResolvedValue(false)
    await expect(downloadFileExists(fileUrl, exists)).resolves.toBe(false)
    expect(exists).toHaveBeenCalledWith('agent/workspace/p1/final_video.mp4')
  })

  it('reports a stored file that is there', async () => {
    await expect(downloadFileExists(fileUrl, jest.fn().mockResolvedValue(true))).resolves.toBe(true)
  })

  it('ignores the query string when resolving the file', async () => {
    const exists = jest.fn().mockResolvedValue(true)
    await downloadFileExists(`${fileUrl}?download=My%20video.mp4`, exists)
    expect(exists).toHaveBeenCalledWith('agent/workspace/p1/final_video.mp4')
  })

  it('decodes the stored name exactly once', async () => {
    const exists = jest.fn().mockResolvedValue(true)
    // The object is literally named "100%25 done.mp4" ("%25" in its name).
    await downloadFileExists(`${filesBaseUrl()}/agent/workspace/p1/100%2525%20done.mp4`, exists)
    expect(exists).toHaveBeenCalledWith('agent/workspace/p1/100%25 done.mp4')
  })

  it('reads the stored address a project saves', async () => {
    const exists = jest.fn().mockResolvedValue(false)
    await expect(
      downloadFileExists('store://agent/workspace/p1/final_video.mp4', exists),
    ).resolves.toBe(false)
    expect(exists).toHaveBeenCalledWith('agent/workspace/p1/final_video.mp4')
  })

  it('treats a URL that is not ours as present', async () => {
    const exists = jest.fn()
    await expect(downloadFileExists('https://example.com/v.mp4', exists)).resolves.toBe(true)
    expect(exists).not.toHaveBeenCalled()
  })

  it('treats a storage error as present', async () => {
    const exists = jest.fn().mockRejectedValue(new Error('disk'))
    await expect(downloadFileExists(fileUrl, exists)).resolves.toBe(true)
  })
})
