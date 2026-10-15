import fs from 'node:fs'

import { transcodeAudioInPlace } from '@agent-lib/agents/story-loader/voice-tools/utils/audio-pause-removal.util'
import { generateASRTranscription } from '@reelmakeeasy/common/asr/elevenlabs'
import { logger } from '@reelmakeeasy/common/logger'
import { VoiceCloneOptions } from '@reelmakeeasy/common/tts/minimax-text'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  deleteStoredFile,
  isStoreUri,
  keyIsUnder,
  storedFileExists,
  storedFileUrl,
  storeKeyOf,
  storeUri,
  uploadBufferToStore,
} from '@reelmakeeasy/common/storage/stored-files'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { BadRequestException } from '@nestjs/common'
import ffmpeg from 'fluent-ffmpeg'

import type { PrismaService } from '../prisma/prisma.service'
import { isStoreKey } from '@reelmakeeasy/common/storage/address'

/** ElevenLabs IVC per-file limit (~11 MB). */
export const MAX_CLONE_BYTES = 11_000_000
// Allowlist the exact shape uploadVoiceCloneFile generates -
const VOICE_CLONE_SOURCE_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,79}-voice-sample\.[a-z0-9]{2,5}$/

// MiniMax accent clone hard upper limit is 8s; keep a conservative ~500ms margin
// so mp3 container drift never pushes the produced file past 8s. This budget
// covers the spoken segment PLUS the trailing silence appended below.
const MINIMAX_ACCENT_PROMPT_MAX_SECONDS = 7.5
// Word gap above this is treated as a natural pause and preferred as a cut point.
const MINIMAX_ACCENT_PROMPT_PAUSE_SECONDS = 0.2
// Tail fade-out applied to the accent prompt audio to avoid an audible click at the cut.
const MINIMAX_ACCENT_PROMPT_FADE_OUT_SECONDS = 0.1
// A hard cut ending on a spoken word (often a sibilant) makes MiniMax
// "extend" the cloned voice with a hallucinated hiss ~0.5s after every sentence at
// synthesis time. Appending real trailing silence gives a clear end-of-utterance
// signal and removes the hiss; the 0.1s fade alone was insufficient.
const MINIMAX_ACCENT_PROMPT_TRAILING_SILENCE_SECONDS = 0.4
// The spoken segment must leave room for the trailing silence inside the 8s budget.
const MINIMAX_ACCENT_PROMPT_SPEECH_MAX_SECONDS =
  MINIMAX_ACCENT_PROMPT_MAX_SECONDS - MINIMAX_ACCENT_PROMPT_TRAILING_SILENCE_SECONDS

interface AccentPromptBoundary {
  cutoffSeconds: number
  reason: 'long_pause' | 'sentence_end' | 'word_end'
  text: string
}

interface AsrWord {
  end?: number
  start?: number
  text?: string
  type?: string
}

/** Transcode audio to fit under the ElevenLabs file-size limit. */
export function convertToMp3(
  inputPath: string,
  outputPath: string,
  options: {
    bitrateKbps: number
    channels: number
    sampleRate: number
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .toFormat('mp3')
      .audioBitrate(`${options.bitrateKbps}k`)
      .audioChannels(options.channels)
      .audioFrequency(options.sampleRate)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .save(outputPath)
  })
}

