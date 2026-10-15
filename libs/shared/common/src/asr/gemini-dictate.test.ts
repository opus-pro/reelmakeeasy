const createInteraction = jest.fn()

jest.mock('@reelmakeeasy/llm', () => ({
  modelOutput: jest.requireActual('@reelmakeeasy/llm/google').modelOutput,
  runGoogle: { createInteraction: (...args: unknown[]) => createInteraction(...args) },
}))
jest.mock('../utils/cmdline', () => ({
  runFfmpeg: async (...args: string[]) => {
    const { writeFile } = await import('node:fs/promises')
    await writeFile(args[args.length - 1] as string, 'mp3 bytes')
  },
}))

import {
  DEFAULT_DICTATION_GEMINI_MODEL,
  dictationGeminiMode,
  dictationGeminiModel,
  dictationText,
  geminiDictate,
} from './gemini-dictate'

describe('Gemini voice typing', () => {
  const env = { ...process.env }
  afterEach(() => {
    process.env = { ...env }
    createInteraction.mockReset()
  })

  it('sends the recording to Gemini Transcribe in smart mode, with no word times', async () => {
    createInteraction.mockResolvedValue({
      steps: [
        {
          content: [{ text: ' I want to make a really calm video about the moon. ', type: 'text' }],
          type: 'model_output',
        },
      ],
    })
    expect(await geminiDictate(Buffer.from('webm'))).toBe(
      'I want to make a really calm video about the moon.',
    )
    expect(createInteraction).toHaveBeenCalledWith({
      generation_config: {
        transcription_config: { language_codes: ['en-US'], mode: { type: 'smart' } },
      },
      input: [
        {
          data: Buffer.from('mp3 bytes').toString('base64'),
          mime_type: 'audio/mp3',
          type: 'audio',
        },
      ],
      model: 'gemini-3.5-transcribe',
      store: false,
    })
  })

  it('reads only the text blocks of the model output', () => {
    expect(
      dictationText({
        steps: [
          { content: [{ text: 'thinking', type: 'thought' }], type: 'thought' },
          { content: [{ text: 'Make a video about cats.', type: 'text' }], type: 'model_output' },
        ],
      } as never),
    ).toBe('Make a video about cats.')
    expect(dictationText({ steps: [] } as never)).toBe('')
  })

  it('runs on gemini-3.5-transcribe in smart mode unless .env says otherwise', () => {
    expect(DEFAULT_DICTATION_GEMINI_MODEL).toBe('gemini-3.5-transcribe')
    expect(dictationGeminiModel({})).toBe('gemini-3.5-transcribe')
    expect(dictationGeminiModel({ DICTATION_GEMINI_MODEL: ' gemini-x ' })).toBe('gemini-x')
    expect(dictationGeminiMode({})).toBe('smart')
    expect(dictationGeminiMode({ DICTATION_GEMINI_MODE: 'Verbatim' })).toBe('verbatim')
    expect(dictationGeminiMode({ DICTATION_GEMINI_MODE: 'anything' })).toBe('smart')
  })
})
