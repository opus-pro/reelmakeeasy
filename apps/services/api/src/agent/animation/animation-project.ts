import fs from 'node:fs'
import path from 'node:path'

import {
  ANIMATION_FPS,
  ANIMATION_SIZE,
  animationLook,
  renderLookCard,
} from '@reelmakeeasy/common/animation/looks'
import { MOTION_MUSIC_ENGINE_INFO } from '@reelmakeeasy/common/motion-reel/reel-config'
import { presetPath } from '@reelmakeeasy/common/storage/presets'
import type { AgentAnimationSetup, AnimationLookId, AvatarStyle } from '@shared/types/api/agent'

import { composerTitle, installComposer } from '../motion-reel/motion-composer'
import type { ReelMusicSource } from '../motion-reel/motion-project'
import { run, runtimeDir } from '../motion-reel/motion-runtime'

import { musicGrid, musicJsonOf, NO_MUSIC, placeSfx, writeMusicJson } from './animation-music'

/** The animation's Remotion project, inside the chat's working folder. */
export const ANIMATION_DIR = 'animation'

/** Seconds the music fades out over at the end (the kit fades it too, on the video's own end). */
const MUSIC_FADE_SEC = 2

/** The tempo the composer starts from (Claude sets its own in reel.config.mjs): calm enough for a
 *  voice to sit on. */
const COMPOSER_BPM = 96

/** The composer's settings for an animation: its length, a starting tempo, and a title. */
export function composerSettings(setup: AgentAnimationSetup): {
  bpm: number
  lengthSec: number
  title: string
} {
  const look = animationLook(setup.lookId)
  return {
    bpm: COMPOSER_BPM,
    lengthSec: setup.lengthSec,
    title: composerTitle(setup.subject ?? `${look?.label ?? setup.lookId} animation`),
  }
}

/** An Avatar video's avatar as the project gets it: a saved one (`id`, its rig file in the
 *  library) or a new one (`id` null, the photo to draw it from). */
export type ProjectAvatar = {
  id: null | string
  name: string
  /** The photo a new avatar is drawn from (a file on this computer). */
  photo?: string
  /** A saved avatar's rig (`avatar.ts` in the library). */
  rig?: string
  style: AvatarStyle
}

/** Where the avatar's rig is in the project, and the note of which avatar it is. */
export const AVATAR_RIG = path.join('src', 'avatar', 'avatar.ts')
const AVATAR_FROM = path.join('src', 'avatar', '.from')

/** `public/animation.json`: what the project's clock reads. */
export type AnimationJson = {
  /** The Avatar video's avatar (null id: a new one, not saved yet). */
  avatar?: { id: null | string; name: string; style: AvatarStyle }
  fps: number
  height: number
  lengthSec: number
  lookId: AnimationLookId
  /** File in public/, or null. */
  musicFile: null | string
  subject: null | string
  /** File in public/ (every line, joined), or null before animation_voice. */
  voiceFile: null | string
  width: number
}

/** The files the template ships under these names (so the repo's tools never treat it as a project). */
const TEMPLATE_RENAMES: Record<string, string> = {
  'package.template.json': 'package.json',
  'tsconfig.template.json': 'tsconfig.json',
}

/** Claude's own files: written once from the template, then kept. */
const CLAUDES_FILES = new Set([path.join('src', 'Animation.tsx')])

/**
 * Sets up the animation's project in `workspace/animation`: the shared template, the chosen look's
 * library, a link to the shared Remotion runtime, the music trimmed to the length, and
 * `public/animation.json`, `brief.md` and `look.md`. Safe to run again: ReelMakeEasy's files are
 * rewritten; Claude's `src/Animation.tsx`, scenes and recorded voices are kept. `musicOnly`: only
 * the music changed (Claude made a track), so the links and look are left as they are.
 */
