import { motionReelTrack } from '@reelmakeeasy/common/motion-reel/music'
import {
  isMotionMusicEngine,
  MOTION_MUSIC_ENGINES,
  MOTION_REEL_LENGTHS,
  MOTION_REEL_RATIOS,
  MOTION_REEL_SUBJECT_MAX,
  motionMusicEngineOf,
  type MotionReelLength,
  type MotionReelRatio,
  type MotionReelSetup,
} from '@reelmakeeasy/common/motion-reel/reel-config'
import { MOTION_REEL_TYPES, motionReelTypeOf } from '@reelmakeeasy/common/motion-reel/reel-type'
import { isVideoDetail, VIDEO_DEFAULT_DETAIL } from '@reelmakeeasy/common/motion-reel/video-detail'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

import { checkReference } from './motion-reference'

/** A setup card the API can't take; the message says what to fix. */
export class MotionSetupError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** The card's music: a library track, the user's own file, made by the agent (by the music model
 *  picked; a saved setup with none, or one no longer offered, reads as the default), or none. */
export function parseMusic(music: unknown): MotionReelSetup['music'] {
  if (!isRecord(music) || music['source'] === 'none') return { source: 'none' }
  if (music['source'] === 'agent')
    return { engine: motionMusicEngineOf(music['engine']), source: 'agent' }
  if (
    music['source'] === 'library' &&
    typeof music['id'] === 'string' &&
    motionReelTrack(music['id'])
  )
    return { id: music['id'], source: 'library' }
  if (music['source'] === 'upload' && typeof music['id'] === 'string' && music['id'].trim())
    return { id: music['id'].trim(), source: 'upload' }
  throw new MotionSetupError("That music isn't available.")
}

/** The setup card's body, checked: every field the card sends, nothing else trusted. */
export function parseMotionSetup(body: unknown): MotionReelSetup {
  if (!isRecord(body)) throw new MotionSetupError('The setup is missing.')
  const subject = typeof body['subject'] === 'string' ? body['subject'].trim() : ''
  if (!subject) throw new MotionSetupError('Say what the reel is about.')
  if (subject.length > MOTION_REEL_SUBJECT_MAX)
    throw new MotionSetupError(
      `Keep what the reel is about under ${MOTION_REEL_SUBJECT_MAX} characters.`,
    )
  // A card from before reel types sends a style: it reads as its type.
  const type = motionReelTypeOf(body)
  if (!type) throw new MotionSetupError(`Pick the kind of reel: ${MOTION_REEL_TYPES.join(' or ')}.`)
  const lengthSec = body['lengthSec']
  if (!MOTION_REEL_LENGTHS.includes(lengthSec as MotionReelLength))
    throw new MotionSetupError(
      `The length must be one of ${MOTION_REEL_LENGTHS.join(', ')} seconds.`,
    )
  const ratio = body['ratio']
  if (!MOTION_REEL_RATIOS.includes(ratio as MotionReelRatio))
    throw new MotionSetupError('Pick a frame shape.')

  const parsedMusic = parseMusic(body['music'])

  // Unset (a card from before the detail level): Extra high.
  const detail =
    body['detail'] === undefined || body['detail'] === '' ? VIDEO_DEFAULT_DETAIL : body['detail']
  if (!isVideoDetail(detail))
    throw new MotionSetupError('Pick the detail: low, medium, high or xhigh (Extra high).')

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
    detail,
    lengthSec: lengthSec as MotionReelLength,
    music: parsedMusic,
    ratio: ratio as MotionReelRatio,
    ...(parsedReference ? { reference: parsedReference } : {}),
    subject,
    type,
  }
}

/**
 * The links in what the user typed, each as one comparable string (`comparableLink`): a full
 * `http(s)://` address or a bare domain (`example.com/page`).
 */
export function linksIn(texts: readonly string[]): Set<string> {
  const links = new Set<string>()
  for (const text of texts)
    for (const match of text.matchAll(LINK_IN_TEXT)) {
      const link = comparableLink(match[0].replace(TRAILING_PUNCTUATION, ''))
      if (link) links.add(link)
    }
  return links
}

const LINK_IN_TEXT = /\bhttps?:\/\/[^\s<>"'`]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s<>"'`]*)?/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

/** A link as one comparable string: https assumed when it has no scheme, the host lowercased,
 *  no trailing slash on the path. Null when it isn't a web address. */
export function comparableLink(raw: string): null | string {
  const text = raw.trim()
  if (!text) return null
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    url.hash = ''
    return url.href.replace(/\/$/, '')
  } catch {
    return null
  }
}

/**
 * An Advanced Motion Reel chat's `motion_setup` call, as the setup card's body (then checked by
 * `parseMotionSetup`): null when it names no type yet (it asks for the options). A reference
 * must be a link the user typed in this chat (`userTexts`): the agent has a shell, so it may
 * never send ReelMakeEasy to an address of its own making.
 */
export function motionSetupFromTool(
  args: unknown,
  userTexts: readonly string[],
): MotionReelSetup | null {
  const a = isRecord(args) ? args : {}
  const text = (key: string) => (typeof a[key] === 'string' ? (a[key] as string).trim() : '')
  if (!text('type')) return null
  const music = musicFromTool(a, 'motion_setup')
  const reference = userReference(text('referenceUrl'), userTexts)
  return parseMotionSetup({
    detail: text('detail') || undefined,
    lengthSec: Number(a['lengthSec']),
    music,
    ratio: text('ratio'),
    ...(reference ? { reference } : {}),
    subject: text('subject'),
    type: text('type'),
  })
}

/**
 * A setup tool's flat music arguments (`music`, `musicId`, `musicEngine`) as the setup card's
 * `music` (then checked by `parseMusic`). `tool` names the tool that lists the tracks.
 */
export function musicFromTool(a: Record<string, unknown>, tool: string): unknown {
  const text = (key: string) => (typeof a[key] === 'string' ? (a[key] as string).trim() : '')
  const source = text('music') || 'none'
  const musicId = text('musicId')
  const music =
    source === 'library'
      ? { id: musicId, source }
      : source === 'upload'
        ? // A path in the working folder (attachments/song.mp3) or the file's own name.
          { id: musicId.split(/[\\/]/).pop() ?? '', source }
        : source === 'agent'
          ? { engine: text('musicEngine'), source }
          : { source }
  if ((source === 'library' || source === 'upload') && !musicId)
    throw new MotionSetupError(
      source === 'library'
        ? `Name the track: musicId is a library track id (call ${tool} with no arguments to list them).`
        : "Name the user's file: musicId is its path, e.g. attachments/song.mp3.",
    )
  if (!['agent', 'library', 'none', 'upload'].includes(source))
    throw new MotionSetupError('music is one of library, upload, agent or none.')
  if (source === 'agent' && text('musicEngine') && !isMotionMusicEngine(text('musicEngine')))
    throw new MotionSetupError(`musicEngine is ${MOTION_MUSIC_ENGINES.join(' or ')}.`)
  return music
}

/** A reference the agent passed, only when it is a link the user typed in this chat. */
function userReference(
  url: string,
  userTexts: readonly string[],
): undefined | { kind: 'website' | 'youtube'; url: string } {
  if (!url) return undefined
  const link = comparableLink(url)
  if (!link || !linksIn(userTexts).has(link))
    throw new MotionSetupError(
      'A reference must be a link the user pasted in this chat; leave it out otherwise.',
    )
  const host = new URL(link).hostname.toLowerCase()
  const youtube = host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')
  return { kind: youtube ? 'youtube' : 'website', url: link }
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
