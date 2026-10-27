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
import type { AgentAnimationSetup, AnimationLookId } from '@shared/types/api/agent'

import type { ReelMusicSource } from '../motion-reel/motion-project'
import { run, runtimeDir } from '../motion-reel/motion-runtime'

/** The animation's Remotion project, inside the chat's working folder. */
export const ANIMATION_DIR = 'animation'

/** Seconds the music fades out over at the end (the kit fades it too, on the video's own end). */
const MUSIC_FADE_SEC = 2

/** `public/animation.json`: what the project's clock reads. */
export type AnimationJson = {
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
  music: null | ReelMusicSource
  musicOnly?: boolean
  setup: AgentAnimationSetup
  workspace: string
}): Promise<{ projectDir: string; spec: AnimationJson }> {
  const projectDir = path.join(o.workspace, ANIMATION_DIR)
  const look = animationLook(o.setup.lookId)
  if (!look) throw new Error(`Unknown look: ${o.setup.lookId}`)

  copyTree(presetPath('animation/template'), projectDir)
  copyTree(presetPath(`animation/${look.id}`), projectDir)
  if (!o.musicOnly) linkRuntime(projectDir)

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

  const spec: AnimationJson = {
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
    renderAnimationBrief(o.setup, o.music?.title ?? null),
  )
  return { projectDir, spec }
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
