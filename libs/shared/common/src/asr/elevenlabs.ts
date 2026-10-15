import { readFile } from 'node:fs/promises'

import { resolveRole } from '@reelmakeeasy/llm/registry'

import { ElevenLabsClient, type SpeechToTextRequest } from '../elevenlabs/client'
import { ForcedAlignmentResponseModel, SpeechToTextChunkResponseModel } from '../elevenlabs/client'
import { elevenLabsApiKey } from '../elevenlabs/key'
import { logger } from '../logger'
import { ensureError } from '../utils/error-handler'

import {
  asrBackend,
  type CloudAsrBackend,
  resolveAsrBackend,
  type ResolveAsrBackendOptions,
} from './asr-backend'
import { falForcedAlignment, falSpeechToText } from './fal-scribe'
import { geminiForcedAlignment, geminiTranscribeBlob } from './gemini-transcribe'
import { localForcedAlignment, localSpeechToText, type LocalTimingSource } from './local-asr'

export const DEFAULT_ASR_MODEL_ID = 'scribe_v2'

/** Who timed a script's words: the local aligner or local Whisper, else the cloud backend. */
export type TimingSource = CloudAsrBackend | LocalTimingSource

/** Word timings for a known script, and who made them (callers check each kind differently). */
export interface TimedAlignment extends ForcedAlignmentResponseModel {
  source: TimingSource
}

/**
 * The ElevenLabs model id for text to speech, from `roles.tts` in the model
 * registry (`eleven_v3` by default). Throws when that role isn't an ElevenLabs model.
 */
export function elevenLabsTtsModelId(): string {
  const model = resolveRole('tts')
  if (model?.provider !== 'elevenlabs' || !model.model) {
    throw new Error(
      'roles.tts in reelmakeeasy.models.json must point at an ElevenLabs model with a `model` id',
    )
  }
  return model.model
}

let clientSingleton: ElevenLabsClient | null = null
const getElevenLabsClient = () => {
  if (clientSingleton) {
    return clientSingleton
  }
  const apiKey = elevenLabsApiKey()
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set in environment')
  }
  clientSingleton = new ElevenLabsClient({ apiKey })
  return clientSingleton
}

/**
 * A word-timed transcript of a voiceover, with speaker labels and audio events
 * for the quality checks.
 */
export async function generateASRTranscription(
  voiceOverPath: string,
): Promise<SpeechToTextChunkResponseModel> {
  const audioFileBuffer = await readFile(voiceOverPath)
  return speechToText({
    diarize: true,
    file: new Blob([audioFileBuffer]),
    modelId: DEFAULT_ASR_MODEL_ID,
    tagAudioEvents: true,
  })
}

/**
 * Speech to text: local Whisper on this computer when it's installed, else ElevenLabs
 * directly with ELEVENLABS_API_KEY, else Gemini Transcribe when Gemini makes the voices
 * (google), else Scribe v2 hosted on fal. All four return the same shape. A request for
 * speaker labels or audio events (the voice-quality checks) stays on ElevenLabs when its
 * key is set, since Whisper gives neither.
 */
export async function speechToText(
  request: SpeechToTextRequest,
  requestOptions?: unknown,
): Promise<SpeechToTextChunkResponseModel> {
  return localFirst<SpeechToTextChunkResponseModel>(
    'speech to text',
    { forQualityChecks: request.diarize === true || request.tagAudioEvents === true },
    () => localSpeechToText(request.file, { languageCode: request.languageCode }),
    async (backend) => {
      switch (backend) {
        case 'elevenlabs': {
          return getElevenLabsClient().speechToText.convert(request, requestOptions)
        }
        case 'fal': {
          return falSpeechToText(request.file, {
            diarize: request.diarize,
            languageCode: request.languageCode,
            tagAudioEvents: request.tagAudioEvents,
          })
        }
        case 'google': {
          return geminiTranscribeBlob(request.file)
        }
      }
    },
  )
}

/**
 * Align a known text transcript to an audio file: the local aligner (or local Whisper)
 * when it's installed, else ElevenLabs Forced Alignment (directly with the key, else on
 * fal), or, when Gemini makes the voices, the script's words laid over Gemini
 * Transcribe's word timings. Returns word-level timestamps and who made them.
 */
export async function generateForcedAlignment(
  audioPath: string,
  text: string,
): Promise<TimedAlignment> {
  const audio = async () => new Blob([await readFile(audioPath)])
  return localFirst<TimedAlignment>(
    'alignment',
    {},
    async () => localForcedAlignment(await audio(), text),
    async (backend) => {
      switch (backend) {
        case 'elevenlabs': {
          const file = await audio()
          return {
            ...(await getElevenLabsClient().forcedAlignment.create({ file, text })),
            source: backend,
          }
        }
        case 'fal': {
          return { ...(await falForcedAlignment(await audio(), text)), source: backend }
        }
        case 'google': {
          return { ...(await geminiForcedAlignment(audioPath, text)), source: backend }
        }
      }
    },
  )
}

/**
 * Runs `local` when speech to text runs on this computer, else `cloud` on the cloud
 * backend. Like `tryLocal` for voices, a local failure falls back to the cloud; a local
 * result is returned as it is, so caption timing that fails its checks never leads to a
 * paid call. Without a cloud backend that can run, the local failure is what's reported.
 */
async function localFirst<T>(
  job: string,
  options: ResolveAsrBackendOptions,
  local: () => Promise<T>,
  cloud: (backend: CloudAsrBackend) => Promise<T>,
): Promise<T> {
  const backend = await resolveAsrBackend(options)
  if (backend !== 'local') return cloud(backend)
  let localError: Error
  try {
    return await local()
  } catch (error) {
    localError = ensureError(error)
  }
  let fallback: CloudAsrBackend
  try {
    fallback = asrBackend()
  } catch (setupError) {
    logger.warn(
      `[ASR] Local ${job} failed and no cloud backend can run: ${ensureError(setupError).message}`,
    )
    throw localError
  }
  logger.warn(`[ASR] Local ${job} failed, using ${fallback}: ${localError.message}`)
  return cloud(fallback)
}

export type { ForcedAlignmentResponseModel }
