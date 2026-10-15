/**
 * Voice typing on Gemini: a short recording of the user speaking, turned into the text they
 * would have typed. It runs on Gemini Transcribe (`DICTATION_GEMINI_MODEL`,
 * gemini-3.5-transcribe by default, about $0.005 a minute) on the Interactions API, in its
 * `smart` mode: filler words dropped and punctuation added, ready for a text box
 * (`DICTATION_GEMINI_MODE=verbatim` keeps every word). Unlike caption timing
 * (gemini-transcribe.ts) it asks for no word times. The browser records WebM/Opus, which
 * Gemini doesn't take, so the audio is first made into a small 16 kHz mono MP3.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { type GoogleInteraction, modelOutput, runGoogle } from '@reelmakeeasy/llm'

import { runFfmpeg } from '../utils/cmdline'

export const DEFAULT_DICTATION_GEMINI_MODEL = 'gemini-3.5-transcribe'

export type DictationGeminiMode = 'smart' | 'verbatim'

export function dictationGeminiModel(env: NodeJS.ProcessEnv = process.env): string {
  return env['DICTATION_GEMINI_MODEL']?.trim() || DEFAULT_DICTATION_GEMINI_MODEL
}

/** `smart` (the default) tidies what was said; `verbatim` keeps every "um". */
export function dictationGeminiMode(env: NodeJS.ProcessEnv = process.env): DictationGeminiMode {
  return env['DICTATION_GEMINI_MODE']?.trim().toLowerCase() === 'verbatim' ? 'verbatim' : 'smart'
}

/** What the user said, as text ('' when nothing was said). */
export async function geminiDictate(audio: Buffer): Promise<string> {
  const mp3 = await toSpeechMp3(audio)
  const interaction = await runGoogle.createInteraction({
    generation_config: {
      transcription_config: {
        language_codes: ['en-US'],
        mode: { type: dictationGeminiMode() },
      },
    },
    input: [{ data: mp3.toString('base64'), mime_type: 'audio/mp3', type: 'audio' }],
    model: dictationGeminiModel(),
    store: false,
  })
  return dictationText(interaction)
}

/** The transcript's text blocks, joined and trimmed. */
export function dictationText(interaction: GoogleInteraction): string {
  return modelOutput(interaction)
    .filter((block) => block.type === 'text')
    .map((block) => block.text?.trim() ?? '')
    .filter(Boolean)
    .join(' ')
    .trim()
}

/** Any recording (the browser's WebM/Opus or MP4) as 16 kHz mono MP3: Gemini and fal both take it. */
export async function toSpeechMp3(audio: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'dictate-'))
  try {
    const input = path.join(dir, 'in.bin')
    const output = path.join(dir, 'speech.mp3')
    await writeFile(input, audio)
    await runFfmpeg(
      '-i',
      input,
      '-ac',
      '1',
      '-ar',
      '16000',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '64k',
      output,
    )
    return await readFile(output)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}