export async function createMiniMaxAccentPrompt(
  audioPath: string,
  fileId: string,
  userId: string,
): Promise<undefined | VoiceCloneOptions['clonePrompt']> {
  const promptPath = getMiniMaxAccentPromptPath(audioPath)

  try {
    // MiniMax conditions synthesis on the accent prompt's audio + prompt_text, so
    // the clip must align and end cleanly: a mid-word cut or an abrupt spoken-word
    // ending makes MiniMax hallucinate filler at synthesis ("punto",
    // sentence-end hiss). ASR the upload, cut on a natural boundary in the
    // window, then append trailing silence (see extractAudioSegmentToMp3).
    const asrResult = await generateASRTranscription(audioPath)
    const boundary = pickAccentPromptBoundary(asrResult.words ?? [])

    if (!boundary) {
      logger.warn(
        { fileId, userId },
        '[VoiceClone] No usable accent prompt boundary in window; cloning without clone_prompt',
      )
      return undefined
    }

    await extractAudioSegmentToMp3(audioPath, promptPath, {
      bitrateKbps: 128,
      channels: 1,
      durationSeconds: boundary.cutoffSeconds,
      fadeOutSeconds: MINIMAX_ACCENT_PROMPT_FADE_OUT_SECONDS,
      sampleRate: 44100,
      trailingSilenceSeconds: MINIMAX_ACCENT_PROMPT_TRAILING_SILENCE_SECONDS,
    })

    const promptText = normalizeMiniMaxPromptText(boundary.text)
    if (!promptText) {
      unlinkTempFile(promptPath, '[VoiceClone] Failed to delete empty MiniMax prompt file')
      logger.warn(
        { fileId, userId },
        '[VoiceClone] MiniMax accent prompt transcript was empty; cloning without clone_prompt',
      )
      return undefined
    }

    logger.info(
      {
        fileId,
        userId,
        cutoffSeconds: boundary.cutoffSeconds,
        cutReason: boundary.reason,
        promptTextLength: promptText.length,
      },
      '[VoiceClone] Created MiniMax accent optimization prompt',
    )

    return {
      audioFile: promptPath,
      text: promptText,
    }
  } catch (error) {
    unlinkTempFile(promptPath, '[VoiceClone] Failed to delete failed MiniMax prompt file')
    logger.warn(
      {
        fileId,
        userId,
        err: ensureError(error).message,
      },
      '[VoiceClone] Failed to create MiniMax accent prompt; cloning without clone_prompt',
    )
    return undefined
  }
}

/**
 * Build the ffmpeg audio filter chain for an accent prompt clip: trim to the
 * chosen segment, fade the cut to avoid a click, then append real trailing
 * silence so MiniMax does not hallucinate a hiss at sentence ends.
 */
export function buildAccentPromptAudioFilters(options: {
  durationSeconds: number
  fadeOutSeconds?: number
  trailingSilenceSeconds?: number
}): string[] {
  const filters = [`atrim=end=${options.durationSeconds}`]
  if (options.fadeOutSeconds && options.fadeOutSeconds > 0) {
    const fadeStart = Math.max(0, options.durationSeconds - options.fadeOutSeconds)
    filters.push(`afade=t=out:st=${fadeStart}:d=${options.fadeOutSeconds}`)
  }
  if (options.trailingSilenceSeconds && options.trailingSilenceSeconds > 0) {
    filters.push(`apad=pad_dur=${options.trailingSilenceSeconds}`)
  }
  return filters
}

export function extractAudioSegmentToMp3(
  inputPath: string,
  outputPath: string,
  options: {
    bitrateKbps: number
    channels: number
    durationSeconds: number
    fadeOutSeconds?: number
    sampleRate: number
    startSeconds?: number
    trailingSilenceSeconds?: number
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .setStartTime(options.startSeconds ?? 0)
      // Cap output so ffmpeg stops decoding the (possibly minutes-long) source
      // early. Must include the trailing silence so apad's padding is not truncated.
      .duration(options.durationSeconds + (options.trailingSilenceSeconds ?? 0))
      .audioFilters(buildAccentPromptAudioFilters(options))
      .toFormat('mp3')
      .audioBitrate(`${options.bitrateKbps}k`)
      .audioChannels(options.channels)
      .audioFrequency(options.sampleRate)
      .on('end', () => resolve())
      .on('error', (err: Error) => reject(err))
      .save(outputPath)
  })
}