export async function prepareAnimationProject(o: {
  /** The Avatar video's avatar (the look `avatar` only). */
  avatar?: ProjectAvatar
  music: null | ReelMusicSource
  musicOnly?: boolean
  setup: AgentAnimationSetup
  workspace: string
}): Promise<{ projectDir: string; spec: AnimationJson }> {
  const projectDir = path.join(o.workspace, ANIMATION_DIR)
  const look = animationLook(o.setup.lookId)
  if (!look) throw new Error(`Unknown look: ${o.setup.lookId}`)

  copyTree(presetPath('animation/template'), projectDir)
  // An Avatar video draws its avatar in 2D or 3D: both libraries, then its own host kit.
  for (const lib of look.id === 'avatar' ? ['2d', '3d', 'avatar'] : [look.id])
    copyTree(presetPath(`animation/${lib}`), projectDir)
  if (!o.musicOnly) linkRuntime(projectDir)
  if (o.avatar && !o.musicOnly) placeAvatar(projectDir, o.avatar)

  // Claude composes the music itself: the composer goes in `animation/music/`.
  if (o.setup.music.source === 'agent' && o.setup.music.engine === 'composer' && !o.musicOnly)
    installComposer(projectDir, composerSettings(o.setup))

  const voiceDir = path.join(projectDir, 'public', 'voice')
  fs.mkdirSync(voiceDir, { recursive: true })
  const lines = path.join(voiceDir, 'lines.json')
  if (!fs.existsSync(lines)) fs.writeFileSync(lines, '[]\n')

  const musicFile = path.join(projectDir, 'public', 'music.wav')
  if (o.music) {
    const fadeAt = Math.max(0, o.setup.lengthSec - MUSIC_FADE_SEC)
    await run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-t',
        String(o.setup.lengthSec),
        '-i',
        o.music.file,
        '-af',
        `afade=t=out:st=${fadeAt}:d=${MUSIC_FADE_SEC}`,
        '-ar',
        '48000',
        '-ac',
        '2',
        musicFile,
      ],
      projectDir,
    )
  } else if (!o.musicOnly) {
    fs.rmSync(musicFile, { force: true })
  }
  // The music's beats (so the picture can move with it), and the sound effects.
  if (o.music) {
    const grid = await musicGrid(musicFile, o.music.grid)
    writeMusicJson(projectDir, musicJsonOf(grid, o.setup.lengthSec + 30))
  } else if (!o.musicOnly || !fs.existsSync(path.join(projectDir, 'public', 'music.json')))
    writeMusicJson(projectDir, NO_MUSIC)
  placeSfx(projectDir)

  const before = fs.existsSync(path.join(projectDir, 'public', 'animation.json'))
    ? readAnimationJson(projectDir)
    : null
  const avatar = o.avatar
    ? { id: o.avatar.id, name: o.avatar.name, style: o.avatar.style }
    : o.musicOnly
      ? before?.avatar
      : undefined
  const spec: AnimationJson = {
    ...(avatar ? { avatar } : {}),
    fps: ANIMATION_FPS,
    height: ANIMATION_SIZE.height,
    lengthSec: o.setup.lengthSec,
    lookId: look.id,
    musicFile: fs.existsSync(musicFile) ? 'music.wav' : null,
    subject: o.setup.subject,
    voiceFile: fs.existsSync(path.join(projectDir, 'public', 'voice.wav')) ? 'voice.wav' : null,
    width: ANIMATION_SIZE.width,
  }
  writeAnimationJson(projectDir, spec)
  if (!o.musicOnly) fs.writeFileSync(path.join(projectDir, 'look.md'), renderLookCard(look))
  fs.writeFileSync(
    path.join(projectDir, 'brief.md'),
    renderAnimationBrief(o.setup, o.music?.title ?? null, avatar),
  )
  return { projectDir, spec }
}

/**
 * Puts the avatar's rig in `src/avatar/avatar.ts`: a saved avatar's own, or for a new one the
 * starter of its style, with its photo in `public/avatar/`. A rig already there for the same
 * avatar is kept (Claude may be changing it); another avatar's is replaced.
 */
export function placeAvatar(projectDir: string, avatar: ProjectAvatar): void {
  const rig = path.join(projectDir, AVATAR_RIG)
  const from = path.join(projectDir, AVATAR_FROM)
  const want = avatar.id ?? `new:${avatar.style}`
  const had = fs.existsSync(from) ? fs.readFileSync(from, 'utf8').trim() : null
  if (had !== want || !fs.existsSync(rig)) {
    fs.mkdirSync(path.dirname(rig), { recursive: true })
    fs.copyFileSync(avatar.rig ?? presetPath(`animation/avatar-starters/${avatar.style}.ts`), rig)
    fs.writeFileSync(from, `${want}\n`)
  }
  if (avatar.photo) {
    const dir = path.join(projectDir, 'public', 'avatar')
    fs.mkdirSync(dir, { recursive: true })
    for (const old of fs.readdirSync(dir).filter((n) => n.startsWith('photo.')))
      fs.rmSync(path.join(dir, old))
    fs.copyFileSync(
      avatar.photo,
      path.join(dir, `photo${path.extname(avatar.photo).toLowerCase()}`),
    )
  }
}

