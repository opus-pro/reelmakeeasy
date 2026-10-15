/**
 * Where a user's Qwen3 voice lives in storage, and how synthesis reads it.
 *
 * A voice is its reference speech (`{voiceId}.wav`, 24 kHz mono) plus the text
 * spoken in it, which is all local synthesis needs. fal needs a speaker
 * embedding (`{voiceId}.safetensors`) instead; it is made from the reference
 * audio the first time a voice is synthesized on fal, then kept beside it.
 * Voices made on fal before local synthesis existed have only the embedding.
 */
import { logger } from '../logger'
import { storedFileExists, readStoredFile, uploadBufferToStore } from '../storage/stored-files'

import { qwen3CloneVoice, type Qwen3VoiceReference, uploadQwen3Embedding } from './fal-tts'

export interface Qwen3VoiceRecord {
  referenceText?: string
  /** Storage path of the speaker embedding; the reference audio sits beside it. */
  speakerEmbeddingPath: string
}

export const qwen3ReferenceAudioPath = (speakerEmbeddingPath: string): string =>
  speakerEmbeddingPath.replace(/\.safetensors$/, '.wav')

// An embedding is uploaded to fal once per process and reused; fal CDN uploads
// outlive a voiceover run.
const embeddingUrls = new Map<string, Promise<string>>()

export function qwen3VoiceReference(record: Qwen3VoiceRecord): Qwen3VoiceReference {
  const embeddingPath = record.speakerEmbeddingPath
  const audioPath = qwen3ReferenceAudioPath(embeddingPath)
  return {
    audio: async () => ((await storedFileExists(audioPath)) ? readStoredFile(audioPath) : null),
    embeddingUrl: () => {
      let url = embeddingUrls.get(embeddingPath)
      if (!url) {
        url = loadOrCreateEmbedding(record).then(uploadQwen3Embedding)
        url.catch(() => embeddingUrls.delete(embeddingPath))
        embeddingUrls.set(embeddingPath, url)
      }
      return url
    },
    ...(record.referenceText ? { text: record.referenceText } : {}),
  }
}

async function loadOrCreateEmbedding(record: Qwen3VoiceRecord): Promise<Buffer> {
  const embeddingPath = record.speakerEmbeddingPath
  if (await storedFileExists(embeddingPath)) return readStoredFile(embeddingPath)
  const audioPath = qwen3ReferenceAudioPath(embeddingPath)
  if (!(await storedFileExists(audioPath))) {
    throw new Error(
      `Qwen3 voice has neither a speaker embedding nor reference audio (${embeddingPath})`,
    )
  }
  logger.info(`[Qwen3Voice] Making a fal speaker embedding from ${audioPath}`)
  const { embedding } = await qwen3CloneVoice({
    audio: await readStoredFile(audioPath),
    contentType: 'audio/wav',
    referenceText: record.referenceText,
  })
  await uploadBufferToStore(embedding, embeddingPath)
  return embedding
}
