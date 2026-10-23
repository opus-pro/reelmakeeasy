import fs from 'node:fs'
import path from 'node:path'

import { LLM } from '@reelmakeeasy/llm'
import { capabilitiesFor, resolveRole } from '@reelmakeeasy/llm/registry'

/** What the agent may ask the composer for. */
export const MUSIC_PROMPT_MAX = 800
export const MUSIC_BPM_MIN = 60
export const MUSIC_BPM_MAX = 180

/** Steers models without an instrumental switch (Lyria) away from voices and a hard stop. */
const NEGATIVE_PROMPT = 'vocals, singing, lyrics, spoken word, silence, abrupt ending'
/** Seconds asked for beyond the reel: room to pick the most energetic bars and fade out. */
const EXTRA_SEC = 8

export type ComposeRequest = { bpm?: number; prompt: string }

/** `motion_music`'s arguments, checked; a message saying what to fix otherwise. */
export function parseComposeRequest(raw: unknown): ComposeRequest | string {
  const args = (raw ?? {}) as Record<string, unknown>
  const prompt = typeof args['prompt'] === 'string' ? args['prompt'].trim() : ''
  if (!prompt) return 'Describe the music: genre, mood, instruments, and where it builds and drops.'
  if (prompt.length > MUSIC_PROMPT_MAX)
    return `Keep the description under ${MUSIC_PROMPT_MAX} characters.`
  const bpm = args['bpm']
  if (bpm === undefined) return { prompt }
  if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < MUSIC_BPM_MIN || bpm > MUSIC_BPM_MAX)
    return `bpm must be a whole number from ${MUSIC_BPM_MIN} to ${MUSIC_BPM_MAX}.`
  return { bpm, prompt }
}

/** The prompt as the model gets it: the tempo stated, always instrumental. */
export function composerPrompt(request: ComposeRequest): string {
  const parts = [request.prompt.replace(/\s+/g, ' ')]
  if (request.bpm && !new RegExp(`\\b${request.bpm}\\s*bpm\\b`, 'i').test(request.prompt))
    parts.push(`${request.bpm} BPM, steady tempo.`)
  if (!/instrumental/i.test(request.prompt)) parts.push('Instrumental, no vocals.')
  return parts.join(' ')
}

/**
 * Composes a track with the music model Setup picked (the registry's `music` role: ElevenLabs on
 * fal, or Lyria on Gemini) and saves it to `dir`. Asks for the reel's length plus a margin, as
 * far as the model goes. Returns the file and the model's own length limit, when it has one.
 */
export async function composeMusic(
  request: ComposeRequest,
  reelSec: number,
  dir: string,
): Promise<{ file: string; limitSec?: number; model: string }> {
  const model = resolveRole('music')
  if (!model) throw new Error('No music model is set up: open Setup and add a fal or Gemini key.')
  const caps = capabilitiesFor('music', model.key) as null | { maxDurationSec?: number }
  const durationSec = Math.min(Math.ceil(reelSec) + EXTRA_SEC, caps?.maxDurationSec ?? 120)
  const result = await LLM.generateAudio({
    durationSec,
    format: 'mp3',
    models: model.key,
    negativePrompt: NEGATIVE_PROMPT,
    prompt: composerPrompt(request),
    role: 'music',
    task: 'motion-reel-music',
  })
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `composed-${Date.now()}.mp3`)
  fs.writeFileSync(file, Buffer.from(result.audioBase64, 'base64'))
  return { file, ...(caps?.maxDurationSec ? { limitSec: caps.maxDurationSec } : {}), model: model.key }
}
