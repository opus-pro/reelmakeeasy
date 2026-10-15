/**
 * ElevenLabs speech to text (Scribe v2) and forced alignment hosted on fal, used
 * when ELEVENLABS_API_KEY isn't set. Endpoints come from the model registry
 * (`roles["speech.transcribe"]`, `roles["speech.align"]`). Results are mapped to
 * the shapes the direct ElevenLabs client returns, so callers can't tell them apart.
 */
import { fal } from '@reelmakeeasy/llm'
import { resolveRole } from '@reelmakeeasy/llm/registry'

import type {
  ForcedAlignmentResponseModel,
  SpeechToTextChunkResponseModel,
  SpeechToTextWordResponseModel,
} from '../elevenlabs/client'
import { logger } from '../logger'

const FAL_ASR_TIMEOUT_MS = 600_000

export interface FalScribeOutput {
  language_code?: string
  language_probability?: number
  text?: string
  words?: FalScribeWord[]
}

export interface FalScribeWord {
  end?: number
  speaker_id?: string
  start?: number
  text: string
  type: SpeechToTextWordResponseModel['type']
}

/** Same defaults as the direct API: no speaker labels, audio events tagged. */
export interface FalSpeechToTextOptions {
  diarize?: boolean
  languageCode?: string
  tagAudioEvents?: boolean
}

interface FalAlignmentOutput {
  characters?: ForcedAlignmentResponseModel['characters']
  loss?: number
  words?: ForcedAlignmentResponseModel['words']
}

/** Word and character timings for a known script. */
export async function falForcedAlignment(
  audio: Blob,
  text: string,
): Promise<ForcedAlignmentResponseModel> {
  const model = falAsrModel('speech.align')
  const { data, requestId } = await fal.subscribe<FalAlignmentOutput>(model.endpoint, {
    input: { audio_url: await uploadAudio(audio), text, ...model.input },
    timeout: FAL_ASR_TIMEOUT_MS,
  })
  logger.info(`[FalScribe] forced alignment ready request=${requestId}`)
  return {
    characters: data.characters ?? [],
    ...(data.loss === undefined ? {} : { loss: data.loss }),
    words: data.words ?? [],
  }
}

/** A word-timed transcript, like ElevenLabs `speech-to-text`. */
export async function falSpeechToText(
  audio: Blob,
  options: FalSpeechToTextOptions = {},
): Promise<SpeechToTextChunkResponseModel> {
  const model = falAsrModel('speech.transcribe')
  const { data, requestId } = await fal.subscribe<FalScribeOutput>(model.endpoint, {
    input: {
      audio_url: await uploadAudio(audio),
      diarize: options.diarize ?? false,
      ...(options.languageCode ? { language_code: options.languageCode } : {}),
      tag_audio_events: options.tagAudioEvents ?? true,
      ...model.input,
    },
    timeout: FAL_ASR_TIMEOUT_MS,
  })
  logger.info(`[FalScribe] transcription ready request=${requestId}`)
  return mapFalTranscription(data)
}

/** fal's snake_case Scribe output in the client's camelCase shape. */
export function mapFalTranscription(output: FalScribeOutput): SpeechToTextChunkResponseModel {
  return {
    languageCode: output.language_code ?? '',
    languageProbability: output.language_probability ?? 0,
    text: output.text ?? '',
    words: (output.words ?? []).map((word) => ({
      end: word.end,
      start: word.start,
      text: word.text,
      type: word.type,
      ...(word.speaker_id ? { speakerId: word.speaker_id } : {}),
    })),
  }
}

/** The audio container from its first bytes, so the upload gets a matching name and type. */
export function sniffAudioFile(bytes: Uint8Array): { ext: string; type: string } {
  const tag = (start: number, end: number) => String.fromCodePoint(...bytes.subarray(start, end))
  if (tag(0, 4) === 'RIFF' && tag(8, 12) === 'WAVE') return { ext: '.wav', type: 'audio/wav' }
  if (tag(0, 4) === 'OggS') return { ext: '.ogg', type: 'audio/ogg' }
  if (tag(0, 4) === 'fLaC') return { ext: '.flac', type: 'audio/flac' }
  if (tag(4, 8) === 'ftyp') return { ext: '.m4a', type: 'audio/mp4' }
  if (tag(0, 4) === '\u001AEß£') return { ext: '.webm', type: 'audio/webm' }
  // ID3 tags or a bare MPEG frame; MP3 is also what the voiceover pipeline stores.
  return { ext: '.mp3', type: 'audio/mpeg' }
}

function falAsrModel(role: 'speech.align' | 'speech.transcribe'): {
  endpoint: string
  input: Record<string, unknown>
} {
  const model = resolveRole(role)
  if (model?.provider !== 'fal' || !model.endpoint) {
    throw new Error(
      `roles["${role}"] in reelmakeeasy.models.json must be a fal model with endpoints.generate: without ELEVENLABS_API_KEY, caption timing runs on fal`,
    )
  }
  return { endpoint: model.endpoint, input: model.input }
}

async function uploadAudio(audio: Blob): Promise<string> {
  const bytes = new Uint8Array(await audio.arrayBuffer())
  const sniffed = sniffAudioFile(bytes)
  const name = audio instanceof File && audio.name ? audio.name : `audio${sniffed.ext}`
  return fal.storage.upload(new File([bytes], name, { type: audio.type || sniffed.type }))
}
