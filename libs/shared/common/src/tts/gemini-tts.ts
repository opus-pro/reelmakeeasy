/**
 * Gemini TTS, the google provider's narration: one generateContent call per
 * text with a prebuilt voice (`speechConfig.voiceConfig.voice`). Gemini 3.8 TTS
 * answers with a 24 kHz mono WAV; raw 16-bit PCM (older models) is wrapped
 * here. Returned as MP3, the format the voiceover pipeline stores and stitches.
 */
import { inlineParts, runGoogle } from '@reelmakeeasy/llm'
import { assertGenerationReady, type ResolvedModel, resolveRole } from '@reelmakeeasy/llm/registry'

import { logger } from '../logger'

import { stripDeliveryMarkup } from './delivery-markup'
import { toMp3 } from './fal-tts'
import { geminiVoiceName } from './gemini-voices'

const SAMPLE_RATE = 24_000

/** Speech in a Gemini prebuilt voice (`gemini-kore`). Delivery tags are dropped, not read aloud. */
export async function geminiTextToSpeech(options: {
  text: string
  voiceId: string
}): Promise<{ audioBuffer: Buffer; model: string }> {
  // Gemini chosen in Setup without GEMINI_API_KEY: fail with why, never swap providers.
  assertGenerationReady()
  const voice = geminiVoiceName(options.voiceId)
  if (!voice) throw new Error(`Not a Gemini voice id: ${options.voiceId}`)
  const model = geminiTtsModel()
  const started = Date.now()
  const res = await runGoogle.generateContent(model.model, {
    contents: [{ parts: [{ text: stripDeliveryMarkup(options.text) }], role: 'user' }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: { voiceConfig: { voice } },
    },
  })
  const [part] = inlineParts(res, 'audio')
  const raw = Buffer.from(part?.data ?? '', 'base64')
  const wav = isWav(raw) ? raw : pcmToWav(raw, rateOf(part?.mimeType ?? ''))
  const audioBuffer = await toMp3(wav, 'speech.wav')
  logger.info(
    `[GeminiTTS] ${voice} speech ready in ${Date.now() - started}ms bytes=${audioBuffer.length}`,
  )
  return { audioBuffer, model: model.key }
}

/** The registry key Gemini speech uses, for logs and route metadata. */
export const geminiTtsModelName = (): string => geminiTtsModel().key

/** Wraps raw 16-bit little-endian mono PCM in a 44-byte WAV header. */
export function pcmToWav(pcm: Buffer, sampleRate = SAMPLE_RATE): Buffer {
  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

function geminiTtsModel(): ResolvedModel & { model: string } {
  const model = resolveRole('tts.gemini')
  if (model?.provider !== 'google' || !model.model)
    throw new Error(
      'roles["tts.gemini"] in reelmakeeasy.models.json must point at a Gemini TTS model (gemini-tts)',
    )
  return model as ResolvedModel & { model: string }
}

const isWav = (audio: Buffer): boolean => audio.subarray(0, 4).toString('ascii') === 'RIFF'

/** The sample rate in an `audio/L16;codec=pcm;rate=24000` MIME type. */
const rateOf = (mimeType: string): number => Number(/rate=(\d+)/.exec(mimeType)?.[1]) || SAMPLE_RATE