export async function generateSignedUrl(voiceId: string) {
  const reqCtx = getReqContext()
  const loginId = reqCtx.login_id
  try {
    const previewKey = `voice-clones/${loginId}/previews/preview-${voiceId}.mp3`
    const exists = await storedFileExists(storeUri(previewKey))
    if (!exists) {
      throw new BadRequestException('Voice clone preview not found')
    }

    // The served URL of the stored preview (no CORS/COEP issues).
    const cdnUrl = storedFileUrl(previewKey)
    logger.info(
      `[VoiceClone] Using CDN URL - voiceId=${voiceId} userId=${loginId} cdnUrl=${cdnUrl}`,
    )
    return {
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // CDN URLs don't expire
      signedUrl: cdnUrl,
    }
  } catch (error) {
    const err = ensureError(error)
    logger.error(
      `[VoiceClone] Failed to generate URL - voiceId=${voiceId} userId=${loginId} error=${err.message}`,
    )
    throw new BadRequestException('Failed to generate playback URL')
  }
}

export function getAudioDuration(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: Error | null, metadata: ffmpeg.FfprobeData) => {
      if (err) {
        reject(err)
      } else {
        const duration = metadata.format.duration || 0
        resolve(duration)
      }
    })
  })
}

export function getMimeTypeFromExtension(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'm4a': {
      return 'audio/m4a'
    }
    case 'mp3': {
      return 'audio/mpeg'
    }
    case 'wav': {
      return 'audio/wav'
    }
    case 'webm': {
      return 'audio/webm'
    }
    default: {
      return 'audio/mpeg'
    }
  }
}

export async function transcodeIfOverLimit(
  tempFilePath: string,
  fileId: string,
  userId: string,
): Promise<void> {
  try {
    const post = await fs.promises.stat(tempFilePath)
    if (post.size <= MAX_CLONE_BYTES) {
      return
    }

    logger.info(
      {
        fileId,
        userId,
        mbBefore: Number((post.size / (1024 * 1024)).toFixed(3)),
        action: 'transcode-to-reduce-size',
      },
      'File exceeds 11MB after isolation, attempting transcode',
    )

    // Try progressively lower bitrates until under limit or attempts exhausted
    // The kbps can not be less than 128 (asked by ElevenLabs)
    const bitrates = [192, 160, 128]
    for (const br of bitrates) {
      await transcodeAudioInPlace(tempFilePath, {
        bitrateKbps: br,
        channels: 1,
        codec: 'libmp3lame',
        sampleRate: 44100,
      })
      const st = await fs.promises.stat(tempFilePath)
      const mb = Number((st.size / (1024 * 1024)).toFixed(3))
      logger.info({ fileId, userId, mbAfter: mb, bitrateKbpsTried: br }, 'Transcode result')
      if (st.size <= MAX_CLONE_BYTES) {
        break
      }
    }
  } catch (e) {
    logger.debug({ fileId, userId, err: ensureError(e) }, 'Transcode stat failed')
  }
}

/**
 * Delete the raw voice sample the user uploaded, once cloning has reached a
 * conclusive result. The sample is training input only - the voice itself lives
 * provider-side keyed by the returned voiceId - so retaining it keeps user voice
 * biometrics around for no functional reason.
 *
 * CURRENTLY UNCALLED, ON PURPOSE. Clone-time deletion is suspended while voices are being
 * migrated between providers: a migration has to re-submit the original audio, so a clone
 * whose sample has been deleted cannot be migrated. Kept rather than deleted so that
 * re-enabling is a one-line change in `releaseVoiceCloneSource`
 * (voice-clones.service.ts). Do not remove it as dead code.
 *
 * The BytePlus (Seed Audio) exemption that used to guard this is gone. That
 * provider's clones were zero-shot, so the stored file WAS the voice model and deleting it
 * bricked the voice; no clone path creates such voices any more, so when deletion is
 * re-enabled no provider needs to be exempt.
 *
 * Best-effort by design: a failure here must never fail the user's clone request.
 */
