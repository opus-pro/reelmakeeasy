import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { BEAT_LOOP_SKILL_NAME, renderBeatLoopSkill } from '../craft/beat-loop-skill'
import { CAMERA_SKILL_NAME, renderCameraSkill } from '../craft/camera-skill'
import { MOTION_REEL_SKILL_NAME, renderMotionReelSkill } from '../craft/motion-reel-skill'
import * as musicComposerSkill from '../craft/music-composer-skill'
import { MUSIC_COMPOSER_SKILL_NAME, musicComposerSkillDir } from '../craft/music-composer-skill'
import { RANKING_SKILL_NAME } from '../craft/ranking-skill'

import {
  AGENT_CODEX_CONFIG,
  AGENT_SKILL_NAMES,
  agentCodexHome,
  agentSkillNames,
  ensureAgentCodexHome,
} from './codex-home'

describe('agentCodexHome', () => {
  it('is codex-home under the given root', () => {
    expect(agentCodexHome('/tmp/data')).toBe(path.join('/tmp/data', 'codex-home'))
  })
})

describe('ensureAgentCodexHome', () => {
  let home: string
  let userHome: string

  beforeEach(() => {
    home = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'agent-codex-home-')), 'codex-home')
    userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'user-codex-home-'))
  })

  afterEach(() => {
    fs.rmSync(path.dirname(home), { force: true, recursive: true })
    fs.rmSync(userHome, { force: true, recursive: true })
  })

  it('creates home and writes config.toml with the exact ReelMakeEasy content', () => {
    ensureAgentCodexHome({ home, userHome })
    expect(fs.statSync(home).isDirectory()).toBe(true)
    expect(fs.readFileSync(path.join(home, 'config.toml'), 'utf8')).toBe(AGENT_CODEX_CONFIG)
  })

  it('links auth.json to the user home, even when the target does not exist yet', () => {
    ensureAgentCodexHome({ home, userHome })
    const link = path.join(home, 'auth.json')
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(fs.readlinkSync(link)).toBe(path.join(userHome, 'auth.json'))
    expect(fs.existsSync(path.join(userHome, 'auth.json'))).toBe(false)
  })

  it('is a no-op on a second call: the link is unchanged and nothing throws', () => {
    ensureAgentCodexHome({ home, userHome })
    const link = path.join(home, 'auth.json')
    const before = fs.readlinkSync(link)
    expect(() => ensureAgentCodexHome({ home, userHome })).not.toThrow()
    expect(fs.readlinkSync(link)).toBe(before)
  })

  it('replaces a link pointing somewhere else with the correct link', () => {
    fs.mkdirSync(home, { recursive: true })
    const link = path.join(home, 'auth.json')
    const wrongTarget = path.join(userHome, 'wrong.json')
    fs.symlinkSync(wrongTarget, link)
    ensureAgentCodexHome({ home, userHome })
    expect(fs.readlinkSync(link)).toBe(path.join(userHome, 'auth.json'))
  })

  it('leaves a regular file at auth.json untouched and warns once', () => {
    fs.mkdirSync(home, { recursive: true })
    const link = path.join(home, 'auth.json')
    fs.writeFileSync(link, '{"working":"login"}')
    const warn = jest.fn()
    ensureAgentCodexHome({ home, userHome, warn })
    expect(fs.readFileSync(link, 'utf8')).toBe('{"working":"login"}')
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('rewrites config.toml on every call, overwriting user edits', () => {
    ensureAgentCodexHome({ home, userHome })
    fs.writeFileSync(path.join(home, 'config.toml'), 'user edit\n')
    ensureAgentCodexHome({ home, userHome })
    expect(fs.readFileSync(path.join(home, 'config.toml'), 'utf8')).toBe(AGENT_CODEX_CONFIG)
  })

  it('writes the reelmakeeasy-camera skill on every start', () => {
    ensureAgentCodexHome({ home, userHome })
    const file = path.join(home, 'skills', 'reelmakeeasy-camera', 'SKILL.md')
    expect(fs.readFileSync(file, 'utf8')).toBe(renderCameraSkill())
    fs.writeFileSync(file, 'stale')
    ensureAgentCodexHome({ home, userHome })
    expect(fs.readFileSync(file, 'utf8')).toBe(renderCameraSkill())
  })

  it('writes the beat-loop and Motion Reel skills too, and names every skill it ships', () => {
    ensureAgentCodexHome({ home, userHome })
    const file = path.join(home, 'skills', BEAT_LOOP_SKILL_NAME, 'SKILL.md')
    expect(fs.readFileSync(file, 'utf8')).toBe(renderBeatLoopSkill())
    const motion = path.join(home, 'skills', MOTION_REEL_SKILL_NAME, 'SKILL.md')
    expect(fs.readFileSync(motion, 'utf8')).toBe(renderMotionReelSkill())
    expect(AGENT_SKILL_NAMES).toEqual([
      CAMERA_SKILL_NAME,
      BEAT_LOOP_SKILL_NAME,
      RANKING_SKILL_NAME,
      MOTION_REEL_SKILL_NAME,
      MUSIC_COMPOSER_SKILL_NAME,
    ])
  })

  it('copies the music composer skill whole, its references too', () => {
    ensureAgentCodexHome({ home, userHome })
    const skill = path.join(home, 'skills', MUSIC_COMPOSER_SKILL_NAME)
    for (const file of [
      'SKILL.md',
      'references/music-direction.md',
      'references/music-synthesis.md',
    ])
      expect(fs.readFileSync(path.join(skill, file), 'utf8')).toBe(
        fs.readFileSync(path.join(musicComposerSkillDir(), file), 'utf8'),
      )
    fs.writeFileSync(path.join(skill, 'SKILL.md'), 'stale')
    ensureAgentCodexHome({ home, userHome })
    expect(fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8')).toMatch(
      new RegExp(`^---\nname: ${MUSIC_COMPOSER_SKILL_NAME}\n`),
    )
  })

  it('skips the music composer skill when this install has no folder for it', () => {
    const missing = jest
      .spyOn(musicComposerSkill, 'musicComposerSkillDir')
      .mockReturnValue(path.join(userHome, 'no-such-skill'))
    try {
      expect(() => ensureAgentCodexHome({ home, userHome })).not.toThrow()
      expect(fs.existsSync(path.join(home, 'skills', MUSIC_COMPOSER_SKILL_NAME))).toBe(false)
      expect(fs.existsSync(path.join(home, 'skills', MOTION_REEL_SKILL_NAME, 'SKILL.md'))).toBe(
        true,
      )
      expect(agentSkillNames()).not.toContain(MUSIC_COMPOSER_SKILL_NAME)
    } finally {
      missing.mockRestore()
    }
    expect(agentSkillNames()).toContain(MUSIC_COMPOSER_SKILL_NAME)
  })

  it('removes retired reelmakeeasy skills and leaves other skills alone', () => {
    const skills = path.join(home, 'skills')
    for (const dir of ['reelmakeeasy-old', '.system', 'my-skill']) {
      fs.mkdirSync(path.join(skills, dir), { recursive: true })
      fs.writeFileSync(path.join(skills, dir, 'SKILL.md'), dir)
    }
    ensureAgentCodexHome({ home, userHome })
    expect(fs.existsSync(path.join(skills, 'reelmakeeasy-old'))).toBe(false)
    expect(fs.readFileSync(path.join(skills, '.system', 'SKILL.md'), 'utf8')).toBe('.system')
    expect(fs.readFileSync(path.join(skills, 'my-skill', 'SKILL.md'), 'utf8')).toBe('my-skill')
  })
})
