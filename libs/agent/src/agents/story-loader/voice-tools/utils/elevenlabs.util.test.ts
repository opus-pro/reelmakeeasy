const mockFetch = jest.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([1])),
)

jest.mock('@reelmakeeasy/common/agent-v2/storage/storage', () => ({ createStorage: jest.fn() }))
jest.mock('@reelmakeeasy/common/llm', () => ({ completion: jest.fn() }))

import { isolateVoiceFromAudio } from './elevenlabs.util'

const KEY = 'ELEVENLABS_API_KEY'
const savedKey = process.env[KEY]

beforeEach(() => {
  mockFetch.mockClear()
  global.fetch = mockFetch as unknown as typeof fetch
})

afterAll(() => {
  if (savedKey === undefined) delete process.env[KEY]
  else process.env[KEY] = savedKey
})

describe('isolateVoiceFromAudio', () => {
  it('skips without an ElevenLabs key and leaves the sample alone', async () => {
    delete process.env[KEY]
    await expect(isolateVoiceFromAudio('/tmp/never-read.mp3')).resolves.toEqual({
      message: 'Voice isolation skipped: it needs ELEVENLABS_API_KEY',
      status: 'error',
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