export async function deleteVoiceCloneSourceAudio(userId: string, fileId: string): Promise<void> {
  const fileUri = resolveVoiceCloneSourceUri(userId, fileId)
  if (!fileUri) {
    return
  }
  try {
    await deleteStoredFile(fileUri)
    logger.info({ fileId, fileUri, userId }, '[VoiceClone] Deleted uploaded voice sample')
  } catch (error) {
    logger.warn(
      { fileId, fileUri, userId, err: ensureError(error).message },
      '[VoiceClone] Failed to delete uploaded voice sample',
    )
  }
}

/**
 * Drop one stored file belonging to a deleted voice clone. Existence is checked
 * first so the common no-op stays silent. Note that while clone-time deletion is suspended
 * for the provider migration the source sample is normally still present here, so this is
 * the path that actually removes it.
 *
 * Best-effort by design: deleting a voice must succeed even when storage does not.
 */
export async function deleteVoiceCloneArtifact(
  fileUri: string,
  context: { userId: string; voiceId: string },
): Promise<void> {
  try {
    if (!(await storedFileExists(fileUri))) {
      return
    }
    await deleteStoredFile(fileUri)
    logger.info({ ...context, fileUri }, '[VoiceClone] Deleted voice clone artifact')
  } catch (error) {
    logger.warn(
      { ...context, fileUri, err: ensureError(error).message },
      '[VoiceClone] Failed to delete voice clone artifact',
    )
  }
}

/**
 * Resolve a stored `originalSource` to its store address, or null when it does not name a
 * file this user owns. Rows carry one of three shapes depending on when they were
 * written: a bare fileId, a key under `voice-clones/...`, or a full `store://` address.
 *
 * SECURITY: `originalSource` is NOT trusted input. The save endpoints take `fileId`
 * straight from the request body and persist it verbatim (`voice-clones.controller.ts:94`),
 * so it can name any file the caller likes. Every shape is therefore parsed to a checked
 * key (the parser refuses `..`, hidden and empty segments) and must lie under the caller's
 * own `voice-clones/{userId}/` folder; anything else resolves to null. Without that check,
 * a crafted fileId would turn deleting your own voice into a delete of someone else's file.
 */
export function resolveVoiceCloneSourceUri(userId: string, originalSource: string): null | string {
  const source = originalSource.trim()
  if (!source) {
    return null
  }

  const ownerFolder = `voice-clones/${userId}`
  let key: string | undefined
  if (isStoreUri(source)) {
    key = storeKeyOf(source)
  } else if (source.includes('://')) {
    // An http(s) URL or another scheme: not ours to touch.
    return null
  } else {
    const candidate = source.startsWith('voice-clones/') ? source : `${ownerFolder}/${source}`
    key = isStoreKey(candidate) ? candidate : undefined
  }

  if (!key || !keyIsUnder(key, ownerFolder)) {
    return null
  }
  return storeUri(key)
}

/**
 * `originalSource` arrives verbatim from the request body (the save endpoints pass
 * `body.fileId` straight through), so a crafted value could name another user's voice sample
 * - which the BytePlus synthesis path would then imitate. Accept only the bare filename
 * `uploadVoiceCloneFile` generates; see VOICE_CLONE_SOURCE_SHAPE.
 *
 * Shape alone is sufficient: a name restricted to [A-Za-z0-9-] plus one extension has no
 * separator, no traversal and no scheme, so it can only ever resolve inside the caller's own
 * `voice-clones/{userId}/` prefix.
 *
 * Deliberately does NOT probe storage for the object. When clone-time deletion was in force the sample was
 * already deleted by save time, so an existence check would have rejected every legitimate
 * save. Clone-time deletion is suspended on some paths
 * and the object usually does still exist, but the probe stays out: shape validation
 * is what closes the crafted-source hole, an existence check adds a storage round trip per save, and it would
 * become a live rejection path again the moment deletion is re-enabled. If existence ever
 * needs verifying, do it at upload or temporary-clone time.
 */
export function assertOwnedVoiceCloneSource(
  originalSource: null | string | undefined,
  userId: string,
): void {
  if (!originalSource) {
    return
  }
  if (!VOICE_CLONE_SOURCE_SHAPE.test(originalSource)) {
    logger.warn({ userId }, '[VoiceClone] Rejected non-bare voice sample reference')
    throw new BadRequestException('Invalid voice sample reference')
  }
}

