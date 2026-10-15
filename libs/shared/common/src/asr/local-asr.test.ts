import { copyFile } from 'node:fs/promises'

const mockRunFfmpeg = jest.fn(async (...args: string[]) => {
  // No FFmpeg in CI: "converting" copies the input to the output path.
  await copyFile(args[args.indexOf('-i') + 1] as string, args[args.length - 1] as string)
})

jest.mock('../utils/cmdline', () => ({
  runFfmpeg: (...args: string[]) => mockRunFfmpeg(...args),
}))

import { forgetLocalTtsHealth, localSttSupports } from '../tts/local-tts'

import {
  localForcedAlignment,
  localSpeechToText,
  mapLocalTranscription,
  speechWavSeconds,
} from './local-asr'

const LOCAL = 'http://127.0.0.1:5019'

interface Call {
  body?: Record<string, unknown>
  signal?: AbortSignal | null
  url: string
}

interface Routes {
  align?: () => Promise<Response>
  health?: null | object
  transcribe?: () => Promise<Response>
}

const json =
  (body: object, status = 200) =>
  async () =>
    new Response(JSON.stringify(body), { status })

const sttHealth = (stt: object) => ({
  backend: 'mlx',
  engines: { kokoro: true, qwen3: true },
  stt,
})

let calls: Call[] = []

/** Scripts the local server: `/health`, `/v1/transcribe` and `/v1/align`. */
function serve(routes: Routes): void {
  calls = []
  global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    calls.push({
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      signal: init?.signal,
      url,
    })
    if (url === `${LOCAL}/health`) {
      if (!routes.health) throw new Error('connection refused')
      return new Response(JSON.stringify(routes.health))
    }
    const route = url === `${LOCAL}/v1/transcribe` ? routes.transcribe : routes.align
    if (!route) return new Response('Not Found', { status: 404 })
    return route()
  }) as typeof fetch
}

/**
 * A silent 16 kHz mono 16-bit WAV of `seconds`. `extra` chunks go between `fmt ` and `data`,
 * as FFmpeg writes a LIST chunk there.
 */
function speechWav(seconds: number, extra: Buffer[] = []): Buffer {
  const data = Math.round(seconds * 32_000)
  const fmt = Buffer.alloc(24)
  fmt.write('fmt ', 0, 'ascii')
  fmt.writeUInt32LE(16, 4)
  fmt.writeUInt16LE(1, 8)
  fmt.writeUInt16LE(1, 10)
  fmt.writeUInt32LE(16_000, 12)
  fmt.writeUInt32LE(32_000, 16)
  fmt.writeUInt16LE(2, 20)
  fmt.writeUInt16LE(16, 22)
  const dataHeader = Buffer.alloc(8)
  dataHeader.write('data', 0, 'ascii')
  dataHeader.writeUInt32LE(data, 4)
  const body = Buffer.concat([fmt, ...extra, dataHeader, Buffer.alloc(data)])
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'ascii')
  riff.writeUInt32LE(4 + body.length, 4)
  riff.write('WAVE', 8, 'ascii')
  return Buffer.concat([riff, body])
}

/** A chunk of `size` bytes, padded to an even length like RIFF requires. */
function chunk(id: string, size: number): Buffer {
  const header = Buffer.alloc(8)
  header.write(id, 0, 'ascii')
  header.writeUInt32LE(size, 4)
  return Buffer.concat([header, Buffer.alloc(size + (size % 2))])
}

const healthCalls = () => calls.filter((c) => c.url === `${LOCAL}/health`).length
const posted = (route: string) => calls.find((c) => c.url === `${LOCAL}${route}`)

beforeEach(() => {
  process.env['LOCAL_TTS_URL'] = LOCAL
  forgetLocalTtsHealth()
  mockRunFfmpeg.mockClear()
})

afterEach(() => jest.restoreAllMocks())

