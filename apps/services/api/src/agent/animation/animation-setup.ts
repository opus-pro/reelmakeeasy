import {
  ANIMATION_MAX_SEC,
  ANIMATION_MIN_SEC,
  ANIMATION_SUBJECT_MAX,
  animationLook,
  AVATAR_NAME_MAX,
  AVATAR_STYLES,
  isAnimationStyle,
} from '@reelmakeeasy/common/animation/looks'
import { isVideoDetail, VIDEO_DEFAULT_DETAIL } from '@reelmakeeasy/common/motion-reel/video-detail'
import { localTtsSupports } from '@reelmakeeasy/common/tts/local-tts'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type {
  AgentAnimationAvatar,
  AgentAnimationSetup,
  AvatarStyle,
  VideoDetail,
} from '@shared/types/api/agent'

import { MotionSetupError, musicFromTool, parseMusic } from '../motion-reel/motion-setup'

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

/** The longest description of a new avatar. */
export const AVATAR_DESCRIPTION_MAX = 600

/** The Avatar video's avatar, checked: a saved one by its id, or a new one (a name, the photo's
 *  attachment name and/or a description, 2D, 3D or Pixel art). Whether it exists is the
 *  service's to check. */
function parseAvatar(raw: unknown): AgentAnimationAvatar {
  if (!isRecord(raw))
    throw new AnimationSetupError('Pick an avatar, or make a new one from a photo.')
  if (typeof raw['id'] === 'string' && raw['id'].trim()) return { id: raw['id'].trim() }
  const name = typeof raw['name'] === 'string' ? raw['name'].trim() : ''
  if (!name) throw new AnimationSetupError('Give the new avatar a name.')
  if (name.length > AVATAR_NAME_MAX)
    throw new AnimationSetupError(`Keep the avatar's name under ${AVATAR_NAME_MAX} characters.`)
  const photo = typeof raw['photo'] === 'string' ? raw['photo'].trim() : ''
  const description = typeof raw['description'] === 'string' ? raw['description'].trim() : ''
  if (!photo && !description)
    throw new AnimationSetupError('Add a photo, or describe how the avatar looks.')
  if (description.length > AVATAR_DESCRIPTION_MAX)
    throw new AnimationSetupError(
      `Keep the avatar's description under ${AVATAR_DESCRIPTION_MAX} characters.`,
    )
  const style = raw['style']
  if (!AVATAR_STYLES.includes(style as AvatarStyle))
    throw new AnimationSetupError('Pick 2D, 3D or Pixel art for the avatar.')
  return {
    ...(description ? { description } : {}),
    name,
    ...(photo ? { photo } : {}),
    style: style as AvatarStyle,
  }
}

/**
 * An Avatar explainer's avatar and style, checked: the style is the world the host is drawn in
 * (2D and 3D take an avatar drawn the same way, Pixel art either). Unset: the avatar's own. A
 * saved avatar's style is the service's to check.
 */
function parseAvatarStage(
  body: Record<string, unknown>,
): Pick<AgentAnimationSetup, 'avatar' | 'avatarOnly' | 'avatarVoiceId' | 'stage'> {
  const avatar = parseAvatar(body['avatar'])
  // The avatar creator: a new avatar only, with the voice picked for it.
  const avatarOnly = body['avatarOnly'] === true
  if (avatarOnly && 'id' in avatar)
    throw new AnimationSetupError('The avatar creator makes a new avatar: give it a name.')
  const voice = typeof body['avatarVoiceId'] === 'string' ? body['avatarVoiceId'].trim() : ''
  if (voice.length > 200) throw new AnimationSetupError('That is not a voice.')
  const extra = {
    ...(avatarOnly ? { avatarOnly } : {}),
    ...(voice ? { avatarVoiceId: voice } : {}),
  }
  const raw = body['stage']
  if (raw === undefined || raw === null || raw === '') return { avatar, ...extra }
  const stage = animationLook(String(raw))
  if (!isAnimationStyle(raw) || !stage?.withAvatar)
    throw new AnimationSetupError('Pick the style: 2d, 3d or 8bit (Pixel art).')
  if ('style' in avatar && !stage.withAvatar.avatarStyles.includes(avatar.style))
    throw new AnimationSetupError(
      `A ${stage.label} explainer needs a ${stage.withAvatar.avatarStyles.join(' or ').toUpperCase()} avatar.`,
    )
  return { avatar, ...extra, stage: raw }
}

/** The detail level, checked: unset is the default (Extra high). */
function parseDetail(raw: unknown): VideoDetail {
  if (raw === undefined || raw === null || raw === '') return VIDEO_DEFAULT_DETAIL
  if (!isVideoDetail(raw))
    throw new AnimationSetupError('Pick the detail: low, medium, high or xhigh (Extra high).')
  return raw
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
    ...(look.id === 'avatar' ? parseAvatarStage(body) : {}),
    detail: parseDetail(body['detail']),
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
      : {
          description: text('avatarDescription'),
          name: text('avatarName'),
          photo: text('avatarPhoto'),
          style: text('avatarStyle'),
        },
    detail: text('detail') || undefined,
    lengthSec: Number(a['lengthSec']),
    lookId,
    music,
    stage: text('stage') || undefined,
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
