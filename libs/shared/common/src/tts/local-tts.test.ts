import { copyFile } from 'node:fs/promises'

const falSubscribe = jest.fn()

jest.mock('@reelmakeeasy/llm', () => ({
  fal: { storage: { upload: jest.fn() }, subscribe: (...args: unknown[]) => falSubscribe(...args) },
}))
jest.mock('@reelmakeeasy/llm/registry', () => ({
  resolveRole: (role: string) => ({
    endpoint: role === 'tts.kokoro' ? 'fal-ai/kokoro/american-english' : 'fal-ai/qwen-3-tts/1.7b',
    endpoints: {},
    input: {},
    key: role,
    provider: 'fal',
  }),
}))
// No FFmpeg in CI: "transcoding" copies the input to the output path.
jest.mock('../utils/cmdline', () => ({
  runFfmpeg: async (...args: string[]) => {
    await copyFile(args[args.indexOf('-i') + 1] as string, args[args.length - 1] as string)
  },
}))

type FalTts = typeof import('./fal-tts')

const LOCAL = 'http://127.0.0.1:5019'
const WAV = Buffer.from('RIFF-local-audio')

interface Call {
  body?: Record<string, unknown>
  url: string
}

/** Fresh modules per test (the health check is cached) with a scripted fetch. */
function setup(routes: { health?: null | object; speechStatus?: number }): {
  calls: Call[]
  tts: FalTts
} {
  const calls: Call[] = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({ body: init?.body ? JSON.parse(String(init.body)) : undefined, url })
    if (url.endsWith('/health')) {
      if (!routes.health) throw new Error('connection refused')
      return new Response(JSON.stringify(routes.health))
    }
    if (url.endsWith('/v1/speech')) {
      const status = routes.speechStatus ?? 200
      return new Response(status === 200 ? WAV : 'boom', { status })
    }
    return new Response(Buffer.from('fal-mp3'))
  }) as typeof fetch
  let tts!: FalTts
  jest.isolateModules(() => {
    tts = require('./fal-tts')
  })
  return { calls, tts }
}

const bothEngines = { backend: 'mlx', engines: { kokoro: true, qwen3: true } }

beforeEach(() => {
  process.env['LOCAL_TTS_URL'] = LOCAL
  falSubscribe.mockReset()
  falSubscribe.mockResolvedValue({
    data: { audio: { content_type: 'audio/mpeg', url: 'https://fal.media/out.mp3' } },
    requestId: 'fal-1',
  })
})

