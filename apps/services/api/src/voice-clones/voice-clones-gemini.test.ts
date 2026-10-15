import { resetGenerationProviderForTesting, setGenerationProvider } from '@reelmakeeasy/llm/registry'
import { BadRequestException } from '@nestjs/common'

import { standardCloneBackend } from './voice-clones.backend'
import { VoiceClonesService } from './voice-clones.service'

const mockCreateQwen3VoiceFromSample = jest.fn()

jest.mock('./voice-clones.qwen3', () => ({
  ...jest.requireActual('./voice-clones.qwen3'),
  createQwen3VoiceFromSample: (...args: unknown[]) => mockCreateQwen3VoiceFromSample(...args),
}))
// Development: on fal, "standard" clones would run on MiniMax.
jest.mock('@reelmakeeasy/common/utils/env', () => ({
  ...jest.requireActual('@reelmakeeasy/common/utils/env'),
  isDev: () => true,
}))

const ENV = { ...process.env }

beforeEach(() => {
  process.env = { ...ENV, FAL_KEY: 'f', GEMINI_API_KEY: 'g' }
  for (const name of ['ELEVENLABS_API_KEY', 'LOCAL_TTS_URL']) delete process.env[name]
  mockCreateQwen3VoiceFromSample.mockReset()
})

afterEach(() => {
  process.env = ENV
  resetGenerationProviderForTesting()
})

describe('standard clones by generation provider', () => {
  it('on Gemini use ElevenLabs on its key, never MiniMax, even in development', () => {
    expect(standardCloneBackend({ ELEVENLABS_API_KEY: 'e', FAL_KEY: 'f' }, true, 'google')).toBe(
      'elevenlabs',
    )
    expect(standardCloneBackend({ FAL_KEY: 'f' }, true, 'google')).toBeNull()
    expect(standardCloneBackend({ FAL_KEY: 'f' }, true, 'fal')).toBe('minimax')
  })

  it('on Gemini refuse without an ElevenLabs key instead of cloning on MiniMax', async () => {
    setGenerationProvider('google')
    const service = new VoiceClonesService({} as never)
    const miniMax = jest.spyOn(service, 'createTemporaryMiniMaxVoiceClone')
    const clone = service.createTemporaryElevenLabsVoiceClone('file-1', 'u1', 'u@example.com')
    await expect(clone).rejects.toBeInstanceOf(BadRequestException)
    await expect(clone).rejects.toThrow(/Needs an ElevenLabs key/)
    expect(miniMax).not.toHaveBeenCalled()
  })
})

describe('Qwen3 clones', () => {
  it('on Gemini are refused without the local voices, even with FAL_KEY', async () => {
    setGenerationProvider('google')
    const clone = new VoiceClonesService({} as never).createTemporaryQwen3VoiceClone('file-1', 'u1')
    await expect(clone).rejects.toBeInstanceOf(BadRequestException)
    await expect(clone).rejects.toThrow(/Needs the free local voices: run pnpm reelmakeeasy setup/)
    expect(mockCreateQwen3VoiceFromSample).not.toHaveBeenCalled()
  })

  it('on fal are refused without the local voices or FAL_KEY', async () => {
    delete process.env['FAL_KEY']
    const clone = new VoiceClonesService({} as never).createTemporaryQwen3VoiceClone('file-1', 'u1')
    await expect(clone).rejects.toThrow(/Needs the free local voices/)
    expect(mockCreateQwen3VoiceFromSample).not.toHaveBeenCalled()
  })

  it('on fal with FAL_KEY still clone', async () => {
    mockCreateQwen3VoiceFromSample.mockResolvedValue({ voiceId: 'qwen3-user-1' })
    await new VoiceClonesService({} as never).createTemporaryQwen3VoiceClone('file-1', 'u1')
    expect(mockCreateQwen3VoiceFromSample).toHaveBeenCalledWith({
      fileId: 'file-1',
      referenceText: undefined,
      userId: 'u1',
    })
  })
})