/** Notes that the project's rig is now the saved avatar `id` (after avatar_save). */
export function markAvatarSaved(projectDir: string, id: string): void {
  fs.writeFileSync(path.join(projectDir, AVATAR_FROM), `${id}\n`)
}

/** The photo a new avatar is drawn from, in the project, if any. */
export function avatarPhoto(projectDir: string): null | string {
  const dir = path.join(projectDir, 'public', 'avatar')
  try {
    const name = fs.readdirSync(dir).find((n) => n.startsWith('photo.'))
    return name ? path.join(dir, name) : null
  } catch {
    return null
  }
}

export function readAnimationJson(projectDir: string): AnimationJson {
  return JSON.parse(
    fs.readFileSync(path.join(projectDir, 'public', 'animation.json'), 'utf8'),
  ) as AnimationJson
}

export function writeAnimationJson(projectDir: string, spec: AnimationJson): void {
  fs.writeFileSync(
    path.join(projectDir, 'public', 'animation.json'),
    `${JSON.stringify(spec, null, 1)}\n`,
  )
}

/** The brief Claude reads first: what the user chose, in plain words. */
export function renderAnimationBrief(
  setup: AgentAnimationSetup,
  musicTitle: null | string,
  avatar?: AnimationJson['avatar'],
): string {
  const look = animationLook(setup.lookId)
  const music =
    setup.music.source === 'none'
      ? 'none (the voice alone)'
      : musicTitle
        ? `"${musicTitle}", trimmed to the length, under the voice (the kit ducks it while anyone speaks)`
        : setup.music.source === 'agent'
          ? `none yet: make it with animation_music before you build, with ${MOTION_MUSIC_ENGINE_INFO[setup.music.engine].label} (engine "${setup.music.engine}")`
          : 'none'
  return [
    '# Claude Animation brief',
    '',
    `- **About:** ${setup.subject ?? 'Pick a surprising, true fun fact yourself, in everyday words, and say which one in your plan.'}`,
    `- **Look:** ${look?.label ?? setup.lookId} (see look.md)`,
    `- **Length:** about ${setup.lengthSec} s`,
    `- **Frame:** 9:16, ${ANIMATION_SIZE.width}×${ANIMATION_SIZE.height}, ${ANIMATION_FPS} fps`,
    `- **Music:** ${music}`,
    ...(avatar
      ? [
          avatar.id
            ? `- **Avatar:** ${avatar.name}, saved (${avatar.style.toUpperCase()}): \`src/avatar/avatar.ts\` is its rig. Use it as it is; change it only when the user asks (then avatar_check and avatar_save again).`
            : `- **Avatar:** new, ${avatar.style.toUpperCase()}, named "${avatar.name}": draw it first from the photo in \`public/avatar/\` into \`src/avatar/avatar.ts\` (now the ${avatar.style.toUpperCase()} starter), check it with avatar_check, and save it with avatar_save once the user keeps it.`,
        ]
      : []),
    '',
  ].join('\n')
}

/**
 * Copies a preset folder in (its `*.template.json` under their real names), keeping Claude's own
 * starter once it exists.
 */
function copyTree(from: string, projectDir: string): void {
  for (const entry of walk(from)) {
    const relative = path.relative(from, entry)
    const target = path.join(projectDir, TEMPLATE_RENAMES[relative] ?? relative)
    if (CLAUDES_FILES.has(relative) && fs.existsSync(target)) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(entry, target)
  }
}

function linkRuntime(projectDir: string): void {
  const link = path.join(projectDir, 'node_modules')
  fs.rmSync(link, { force: true, recursive: true })
  fs.symlinkSync(path.join(runtimeDir(), 'node_modules'), link, 'dir')
}

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else yield full
  }
}
