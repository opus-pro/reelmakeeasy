import {
  ANIMATION_MAX_SEC,
  ANIMATION_MIN_SEC,
  ANIMATION_SUBJECT_MAX,
  animationLook,
  AVATAR_NAME_MAX,
  AVATAR_STYLES,
} from '@reelmakeeasy/common/animation/looks'
import { localTtsSupports } from '@reelmakeeasy/common/tts/local-tts'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type {
  AgentAnimationAvatar,
  AgentAnimationSetup,
  AvatarStyle,
} from '@shared/types/api/agent'

import { musicFromTool, MotionSetupError, parseMusic } from '../motion-reel/motion-setup'

/** A setup card (or animation_setup call) the API can't take; the message says what to fix. */
export class AnimationSetupError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Motion Reel's music check (Claude composing it itself, "composer", by default), its refusals
 *  as this setup's. */
function checkedMusic(music: unknown): AgentAnimationSetup['music'] {
  try {
    return parseMusic(music)
  } catch (error) {
    if (error instanceof MotionSetupError) throw new AnimationSetupError(error.message)
    throw error
  }
}

/** The Talking head's avatar, checked: a saved one by its id, or a new one (a name, the photo's
 *  attachment name, 2D or 3D). Whether it exists is the service's to check. */
function parseAvatar(raw: unknown): AgentAnimationAvatar {
  if (!isRecord(raw))
    throw new AnimationSetupError('Pick an avatar, or make a new one from a photo.')
  if (typeof raw['id'] === 'string' && raw['id'].trim()) return { id: raw['id'].trim() }
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : ''
  if (!name) throw new AnimationSetupError('Give the new avatar a name.')
  if (name.length > AVATAR_NAME_MAX)
    throw new AnimationSetupError(`Keep the avatar's name under ${AVATAR_NAME_MAX} characters.`)
  const photo = typeof raw['photo'] === 'string' ? raw['photo'].trim() : ''
  if (!photo) throw new AnimationSetupError('Add a photo to draw the avatar from.')
  const style = raw['style']
  if (!AVATAR_STYLES.includes(style as AvatarStyle))
    throw new AnimationSetupError('Pick 2D or 3D for the avatar.')
  return { name, photo, style: style as AvatarStyle }
}

/** The setup card's body, checked: every field the card sends, nothing else trusted. */
export function parseAnimationSetup(body: unknown): AgentAnimationSetup {
  if (!isRecord(body)) throw new AnimationSetupError('The setup is missing.')
  const look = typeof body['lookId'] === 'string' ? animationLook(body['lookId']) : undefined
  if (!look) throw new AnimationSetupError('Pick a look.')
  const lengthSec = body['lengthSec']
  if (
    typeof lengthSec !== 'number' ||
    !Number.isInteger(lengthSec) ||
    lengthSec < ANIMATION_MIN_SEC ||
    lengthSec > ANIMATION_MAX_SEC
  )
    throw new AnimationSetupError(
      `The length must be ${ANIMATION_MIN_SEC} to ${ANIMATION_MAX_SEC} seconds.`,
    )
  const subject = typeof body['subject'] === 'string' ? body['subject'].trim() : ''
  if (subject.length > ANIMATION_SUBJECT_MAX)
    throw new AnimationSetupError(
      `Keep what it is about under ${ANIMATION_SUBJECT_MAX} characters.`,
    )
  return {
    ...(look.id === 'avatar' ? { avatar: parseAvatar(body['avatar']) } : {}),
    lengthSec,
    lookId: look.id,
    music: checkedMusic(body['music']),
    subject: subject || null,
  }
}

/**
 * An Advanced chat's `animation_setup` call, as the setup card's body (then checked by
 * `parseAnimationSetup`): null when it names no look yet (it asks for the options).
 */
export function animationSetupFromTool(args: unknown): AgentAnimationSetup | null {
  const a = isRecord(args) ? args : {}
  const lookId = typeof a['lookId'] === 'string' ? a['lookId'].trim() : ''
  if (!lookId) return null
  let music: unknown
  try {
    music = musicFromTool(a, 'animation_setup')
  } catch (error) {
    if (error instanceof MotionSetupError) throw new AnimationSetupError(error.message)
    throw ensureError(error)
  }
  const text = (key: string) => (typeof a[key] === 'string' ? (a[key] as string).trim() : '')
  return parseAnimationSetup({
    avatar: text('avatarId')
      ? { id: text('avatarId') }
      : { name: text('avatarName'), photo: text('avatarPhoto'), style: text('avatarStyle') },
    lengthSec: Number(a['lengthSec']),
    lookId,
    music,
    subject: typeof a['subject'] === 'string' ? a['subject'] : null,
  })
}

/** Where voices can be made: `designed` (Qwen3 voice design, from a description) and `preset`
 *  (a Kokoro voice), each on this computer, on fal (paid, needs FAL_KEY), or nowhere. */
export type VoiceReadiness = {
  designed: 'fal' | 'local' | null
  preset: 'fal' | 'local' | null
}

export async function voiceReadiness(): Promise<VoiceReadiness> {
  const fal = process.env['FAL_KEY']?.trim() ? 'fal' : null
  const [qwen3, kokoro] = await Promise.all([localTtsSupports('qwen3'), localTtsSupports('kokoro')])
  return { designed: qwen3 ? 'local' : fal, preset: kokoro ? 'local' : fal }
}
