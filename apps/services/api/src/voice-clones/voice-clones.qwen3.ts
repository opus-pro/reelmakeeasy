/**
 * Qwen3-TTS user voices: cloned from uploaded or recorded speech, or designed
 * from a written description.
 *
 * A voice is its reference speech (24 kHz mono WAV) and the text spoken in it.
 * The local voice server synthesizes from those directly; fal needs a speaker
 * embedding, which is made from the reference audio the first time the voice
 * runs on fal (see @reelmakeeasy/common/tts/qwen3-voice). So creating a voice on a
 * machine with local voices costs nothing.
 *
 * Like the other providers, creating a voice is two steps: a temporary voice the
 * user auditions (`createFromSample` / `createFromDescription`), then `save`.
 * Files live in the user's `voice-clones/{userId}/qwen3/` folder:
 * `{voiceId}.wav` (reference), `{voiceId}.safetensors` (embedding, once made)
 * and `{voiceId}.json` (what save reads).
 */
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'

import { DEFAULT_ASR_MODEL_ID, speechToText } from '@reelmakeeasy/common/asr/elevenlabs'
import { logger } from '@reelmakeeasy/common/logger'
import {
  QWEN3_USER_VOICE_PREFIX,
  qwen3DesignVoiceSample,
  qwen3TextToSpeech,
  toReferenceWav,
} from '@reelmakeeasy/common/tts/fal-tts'
import { qwen3ReferenceAudioPath, qwen3VoiceReference } from '@reelmakeeasy/common/tts/qwen3-voice'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  downloadStoredFile,
  readStoredFile,
  storedFileExists,
  storeUri,
  uploadBufferToStore,
} from '@reelmakeeasy/common/storage/stored-files'
import { BadRequestException } from '@nestjs/common'

import { uploadVoiceClonePreview } from './voice-clones.utils'

const MAX_DESCRIPTION_LENGTH = 1000
const MAX_SAMPLE_TEXT_LENGTH = 400

/**
 * Qwen3-TTS clones from as little as 3 seconds, but 10 seconds of clean speech
 * is where the likeness holds up; fal's clone endpoint takes at most 5 minutes
 * (longer samples are trimmed).
 */
export const QWEN3_MIN_SAMPLE_SECONDS = 10

/**
 * ReelMakeEasy is English-only for now (caption fonts cover English only), so
 * every Qwen3 voice is designed and previewed in English. A sample recorded in
 * another language still clones; the voice then speaks English.
 */
const VOICE_LANGUAGE = 'en'

const DEFAULT_SAMPLE_TEXT =
  "Hi there! This is my new voice. I'm ready to narrate your next video, from the first frame to the last."

export interface Qwen3TemporaryVoice {
  previewPath: string
  provider: 'qwen3'
  referenceText?: string
  requestedProvider: 'qwen3'
  voiceId: string
}

interface TemporaryVoiceMeta {
  referenceText?: string
  speakerEmbeddingPath: string
}

const qwen3Dir = (userId: string) => storeUri(`voice-clones/${userId}/qwen3`)
const embeddingUri = (userId: string, voiceId: string) =>
  `${qwen3Dir(userId)}/${voiceId}.safetensors`
const metaUri = (userId: string, voiceId: string) => `${qwen3Dir(userId)}/${voiceId}.json`
const newVoiceId = () => `${QWEN3_USER_VOICE_PREFIX}${randomUUID()}`

/** Seconds of audio in a 16-bit mono WAV from `toReferenceWav`. */
const wavSeconds = (wav: Buffer) => Math.max(0, wav.length - 44) / (24_000 * 2)

/** Clones the voice in an uploaded or recorded sample (`voice-clones/{userId}/{fileId}`). */
export async function createQwen3VoiceFromSample(params: {
  fileId: string
  referenceText?: string
  userId: string
}): Promise<Qwen3TemporaryVoice> {
  const { fileId, userId } = params
  const sampleUri = storeUri(`voice-clones/${userId}/${fileId}`)
  const tempFilePath = `/tmp/qwen3-${randomUUID()}-${fileId.replace(/[^\w.-]/g, '_')}`
  try {
    await downloadStoredFile(sampleUri, tempFilePath)
    const referenceAudio = await toReferenceWav(await readFile(tempFilePath), fileId)
    if (wavSeconds(referenceAudio) < QWEN3_MIN_SAMPLE_SECONDS) {
      throw new BadRequestException(
        `Record at least ${QWEN3_MIN_SAMPLE_SECONDS} seconds of speech to clone a voice`,
      )
    }
    // What the sample says: Qwen3 clones far better with it. A caller-supplied transcript wins.
    const heard = await transcribe(tempFilePath)
    const referenceText = params.referenceText?.trim() || heard.text || undefined

    const voiceId = newVoiceId()
    const meta = await storeReference({ referenceAudio, referenceText, userId, voiceId })
    const preview = await qwen3TextToSpeech({
      languageCode: VOICE_LANGUAGE,
      speaker: { reference: qwen3VoiceReference(meta) },
      text: DEFAULT_SAMPLE_TEXT,
    })
    await uploadVoiceClonePreview(preview.audioBuffer, voiceId, userId)
    logger.info(
      { ranOn: preview.ranOn, userId, voiceId },
      '[VoiceClone] Qwen3 voice cloned from sample',
    )
    return temporaryVoice(userId, voiceId, referenceText)
  } catch (error) {
    throw toBadRequest(error, 'Qwen3 voice cloning failed')
  } finally {
    await rm(tempFilePath, { force: true })
  }
}

