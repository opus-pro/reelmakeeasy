import { copyFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { LLM } from '@reelmakeeasy/llm'
import { capabilitiesFor } from '@reelmakeeasy/llm/registry'

import { formatLogFields, getVideoDurationSeconds, logger } from '../common'

import { matchDurationLoopTrimFade } from './bgm-audio'
import { type BgmReportFields, directBgm, nameBgmTrack } from './bgm-director'
import { type BgmModel, selectBgmModel } from './bgm-model'

// Task label for the BGM LLM call; it names the call in the llm logs.
const BGM_LLM_TASK = 'story-mode-bgm'

/** Lyria has no instrumental switch: steer it away from voices and from a hard stop. */
export const BGM_NEGATIVE_PROMPT = 'vocals, singing, lyrics, spoken word, silence, abrupt ending'

export interface GeneratedBed {
  durationMs: number
  localPath: string
  model: BgmModel
  prompt: string
  /** The whole composition, before the fit to this video (saved to the user's music). */
  rawPath: string
  trackName: string
}

/**
 * BGM is always an instrumental bed under the voiceover (MS1 spec), but a
 * user-edited prompt may drop the director's closing "Instrumental." cue that
 * steers Lyria away from vocals -- restore it when missing.
 */
export function ensureInstrumentalPrompt(prompt: string): string {
  const trimmed = prompt.trim()
  return /instrumental/i.test(trimmed) ? trimmed : `${trimmed} Instrumental.`
}

/**
 * The testable core of BGM generation: report fields -> director prompt ->
 * Lyria clip -> duration-matched local mp3 + metadata. No activity context, no storage. The
 * caller supplies `workDir` and owns its lifecycle (create + cleanup), so the
 * bed file survives for upload and is removed regardless of success/failure.
 * `promptOverride` skips the director and uses the
 * user-edited Lyria prompt verbatim, with only a track name generated.
 */
export async function generateBed(
  fields: BgmReportFields,
  targetDurationSec: number,
  workDir: string,
  promptOverride?: string,
): Promise<GeneratedBed> {
  const director = promptOverride
    ? {
        prompt: ensureInstrumentalPrompt(promptOverride),
        trackName: await nameBgmTrack(promptOverride),
      }
    : await directBgm(fields)
  const model = selectBgmModel(targetDurationSec)
  // Ask for the video's length plus a tail to trim and fade; a 30 s-only model (Lyria) gets
  // its clip length and the bed is looped afterwards.
  const caps = capabilitiesFor('music', model) as null | { maxDurationSec?: number }
  const durationSec = Math.min(Math.ceil(targetDurationSec) + 2, caps?.maxDurationSec ?? 30)
  // The registry's music role via libs/llm -> fal: one call, no client-level
  // empty-audio retry -- an empty/failed generation throws and
  // the activity's retry policy (3 attempts) owns transient flakiness.
  let audioBase64: string
  try {
    const result = await LLM.generateAudio({
      durationSec,
      format: 'mp3',
      models: model,
      negativePrompt: BGM_NEGATIVE_PROMPT,
      prompt: director.prompt,
      role: 'music',
      ...('tags' in director && director.tags ? { tags: director.tags } : {}),
      task: BGM_LLM_TASK,
    })
    audioBase64 = result.audioBase64
  } catch (error) {
    // A user-edited override is the user's text, so only the director's own
    // prompt is logged; that is the path where the block is ours to fix.
    logger.warn(
      `[long-take] BGM Lyria generation failed ${formatLogFields({
        error: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        model,
        ...(promptOverride ? {} : { prompt: director.prompt }),
      })}`,
    )
    throw error
  }

  const localPath = path.join(workDir, 'bed.mp3')
  await writeFile(localPath, Buffer.from(audioBase64, 'base64'))
  // The composition as made, kept for the user's music: the fit below trims and fades it
  // for this video, and a faded copy would loop badly under a longer one.
  const rawPath = path.join(workDir, 'composed.mp3')
  await copyFile(localPath, rawPath)

  await matchDurationLoopTrimFade(localPath, targetDurationSec)
  const durationMs = Math.round((await getVideoDurationSeconds(localPath)) * 1000)

  return {
    durationMs,
    localPath,
    model,
    prompt: director.prompt,
    rawPath,
    trackName: director.trackName,
  }
}