describe('local voice routing', () => {
  it('speaks Kokoro locally when the local server runs it', async () => {
    const { calls, tts } = setup({ health: bothEngines })
    const result = await tts.kokoroTextToSpeech({ text: 'Hello there', voiceId: 'kokoro-bf_emma' })
    expect(result.ranOn).toBe('local')
    expect(result.audioBuffer).toEqual(WAV)
    expect(calls.find((c) => c.url === `${LOCAL}/v1/speech`)?.body).toEqual({
      engine: 'kokoro',
      speed: 1,
      text: 'Hello there',
      voice: 'bf_emma',
    })
    expect(falSubscribe).not.toHaveBeenCalled()
  })

  it('uses fal when no local server is configured', async () => {
    delete process.env['LOCAL_TTS_URL']
    const { calls, tts } = setup({ health: bothEngines })
    const result = await tts.kokoroTextToSpeech({ text: 'Hello', voiceId: 'kokoro-af_heart' })
    expect(result.ranOn).toBe('fal')
    expect(calls.some((c) => c.url.startsWith(LOCAL))).toBe(false)
  })

  it('falls back to fal when the local server fails', async () => {
    const { tts } = setup({ health: bothEngines, speechStatus: 500 })
    const result = await tts.kokoroTextToSpeech({ text: 'Hello', voiceId: 'kokoro-af_heart' })
    expect(result.ranOn).toBe('fal')
    expect(falSubscribe).toHaveBeenCalledTimes(1)
  })

  it('uses fal for an engine the local server does not run', async () => {
    const { tts } = setup({ health: { backend: 'cpu', engines: { kokoro: true, qwen3: false } } })
    const result = await tts.qwen3TextToSpeech({ speaker: { voice: 'Ryan' }, text: 'Hi' })
    expect(result.ranOn).toBe('fal')
  })

  it('clones locally from reference audio without making a fal embedding', async () => {
    const { calls, tts } = setup({ health: bothEngines })
    const embeddingUrl = jest.fn()
    const result = await tts.qwen3TextToSpeech({
      languageCode: 'de-DE',
      speaker: {
        reference: { audio: async () => Buffer.from('ref'), embeddingUrl, text: 'Guten Tag' },
      },
      text: 'Hallo',
    })
    expect(result.ranOn).toBe('local')
    expect(calls.find((c) => c.url.endsWith('/v1/speech'))?.body).toMatchObject({
      engine: 'qwen3',
      language: 'German',
      refAudio: Buffer.from('ref').toString('base64'),
      refText: 'Guten Tag',
    })
    expect(embeddingUrl).not.toHaveBeenCalled()
  })

  it('synthesizes a voice with no reference audio on fal, from its embedding', async () => {
    const { tts } = setup({ health: bothEngines })
    const result = await tts.qwen3TextToSpeech({
      speaker: {
        reference: {
          audio: async () => null,
          embeddingUrl: async () => 'https://fal.media/speaker.safetensors',
        },
      },
      text: 'Hi',
    })
    expect(result.ranOn).toBe('fal')
    expect(falSubscribe.mock.calls[0][1].input).toMatchObject({
      speaker_voice_embedding_file_url: 'https://fal.media/speaker.safetensors',
    })
  })
})

describe('local speech to text status', () => {
  type LocalTts = typeof import('./local-tts')

  /** A fresh module (the status is cached) whose /health answers `health`. */
  function load(health: null | object): { fetchMock: jest.Mock; localTts: LocalTts } {
    const fetchMock = jest.fn(async () => {
      if (!health) throw new Error('connection refused')
      return new Response(JSON.stringify(health))
    })
    global.fetch = fetchMock as unknown as typeof fetch
    let localTts!: LocalTts
    jest.isolateModules(() => {
      localTts = require('./local-tts')
    })
    return { fetchMock, localTts }
  }

  it('reads Whisper and the aligner from the stt field of /health', async () => {
    const { localTts } = load({
      ...bothEngines,
      stt: { align: true, models: { align: 'qwen3-aligner' }, transcribe: true },
    })
    await expect(localTts.localSttSupports('transcribe')).resolves.toBe(true)
    await expect(localTts.localSttSupports('align')).resolves.toBe(true)
  })

  it('reports no speech to text from a server without the stt field', async () => {
    const { localTts } = load(bothEngines)
    await expect(localTts.localSttSupports('transcribe')).resolves.toBe(false)
    await expect(localTts.localSttSupports('align')).resolves.toBe(false)
    await expect(localTts.localTtsSupports('kokoro')).resolves.toBe(true)
  })

  it('reports none when the server does not answer or is not configured', async () => {
    const { localTts } = load(null)
    await expect(localTts.localSttSupports('transcribe')).resolves.toBe(false)
    delete process.env['LOCAL_TTS_URL']
    const { fetchMock, localTts: unconfigured } = load(bothEngines)
    await expect(unconfigured.localSttSupports('transcribe')).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('asks the server again once the cached status is forgotten', async () => {
    const { fetchMock, localTts } = load({
      ...bothEngines,
      stt: { align: false, transcribe: true },
    })
    await localTts.localSttSupports('transcribe')
    await localTts.localSttSupports('align')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    localTts.forgetLocalTtsHealth()
    await localTts.localSttSupports('transcribe')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
