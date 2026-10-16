import { motionReelTrack } from '@reelmakeeasy/common/motion-reel/music'
import {
  MOTION_REEL_LENGTHS,
  MOTION_REEL_RATIOS,
  MOTION_REEL_SUBJECT_MAX,
  type MotionReelLength,
  type MotionReelSetup,
} from '@reelmakeeasy/common/motion-reel/reel-config'
import {
  MOTION_REEL_STYLE_IDS,
  type MotionReelRatio,
  type MotionReelStyleId,
} from '@reelmakeeasy/common/motion-reel/styles'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

import { checkReference } from './motion-reference'

/** A setup card the API can't take; the message says what to fix. */
export class MotionSetupError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The setup card's body, checked: every field the card sends, nothing else trusted. */
export function parseMotionSetup(body: unknown): MotionReelSetup {
  if (!isRecord(body)) throw new MotionSetupError('The setup is missing.')
  const subject = typeof body['subject'] === 'string' ? body['subject'].trim() : ''
  if (!subject) throw new MotionSetupError('Say what the reel is about.')
  if (subject.length > MOTION_REEL_SUBJECT_MAX)
    throw new MotionSetupError(
      `Keep what the reel is about under ${MOTION_REEL_SUBJECT_MAX} characters.`,
    )
  const styleId = body['styleId']
  if (typeof styleId !== 'string' || !MOTION_REEL_STYLE_IDS.includes(styleId as MotionReelStyleId))
    throw new MotionSetupError('Pick a style.')
  const lengthSec = body['lengthSec']
  if (!MOTION_REEL_LENGTHS.includes(lengthSec as MotionReelLength))
    throw new MotionSetupError(
      `The length must be one of ${MOTION_REEL_LENGTHS.join(', ')} seconds.`,
    )
  const ratio = body['ratio']
  if (!MOTION_REEL_RATIOS.includes(ratio as MotionReelRatio))
    throw new MotionSetupError('Pick a frame shape.')

  const music = body['music']
  let parsedMusic: MotionReelSetup['music']
  if (!isRecord(music) || music['source'] === 'none') parsedMusic = { source: 'none' }
  else if (music['source'] === 'agent') parsedMusic = { source: 'agent' }
  else if (
    music['source'] === 'library' &&
    typeof music['id'] === 'string' &&
    motionReelTrack(music['id'])
  )
    parsedMusic = { id: music['id'], source: 'library' }
  else if (music['source'] === 'upload' && typeof music['id'] === 'string' && music['id'].trim())
    parsedMusic = { id: music['id'].trim(), source: 'upload' }
  else throw new MotionSetupError("That music isn't available.")

  const reference = body['reference']
  let parsedReference: MotionReelSetup['reference']
  if (isRecord(reference) && typeof reference['url'] === 'string' && reference['url'].trim()) {
    const kind = reference['kind'] === 'youtube' ? 'youtube' : 'website'
    try {
      parsedReference = checkReference({ kind, url: reference['url'] })
    } catch (error) {
      throw new MotionSetupError(ensureError(error).message)
    }
  }

  return {
    lengthSec: lengthSec as MotionReelLength,
    music: parsedMusic,
    ratio: ratio as MotionReelRatio,
    ...(parsedReference ? { reference: parsedReference } : {}),
    styleId: styleId as MotionReelStyleId,
    subject,
  }
}

/** The beats a `motion_still` call asks for: up to `max` distinct, non-negative numbers. */
export function parseStillBeats(raw: unknown, max: number): number[] {
  const text = isRecord(raw) && typeof raw['beats'] === 'string' ? raw['beats'] : ''
  const beats = text
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n) && n >= 0)
  const unique = [...new Set(beats)]
  if (!unique.length) throw new MotionSetupError('Pass the beats to look at, e.g. "0, 4, 8.5".')
  return unique.slice(0, max)
}