export function unlinkTempFile(filePath: string, message: string): void {
  try {
    fs.unlinkSync(filePath)
  } catch (error) {
    logger.warn({ filePath, err: ensureError(error).message }, message)
  }
}

function getMiniMaxAccentPromptPath(audioPath: string): string {
  return audioPath.replace(/(\.[^.]+)?$/, '.minimax-accent-prompt.mp3')
}

// The accent prompt is cut on a pause/word boundary, so the audio ends
// on a clean spoken word with no terminal punctuation. Appending (or keeping) a
// trailing '.'/',' leaves a prompt_text token with no acoustic counterpart,
// which primes MiniMax to verbalize sentence-final periods as the literal word
// "punto"/"dot" during synthesis. End prompt_text on the last spoken word.
export function normalizeMiniMaxPromptText(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  return normalized.replace(/[\s.,;:!?。！？、，；：]+$/u, '').trim()
}

/**
 * Pick the best cut point for the MiniMax accent prompt within the allowed
 * window. Priority: sentence-final punctuation > word followed by a long pause
 * > last word boundary. Returns undefined when no word lands in the window
 * (caller skips clone_prompt).
 */
export function pickAccentPromptBoundary(words: AsrWord[]): AccentPromptBoundary | undefined {
  const wordTokens = words.filter(
    (w): w is AsrWord & { end: number; text: string } =>
      w.type === 'word' && typeof w.end === 'number' && !!w.text?.trim(),
  )
  const eligible = wordTokens.filter((w) => w.end <= MINIMAX_ACCENT_PROMPT_SPEECH_MAX_SECONDS)
  if (eligible.length === 0) {
    return undefined
  }

  const buildText = (upToIndex: number) =>
    wordTokens
      .slice(0, upToIndex + 1)
      .map((w) => w.text.trim())
      .join(' ')
      .trim()

  // 1) Last word in window ending with sentence-final punctuation.
  for (let i = eligible.length - 1; i >= 0; i--) {
    if (/[.!?。！？]$/.test(eligible[i].text.trim())) {
      const idx = wordTokens.indexOf(eligible[i])
      return { cutoffSeconds: eligible[i].end, reason: 'sentence_end', text: buildText(idx) }
    }
  }

  // 2) Last word in window followed by a >= MINIMAX_ACCENT_PROMPT_PAUSE_SECONDS gap.
  for (let i = eligible.length - 1; i >= 0; i--) {
    const w = eligible[i]
    const idx = wordTokens.indexOf(w)
    const next = wordTokens[idx + 1]
    if (
      next &&
      typeof next.start === 'number' &&
      next.start - w.end >= MINIMAX_ACCENT_PROMPT_PAUSE_SECONDS
    ) {
      return { cutoffSeconds: w.end, reason: 'long_pause', text: buildText(idx) }
    }
  }

  // 3) Last word boundary inside the window.
  const last = eligible[eligible.length - 1]
  const idx = wordTokens.indexOf(last)
  return { cutoffSeconds: last.end, reason: 'word_end', text: buildText(idx) }
}

/** Stores a voice clone's preview at `voice-clones/<userId>/previews/preview-<voiceId>.mp3`. */
export async function uploadVoiceClonePreview(
  audioBuffer: Buffer,
  voiceId: string,
  userId: string,
): Promise<void> {
  const previewKey = `voice-clones/${userId}/previews/preview-${voiceId}.mp3`
  try {
    await uploadBufferToStore(audioBuffer, storeUri(previewKey))
    logger.info(`[VoiceClone] Stored preview - voiceId=${voiceId} key=${previewKey}`)
  } catch (uploadError) {
    const err = ensureError(uploadError)
    logger.error(
      `[VoiceClone] Failed to upload preview - voiceId=${voiceId} userId=${userId} error=${err.message}`,
    )
    throw uploadError
  }
}
