const mockLocalSttSupports = jest.fn(async (_kind: string) => false)

jest.mock('../tts/local-tts', () => ({
  localSttSupports: (kind: string) => mockLocalSttSupports(kind),
}))

import { elevenLabsApiKey, hasElevenLabsKey, NEEDS_ELEVENLABS_KEY } from '../elevenlabs/key'

import { asrBackend, localAsrEnabled, resolveAsrBackend } from './asr-backend'

beforeEach(() => {
  mockLocalSttSupports.mockReset().mockResolvedValue(false)
})

describe('resolveAsrBackend', () => {
  it('runs on this computer when the local server has Whisper, before any cloud', async () => {
    mockLocalSttSupports.mockResolvedValue(true)
    await expect(resolveAsrBackend({ env: {} })).resolves.toBe('local')
    await expect(resolveAsrBackend({ env: { ELEVENLABS_API_KEY: 'el-test' } })).resolves.toBe(
      'local',
    )
    expect(mockLocalSttSupports).toHaveBeenCalledWith('transcribe')
  })

  it('keeps the quality-check transcript on ElevenLabs when its key is set', async () => {
    mockLocalSttSupports.mockResolvedValue(true)
    await expect(
      resolveAsrBackend({ env: { ELEVENLABS_API_KEY: 'el-test' }, forQualityChecks: true }),
    ).resolves.toBe('elevenlabs')
    await expect(resolveAsrBackend({ env: {}, forQualityChecks: true })).resolves.toBe('local')
  })

  it('uses the cloud order when the local server has no Whisper', async () => {
    await expect(resolveAsrBackend({ env: {} })).resolves.toBe('fal')
    await expect(resolveAsrBackend({ env: { ELEVENLABS_API_KEY: 'el-test' } })).resolves.toBe(
      'elevenlabs',
    )
  })

  it('never asks the local server with LOCAL_ASR=off', async () => {
    mockLocalSttSupports.mockResolvedValue(true)
    await expect(resolveAsrBackend({ env: { LOCAL_ASR: 'off' } })).resolves.toBe('fal')
    await expect(
      resolveAsrBackend({ env: { ELEVENLABS_API_KEY: 'el-test', LOCAL_ASR: ' off ' } }),
    ).resolves.toBe('elevenlabs')
    expect(mockLocalSttSupports).not.toHaveBeenCalled()
  })

  it('reads process.env by default', async () => {
    const saved = process.env['LOCAL_ASR']
    mockLocalSttSupports.mockResolvedValue(true)
    try {
      process.env['LOCAL_ASR'] = 'off'
      await expect(resolveAsrBackend()).resolves.not.toBe('local')
      delete process.env['LOCAL_ASR']
      await expect(resolveAsrBackend()).resolves.toBe('local')
    } finally {
      if (saved === undefined) delete process.env['LOCAL_ASR']
      else process.env['LOCAL_ASR'] = saved
    }
  })
})

describe('localAsrEnabled', () => {
  it('is on unless LOCAL_ASR is off', () => {
    expect(localAsrEnabled({})).toBe(true)
    expect(localAsrEnabled({ LOCAL_ASR: 'on' })).toBe(true)
    expect(localAsrEnabled({ LOCAL_ASR: 'off' })).toBe(false)
  })
})

describe('asrBackend', () => {
  it('uses ElevenLabs directly when its key is set', () => {
    expect(asrBackend({ ELEVENLABS_API_KEY: 'el-test' })).toBe('elevenlabs')
  })

  it('uses Scribe on fal without the key', () => {
    expect(asrBackend({})).toBe('fal')
    expect(asrBackend({ ELEVENLABS_API_KEY: '   ' })).toBe('fal')
  })

  it('reads process.env by default', () => {
    const saved = process.env['ELEVENLABS_API_KEY']
    try {
      process.env['ELEVENLABS_API_KEY'] = 'el-test'
      expect(asrBackend()).toBe('elevenlabs')
      delete process.env['ELEVENLABS_API_KEY']
      expect(asrBackend()).toBe('fal')
    } finally {
      if (saved === undefined) delete process.env['ELEVENLABS_API_KEY']
      else process.env['ELEVENLABS_API_KEY'] = saved
    }
  })
})

describe('ElevenLabs key', () => {
  it('trims the key and treats a blank one as unset', () => {
    expect(elevenLabsApiKey({ ELEVENLABS_API_KEY: ' el-test ' })).toBe('el-test')
    expect(elevenLabsApiKey({ ELEVENLABS_API_KEY: '' })).toBeUndefined()
    expect(hasElevenLabsKey({ ELEVENLABS_API_KEY: 'el-test' })).toBe(true)
    expect(hasElevenLabsKey({})).toBe(false)
  })

  it('says in plain words what is missing', () => {
    expect(NEEDS_ELEVENLABS_KEY).toMatch(/^Needs an ElevenLabs key/)
  })
})
