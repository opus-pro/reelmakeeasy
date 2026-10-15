import { BadRequestException } from '@nestjs/common'

import { MUSIC_UPLOAD_LIMITS, prepareMusicUpload } from './music-upload'

function deps(over: Partial<Parameters<typeof prepareMusicUpload>[1]> = {}) {
  return {
    download: jest.fn(async () => undefined),
    probe: jest.fn(async () => ({ durationSec: 42, hasAudio: true })),
    sizeOf: jest.fn(async () => 2_000_000),
    transcode: jest.fn(async () => undefined),
    ...over,
  }
}

const input = {
  tempFileUri: 'store://tmp/u/music-track/1-brand.mp3',
  workDir: '/tmp/w',
}

describe('prepareMusicUpload', () => {
  it('downloads, checks and transcodes a good file', async () => {
    const d = deps()
    const out = await prepareMusicUpload(input, d)
    expect(d.download).toHaveBeenCalledWith(input.tempFileUri, expect.stringMatching(/source$/))
    expect(d.transcode).toHaveBeenCalledWith(
      expect.stringMatching(/source$/),
      expect.stringMatching(/track\.mp3$/),
    )
    expect(out).toEqual({
      durationSec: 42,
      localMp3: expect.stringMatching(/track\.mp3$/),
      sizeBytes: 2_000_000,
    })
  })

  it('rejects a file without an audio stream', async () => {
    const d = deps({ probe: jest.fn(async () => ({ durationSec: 0, hasAudio: false })) })
    await expect(prepareMusicUpload(input, d)).rejects.toThrow(BadRequestException)
    await expect(prepareMusicUpload(input, d)).rejects.toThrow(/no audio/i)
    expect(d.transcode).not.toHaveBeenCalled()
  })

  it('rejects tracks that are too long, too short or too big, with the limit in the reason', async () => {
    await expect(
      prepareMusicUpload(
        input,
        deps({ probe: jest.fn(async () => ({ durationSec: 601, hasAudio: true })) }),
      ),
    ).rejects.toThrow(/10 minutes/)
    await expect(
      prepareMusicUpload(
        input,
        deps({ probe: jest.fn(async () => ({ durationSec: 4, hasAudio: true })) }),
      ),
    ).rejects.toThrow(/5 seconds/)
    await expect(
      prepareMusicUpload(
        input,
        deps({ sizeOf: jest.fn(async () => MUSIC_UPLOAD_LIMITS.maxBytes + 1) }),
      ),
    ).rejects.toThrow(/50 MB/)
  })
})