/** Designs a new voice from a written description; its spoken sample becomes the reference. */
export async function createQwen3VoiceFromDescription(params: {
  description: string
  sampleText?: string
  userId: string
}): Promise<Qwen3TemporaryVoice> {
  const description = params.description?.trim()
  if (!description) throw new BadRequestException('Describe the voice you want')
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw new BadRequestException(
      `The description must be ${MAX_DESCRIPTION_LENGTH} characters or less`,
    )
  }
  const sampleText = params.sampleText?.trim() || DEFAULT_SAMPLE_TEXT
  if (sampleText.length > MAX_SAMPLE_TEXT_LENGTH) {
    throw new BadRequestException(
      `The sample text must be ${MAX_SAMPLE_TEXT_LENGTH} characters or less`,
    )
  }
  try {
    const designed = await qwen3DesignVoiceSample({
      description,
      languageCode: VOICE_LANGUAGE,
      sampleText,
    })
    const voiceId = newVoiceId()
    // The designed sample is both the audition clip and the voice's reference speech.
    await storeReference({
      referenceAudio: await toReferenceWav(designed.audioBuffer, 'sample.mp3'),
      referenceText: sampleText,
      userId: params.userId,
      voiceId,
    })
    await uploadVoiceClonePreview(designed.audioBuffer, voiceId, params.userId)
    logger.info(
      { ranOn: designed.ranOn, userId: params.userId, voiceId },
      '[VoiceClone] Qwen3 voice designed',
    )
    return temporaryVoice(params.userId, voiceId, sampleText)
  } catch (error) {
    throw toBadRequest(error, 'Qwen3 voice design failed')
  }
}

/** The stored embedding and reference text of a temporary voice, for saving it. */
export async function readQwen3TemporaryVoice(
  userId: string,
  voiceId: string,
): Promise<TemporaryVoiceMeta> {
  if (!voiceId.startsWith(QWEN3_USER_VOICE_PREFIX)) {
    throw new BadRequestException('Not a Qwen3 voice')
  }
  const uri = metaUri(userId, voiceId)
  if (!(await storedFileExists(uri))) {
    throw new BadRequestException('Voice not found. Create it again.')
  }
  return JSON.parse((await readStoredFile(uri)).toString('utf8')) as TemporaryVoiceMeta
}

/** Stores a voice's reference speech and the metadata save reads. */
async function storeReference(params: {
  referenceAudio: Buffer
  referenceText?: string
  userId: string
  voiceId: string
}): Promise<TemporaryVoiceMeta> {
  const { referenceAudio, referenceText, userId, voiceId } = params
  const meta: TemporaryVoiceMeta = {
    speakerEmbeddingPath: embeddingUri(userId, voiceId),
    ...(referenceText ? { referenceText } : {}),
  }
  await Promise.all([
    uploadBufferToStore(referenceAudio, qwen3ReferenceAudioPath(meta.speakerEmbeddingPath)),
    uploadBufferToStore(Buffer.from(JSON.stringify(meta)), metaUri(userId, voiceId)),
  ])
  return meta
}

function temporaryVoice(
  userId: string,
  voiceId: string,
  referenceText?: string,
): Qwen3TemporaryVoice {
  return {
    previewPath: `voice-clones/${userId}/previews/preview-${voiceId}.mp3`,
    provider: 'qwen3',
    ...(referenceText ? { referenceText } : {}),
    requestedProvider: 'qwen3',
    voiceId,
  }
}

function toBadRequest(error: unknown, message: string): BadRequestException {
  if (error instanceof BadRequestException) return error
  const err = ensureError(error)
  logger.error({ err: err.message }, `[VoiceClone] ${message}`)
  return new BadRequestException(`${message}: ${err.message.split('\n')[0]}`)
}

/** What a sample says; empty when speech to text is unavailable. */
async function transcribe(filePath: string): Promise<{ text?: string }> {
  try {
    const result = await speechToText({
      file: new Blob([new Uint8Array(await readFile(filePath))]),
      modelId: DEFAULT_ASR_MODEL_ID,
    })
    return { text: result.text?.trim() || undefined }
  } catch (error) {
    logger.warn(
      { err: ensureError(error).message },
      '[VoiceClone] Could not transcribe the Qwen3 sample; cloning from audio alone',
    )
    return {}
  }
}
