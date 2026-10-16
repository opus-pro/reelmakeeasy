import fs from 'node:fs'
import path from 'node:path'

import { dataDir } from '@reelmakeeasy/common/storage/file-store'

import { BEAT_LOOP_SKILL_NAME, renderBeatLoopSkill } from '../craft/beat-loop-skill'
import { CAMERA_SKILL_NAME, renderCameraSkill } from '../craft/camera-skill'
import { MOTION_REEL_SKILL_NAME, renderMotionReelSkill } from '../craft/motion-reel-skill'
import { remotionSkillFolders } from '../motion-reel/motion-runtime'

import { codexHome } from './codex-config'

/** ReelMakeEasy owns this file: it is rewritten on every session start. */
export const AGENT_CODEX_CONFIG =
  '# Written by ReelMakeEasy for agent-mode sessions. Changes here are overwritten.\n'

/** Agent sessions' own Codex home, apart from the user's ~/.codex. */
export function agentCodexHome(root: string = dataDir()): string {
  return path.join(root, 'codex-home')
}

/** Skills ReelMakeEasy ships into agent mode's Codex home (and its Claude plugin), by folder name. */
const AGENT_SKILLS: Record<string, () => string> = {
  [CAMERA_SKILL_NAME]: renderCameraSkill,
  [BEAT_LOOP_SKILL_NAME]: renderBeatLoopSkill,
  [MOTION_REEL_SKILL_NAME]: renderMotionReelSkill,
}

/** The skills' names, in the order they are written. */
export const AGENT_SKILL_NAMES: readonly string[] = Object.keys(AGENT_SKILLS)

/** Remotion's own agent skills a Motion Reel uses (downloaded with its runtime, copied in once
 *  there). Not its project-creating or rendering skills: ReelMakeEasy sets up and renders. */
export const REMOTION_SKILLS = [
  'remotion-best-practices',
  'remotion-markup',
  'remotion-multimedia',
] as const

/** Every skill agent chats load now: ReelMakeEasy's, and Remotion's once downloaded. */
export function agentSkillNames(): string[] {
  const remotion = new Set(remotionSkillFolders().map((folder) => folder.name))
  return [...AGENT_SKILL_NAMES, ...REMOTION_SKILLS.filter((name) => remotion.has(name))]
}

/**
 * Writes ReelMakeEasy's skills into `<home>/skills/<name>/SKILL.md` and removes `reelmakeeasy-*`
 * folders it no longer ships. Codex's own `.system` skills and anything else are left alone.
 */
export function syncAgentSkills(home: string): void {
  const root = path.join(home, 'skills')
  fs.mkdirSync(root, { recursive: true })
  for (const entry of fs.readdirSync(root)) {
    if (entry.startsWith('reelmakeeasy-') && !(entry in AGENT_SKILLS)) {
      fs.rmSync(path.join(root, entry), { force: true, recursive: true })
    }
  }
  for (const [name, render] of Object.entries(AGENT_SKILLS)) {
    fs.mkdirSync(path.join(root, name), { recursive: true })
    fs.writeFileSync(path.join(root, name, 'SKILL.md'), render())
  }
  const remotion = remotionSkillFolders().filter((folder) =>
    (REMOTION_SKILLS as readonly string[]).includes(folder.name),
  )
  for (const folder of remotion) {
    fs.rmSync(path.join(root, folder.name), { force: true, recursive: true })
    fs.cpSync(folder.dir, path.join(root, folder.name), { recursive: true })
  }
}

/**
 * Creates (or repairs) the isolated Codex home that agent sessions run with.
 * Codex then loads none of the user's skills, MCP servers, plugins, hooks or
 * global AGENTS.md - only its own system skills (image generation included)
 * and ReelMakeEasy's (`reelmakeeasy-camera`, `reelmakeeasy-beat-loop`), rewritten here
 * on every start.
 * `auth.json` is a symlink to the user's, so the ChatGPT login and its token
 * refreshes stay shared. A regular file there means Codex replaced the link;
 * it holds a working login, so it is left alone.
 */
export function ensureAgentCodexHome(
  opts: { home?: string; userHome?: string; warn?: (msg: string) => void } = {},
): string {
  const home = opts.home ?? agentCodexHome()
  const target = path.join(opts.userHome ?? codexHome(), 'auth.json')
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(path.join(home, 'config.toml'), AGENT_CODEX_CONFIG)
  syncAgentSkills(home)
  const link = path.join(home, 'auth.json')
  let stat: fs.Stats | null = null
  try {
    stat = fs.lstatSync(link)
  } catch {
    stat = null
  }
  if (stat && !stat.isSymbolicLink()) {
    opts.warn?.(`${link} is a regular file, not a link to ${target}; leaving it in place`)
    return home
  }
  if (stat && fs.readlinkSync(link) === target) return home
  if (stat) fs.unlinkSync(link)
  fs.symlinkSync(target, link)
  return home
}