describe('localSpeechToText', () => {
  it('sends 16 kHz mono WAV and maps Whisper words to the ElevenLabs shape', async () => {
    const wav = speechWav(1)
    const timeout = jest.spyOn(AbortSignal, 'timeout')
    serve({
      transcribe: json({
        language: 'en',
        languageProbability: 0.99,
        model: 'whisper-large-v3-turbo',
        text: ' Did you know, 3,000 years ago?',
        words: [
          { end: 0.3, probability: 0.5, start: 0.1, text: ' Did' },
          { end: 0.42, probability: 1, start: 0.3, text: ' you' },
          { end: 0.7, probability: 1, start: 0.42, text: ' know,' },
          { end: 1.3, probability: 1, start: 0.8, text: ' 3,000' },
        ],
      }),
    })

    const result = await localSpeechToText(new Blob([wav]), { languageCode: 'eng' })

    const args = mockRunFfmpeg.mock.calls[0] as string[]
    expect(args.join(' ')).toContain('-ac 1 -ar 16000 -c:a pcm_s16le')
    expect(posted('/v1/transcribe')?.body).toEqual({
      audio: wav.toString('base64'),
      language: 'en',
      wordTimestamps: true,
    })
    expect(timeout).toHaveBeenCalledWith(120_000)
    expect(posted('/v1/transcribe')?.signal).toBe(timeout.mock.results[0]?.value)
    expect(result).toEqual({
      languageCode: 'eng',
      languageProbability: 0.99,
      text: 'Did you know, 3,000 years ago?',
      words: [
        { end: 0.3, logprob: Math.log(0.5), start: 0.1, text: 'Did', type: 'word' },
        { end: 0.42, logprob: 0, start: 0.3, text: 'you', type: 'word' },
        { end: 0.7, logprob: 0, start: 0.42, text: 'know,', type: 'word' },
        { end: 1.3, logprob: 0, start: 0.8, text: '3,000', type: 'word' },
      ],
    })
  })

  it('lets Whisper detect the language when none is asked', async () => {
    serve({ transcribe: json({ language: 'de', text: 'Hallo', words: [] }) })
    const result = await localSpeechToText(new Blob([speechWav(0.5)]))
    expect(posted('/v1/transcribe')?.body).not.toHaveProperty('language')
    expect(result.languageCode).toBe('deu')
    expect(result.languageProbability).toBe(0)
  })

  it('fails with the server reason and forgets its cached status', async () => {
    serve({
      health: sttHealth({ align: true, transcribe: true }),
      transcribe: async () => new Response('out of memory', { status: 500 }),
    })
    await localSttSupports('transcribe')
    expect(healthCalls()).toBe(1)
    await expect(localSpeechToText(new Blob([speechWav(1)]))).rejects.toThrow(
      'Local speech to text failed (HTTP 500): out of memory',
    )
    await localSttSupports('transcribe')
    expect(healthCalls()).toBe(2)
  })

  it('gives up after 120 s and forgets the cached status', async () => {
    serve({
      health: sttHealth({ align: true, transcribe: true }),
      transcribe: async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      },
    })
    await localSttSupports('transcribe')
    await expect(localSpeechToText(new Blob([speechWav(1)]))).rejects.toThrow(
      'Local speech to text timed out after 120 s',
    )
    await localSttSupports('transcribe')
    expect(healthCalls()).toBe(2)
  })

  it('needs the local server address', async () => {
    delete process.env['LOCAL_TTS_URL']
    serve({})
    await expect(localSpeechToText(new Blob([speechWav(1)]))).rejects.toThrow(
      'LOCAL_TTS_URL is not set',
    )
  })
})

