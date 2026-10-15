/**
 * ElevenLabs voices without an ElevenLabs key: Eleven v3 hosted on fal
 * (`roles["tts.elevenlabs"]`). fal speaks only the ElevenLabs premade voices it
 * was checked with (`falElevenLabsVoice` in preset-voices.ts); a voice cloned on
 * a user's own ElevenLabs account needs ELEVENLABS_API_KEY.
 *
 * fal's Eleven v3 has no speed setting, so a speed other than 1 is applied
 * afterwards with FFmpeg (pitch unchanged). The result is always MP3.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { download, fal } from '@reelmakeeasy/llm/fal'
import { modelRegistry, resolveRole, roleKeyFor } from '@reelmakeeasy/llm/registry'

import { NEEDS_ELEVENLABS_KEY } from '../elevenlabs/key'
import { logger } from '../logger'
import { runFfmpeg } from '../utils/cmdline'

import { isMp3, toMp3 } from './fal-tts'
import { falElevenLabsVoice } from './preset-voices'

const FAL_TTS_TIMEOUT_MS = 600_000

export interface ElevenLabsViaFalInput {
  /** The script language (`en`), sent as `language_code`. */
  languageCode?: string
  /** 0.7 to 1.2, like ElevenLabs' own setting; 1 (the default) leaves the audio as is. */
  speed?: number
  /** 0 to 1; 0.5 when not given. */
  stability?: number
  text: string
  voiceId: string
  /** What to send as fal's `voice`; defaults to `falElevenLabsVoice(voiceId)`. */
  voiceName?: string
}

interface FalAudioOutput {
  audio?: { content_type?: string; url?: string }
}

/** The registry key of the fal model, for logs and the preview response. */
export function elevenLabsFalModelName(): string {
  return elevenLabsFalModel().key
}

/**
 * Whether a model name is the fal model, e.g. one a preview saved while no key was set.
 * Reads fal's role map, whatever the generation provider, and never throws, so callers with
 * ELEVENLABS_API_KEY work with an older models file too.
 */
export function isElevenLabsFalModel(name: string): boolean {
  try {
    return roleKeyFor(modelRegistry(), 'tts.elevenlabs', 'fal') === name
  } catch {
    return false
  }
}

/** MP3 speech in an ElevenLabs premade voice, made on fal. */
export async function generateElevenLabsViaFal(input: ElevenLabsViaFalInput): Promise<Buffer> {
  const voice = input.voiceName ?? falElevenLabsVoice(input.voiceId)
  if (!voice) {
    throw new Error(`fal can't speak ElevenLabs voice ${input.voiceId}. ${NEEDS_ELEVENLABS_KEY}`)
  }
  const model = elevenLabsFalModel()
  const { data, requestId } = await fal.subscribe<FalAudioOutput>(model.endpoint, {
    input: {
      ...(input.languageCode ? { language_code: input.languageCode } : {}),
      stability: input.stability ?? 0.5,
      text: input.text,
      voice,
      ...model.input,
    },
    timeout: FAL_TTS_TIMEOUT_MS,
  })
  const audio = data.audio
  if (!audio?.url) throw new Error(`fal ${model.endpoint} returned no audio (request ${requestId})`)
  const raw = await download(audio.url)
  const mp3 = isMp3(audio.content_type, audio.url) ? raw : await toMp3(raw, audio.url)
  logger.info(`[ElevenLabsFal] speech ready request=${requestId} voiceId=${input.voiceId}`)
  return applySpeed(mp3, input.speed)
}

async function applySpeed(audio: Buffer, speed: number | undefined): Promise<Buffer> {
  if (speed === undefined || Math.abs(speed - 1) < 0.01) return audio
  const dir = await mkdtemp(path.join(os.tmpdir(), 'elevenlabs-fal-'))
  const input = path.join(dir, 'in.mp3')
  const output = path.join(dir, 'out.mp3')
  try {
    await writeFile(input, audio)
    await runFfmpeg(
      '-i',
      input,
      '-filter:a',
      `atempo=${speed}`,
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '192k',
      output,
    )
    return await readFile(output)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

function elevenLabsFalModel(): { endpoint: string; input: Record<string, unknown>; key: string } {
  const model = resolveRole('tts.elevenlabs')
  if (model?.provider !== 'fal' || !model.endpoint) {
    throw new Error(
      'roles["tts.elevenlabs"] in reelmakeeasy.models.json must be a fal model with endpoints.generate: without ELEVENLABS_API_KEY, ElevenLabs voices run on fal',
    )
  }
  return { endpoint: model.endpoint, input: model.input, key: model.key }
}
