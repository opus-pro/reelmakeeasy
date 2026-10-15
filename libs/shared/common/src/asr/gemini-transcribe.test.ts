import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { geminiForcedAlignment, geminiTranscribeFile, toTranscription } from './gemini-transcribe'

const mockCreateInteraction = jest.fn()
const mockUpload = jest.fn()

jest.mock('@reelmakeeasy/llm', () => ({
  modelOutput: jest.requireActual('@reelmakeeasy/llm/google').modelOutput,
  runGoogle: {
    createInteraction: (...args: unknown[]) => mockCreateInteraction(...args),
    upload: (...args: unknown[]) => mockUpload(...args),
  },
}))
jest.mock('@reelmakeeasy/llm/registry', () => ({
  ...jest.requireActual('@reelmakeeasy/llm/registry'),
  resolveRole: (role: string) =>
    role === 'speech.align'
      ? {
          endpoints: {},
          input: {},
          key: 'gemini-transcribe',
          kind: 'align',
          label: 'Gemini Transcribe',
          model: 'gemini-3.5-transcribe',
          provider: 'google',
        }
      : null,
}))
// No FFmpeg in CI: "transcoding" copies the input to the output path.
jest.mock('../utils/cmdline', () => ({
  runFfmpeg: async (...args: string[]) => {
    const { copyFile } = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises')
    await copyFile(args[args.indexOf('-i') + 1] as string, args[args.length - 1] as string)
  },
}))

/** A finished Gemini Transcribe interaction, as the Interactions API returns it. */
const answer = (words: [string, string, string][]) => ({
  status: 'completed',
  steps: [
    {
      content: [
        {
          annotations: words.map(([text, start_offset, end_offset]) => ({
            end_offset,
            start_offset,
            text,
            type: 'word_info',
          })),
          text: words.map(([text]) => text).join(' '),
          type: 'text',
        },
      ],
      type: 'model_output',
    },
  ],
})

const HELLO = answer([
  ['Hello', '0.100s', '0.450s'],
  ['world', '0.500s', '0.900s'],
])

describe('Gemini Transcribe', () => {
  let dir = ''
  let audio = ''

  beforeEach(async () => {
    mockCreateInteraction.mockReset().mockResolvedValue(HELLO)
    dir = await mkdtemp(path.join(os.tmpdir(), 'gemini-asr-test-'))
    audio = path.join(dir, 'voice.mp3')
    await writeFile(audio, Buffer.from('mp3'))
  })

  afterEach(async () => {
    await rm(dir, { force: true, recursive: true })
  })

  it('maps word timestamps to the transcript shape the pipeline reads', () => {
    expect(toTranscription(HELLO)).toEqual({
      languageCode: 'eng',
      languageProbability: 1,
      text: 'Hello world',
      words: [
        { end: 0.45, start: 0.1, text: 'Hello', type: 'word' },
        { end: 0.9, start: 0.5, text: 'world', type: 'word' },
      ],
    })
  })

  it('drops heard words without times or out of order, keeping their text', () => {
    const transcript = toTranscription(
      answer([
        ['Hello', '0.100s', '0.450s'],
        ['big', '', ''],
        ['early', '0.050s', '0.080s'],
        ['world', '0.500s', '0.900s'],
      ]),
    )
    expect(transcript.words.map((w) => [w.text, w.start, w.end])).toEqual([
      ['Hello', 0.1, 0.45],
      ['world', 0.5, 0.9],
    ])
    expect(transcript.text).toBe('Hello big early world')
  })

  it('asks the Interactions API for word timestamps, with the audio inline', async () => {
    await geminiTranscribeFile(audio)
    expect(mockCreateInteraction).toHaveBeenCalledWith({
      generation_config: {
        transcription_config: {
          language_codes: ['en-US'],
          mode: { timestamp_granularities: ['word'], type: 'verbatim' },
        },
      },
      input: [
        { data: Buffer.from('mp3').toString('base64'), mime_type: 'audio/mp3', type: 'audio' },
      ],
      model: 'gemini-3.5-transcribe',
      store: false,
    })
    expect(mockUpload).not.toHaveBeenCalled()
  })

  it('aligns known text with the heard words', async () => {
    expect(await geminiForcedAlignment(audio, 'Hello world')).toEqual({
      characters: [],
      words: [
        { end: 0.45, start: 0.1, text: 'Hello' },
        { end: 0.9, start: 0.5, text: 'world' },
      ],
    })
  })

  it('keeps the script words where Gemini heard them differently', async () => {
    mockCreateInteraction.mockResolvedValue(
      answer([
        ['It', '0s', '0.2s'],
        ['is', '0.25s', '0.4s'],
        ['3,000', '0.5s', '1.1s'],
        ['years', '1.2s', '1.5s'],
        ['old.', '1.55s', '1.9s'],
      ]),
    )
    expect((await geminiForcedAlignment(audio, 'It is three thousand years old.')).words).toEqual([
      { end: 0.2, start: 0, text: 'It' },
      { end: 0.4, start: 0.25, text: 'is' },
      { end: 0.8, start: 0.5, text: 'three' },
      { end: 1.1, start: 0.8, text: 'thousand' },
      { end: 1.5, start: 1.2, text: 'years' },
      { end: 1.9, start: 1.55, text: 'old.' },
    ])
  })
})