describe('mapLocalTranscription', () => {
  it('leaves out empty words, and times or probabilities that are not numbers', () => {
    const result = mapLocalTranscription(
      {
        words: [
          { end: 0.2, start: 0.1, text: ' ' },
          { end: 0.5, probability: 0, start: null, text: ' Hi' },
          { end: Number.NaN, probability: null, start: 0.6, text: 'there' },
        ],
      },
      'en',
    )
    expect(result).toEqual({
      languageCode: 'eng',
      languageProbability: 1,
      text: 'Hi there',
      words: [
        { end: 0.5, text: 'Hi', type: 'word' },
        { start: 0.6, text: 'there', type: 'word' },
      ],
    })
  })

  it('reads an unset language as English, the only caption language for now', () => {
    expect(mapLocalTranscription({ text: 'Hi', words: [] }).languageCode).toBe('eng')
  })
})

describe('localForcedAlignment', () => {
  const heardHiThere = json({
    language: 'en',
    text: 'Hi there.',
    words: [
      { end: 0.4, probability: 1, start: 0.1, text: ' Hi' },
      { end: 0.9, probability: 1, start: 0.45, text: ' there.' },
    ],
  })

  it('times a known script with the local aligner, keeping the script words', async () => {
    const wav = speechWav(2)
    serve({
      align: json({
        model: 'qwen3-forced-aligner',
        words: [
          { end: 0.4, start: 0.08, text: 'Hi' },
          { end: 0.88, start: 0.4, text: 'there' },
        ],
      }),
      health: sttHealth({ align: true, transcribe: true }),
    })
    const result = await localForcedAlignment(new Blob([wav]), 'Hi there.')
    expect(posted('/v1/align')?.body).toEqual({ audio: wav.toString('base64'), text: 'Hi there.' })
    expect(posted('/v1/transcribe')).toBeUndefined()
    expect(result).toEqual({
      characters: [],
      source: 'local-aligner',
      words: [
        { end: 0.4, start: 0.08, text: 'Hi' },
        { end: 0.88, start: 0.4, text: 'there.' },
      ],
    })
  })

  it('puts back the punctuation and hyphens the aligner strips', async () => {
    serve({
      align: json({
        words: [
          { end: 0.3, start: 0.1, text: 'For' },
          { end: 0.8, start: 0.3, text: 'decades' },
          { end: 1.3, start: 0.9, text: 'rulebased' },
          { end: 1.7, start: 1.3, text: 'systems' },
          { end: 1.9, start: 1.75, text: 'and' },
          { end: 2.2, start: 1.9, text: '3000' },
        ],
      }),
      health: sttHealth({ align: true, transcribe: true }),
    })
    const result = await localForcedAlignment(
      new Blob([speechWav(3)]),
      'For decades, rule-based systems—and 3,000.',
    )
    expect(result.words).toEqual([
      { end: 0.3, start: 0.1, text: 'For' },
      { end: 0.8, start: 0.3, text: 'decades,' },
      { end: 1.3, start: 0.9, text: 'rule-based' },
      { end: 1.7, start: 1.3, text: 'systems—' },
      { end: 1.9, start: 1.75, text: 'and' },
      { end: 2.2, start: 1.9, text: '3,000.' },
    ])
  })

  it('lays the script over Whisper words when no aligner is installed', async () => {
    serve({
      health: sttHealth({ align: false, transcribe: true }),
      transcribe: heardHiThere,
    })
    const result = await localForcedAlignment(new Blob([speechWav(2)]), 'Hi there.')
    expect(posted('/v1/align')).toBeUndefined()
    expect(posted('/v1/transcribe')?.body).toMatchObject({ language: 'en', wordTimestamps: true })
    expect(result).toEqual({
      characters: [],
      source: 'local-whisper',
      words: [
        { end: 0.4, start: 0.1, text: 'Hi' },
        { end: 0.9, start: 0.45, text: 'there.' },
      ],
    })
  })

  it('times audio longer than the aligner handles with Whisper', async () => {
    serve({
      align: json({ words: [] }),
      health: sttHealth({ align: true, transcribe: true }),
      transcribe: heardHiThere,
    })
    const result = await localForcedAlignment(new Blob([speechWav(121)]), 'Hi there.')
    expect(posted('/v1/align')).toBeUndefined()
    expect(result.source).toBe('local-whisper')
  })

  it('uses Whisper when the aligner turns out not to be there', async () => {
    serve({
      align: async () => new Response('align is not enabled', { status: 404 }),
      health: sttHealth({ align: true, transcribe: true }),
      transcribe: heardHiThere,
    })
    const result = await localForcedAlignment(new Blob([speechWav(2)]), 'Hi there.')
    expect(result.source).toBe('local-whisper')
  })

  it('keeps the cached status when the server says it has no aligner', async () => {
    serve({
      align: async () => new Response('align is not enabled', { status: 404 }),
      health: sttHealth({ align: true, transcribe: true }),
      transcribe: heardHiThere,
    })
    await localForcedAlignment(new Blob([speechWav(2)]), 'Hi there.')
    await localSttSupports('align')
    expect(healthCalls()).toBe(1)
  })

  it('uses Whisper when the aligner fails, before any cloud', async () => {
    serve({
      align: async () => new Response('boom', { status: 500 }),
      health: sttHealth({ align: true, transcribe: true }),
      transcribe: heardHiThere,
    })
    const result = await localForcedAlignment(new Blob([speechWav(2)]), 'Hi there.')
    expect(posted('/v1/align')).toBeDefined()
    expect(result).toEqual({
      characters: [],
      source: 'local-whisper',
      words: [
        { end: 0.4, start: 0.1, text: 'Hi' },
        { end: 0.9, start: 0.45, text: 'there.' },
      ],
    })
  })

  it('uses Whisper when the aligner times out', async () => {
    serve({
      align: async () => {
        throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
      },
      health: sttHealth({ align: true, transcribe: true }),
      transcribe: heardHiThere,
    })
    const result = await localForcedAlignment(new Blob([speechWav(2)]), 'Hi there.')
    expect(result.source).toBe('local-whisper')
  })

  it('uses Whisper when the aligner finds no words in the script', async () => {
    serve({
      align: json({ words: [] }),
      health: sttHealth({ align: true, transcribe: true }),
      transcribe: heardHiThere,
    })
    const result = await localForcedAlignment(new Blob([speechWav(2)]), 'Hi there.')
    expect(result.source).toBe('local-whisper')
  })

  it('fails when the aligner and Whisper both fail, so the caller can use the cloud', async () => {
    serve({
      align: async () => new Response('boom', { status: 500 }),
      health: sttHealth({ align: true, transcribe: true }),
      transcribe: async () => new Response('out of memory', { status: 500 }),
    })
    await expect(localForcedAlignment(new Blob([speechWav(2)]), 'Hi there.')).rejects.toThrow(
      'Local speech to text failed (HTTP 500): out of memory',
    )
  })
})

describe('speechWavSeconds', () => {
  it('reads the data chunk after the chunks FFmpeg writes before it', () => {
    expect(speechWavSeconds(speechWav(7.3))).toBeCloseTo(7.3)
    expect(speechWavSeconds(speechWav(7.3, [chunk('LIST', 26)]))).toBeCloseTo(7.3)
    expect(speechWavSeconds(speechWav(1.5, [chunk('LIST', 25), chunk('fact', 4)]))).toBeCloseTo(1.5)
  })

  it('counts only the bytes there are, and 0 without a data chunk', () => {
    expect(speechWavSeconds(speechWav(2).subarray(0, 44 + 32_000))).toBeCloseTo(1)
    expect(speechWavSeconds(speechWav(2).subarray(0, 36))).toBe(0)
  })

  it('sends audio with a LIST chunk under two minutes to the aligner', async () => {
    serve({
      align: json({ words: [{ end: 0.4, start: 0.1, text: 'Hi' }] }),
      health: sttHealth({ align: true, transcribe: true }),
    })
    const wav = speechWav(119.9, [chunk('LIST', 26)])
    await expect(localForcedAlignment(new Blob([wav]), 'Hi')).resolves.toMatchObject({
      source: 'local-aligner',
    })
  })
})
