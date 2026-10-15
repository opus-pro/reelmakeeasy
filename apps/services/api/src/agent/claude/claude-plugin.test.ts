import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { CAMERA_SKILL_NAME, renderCameraSkill } from '../craft/camera-skill'

import { ensureClaudePlugin } from './claude-plugin'

describe('ensureClaudePlugin', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ly-plugin-'))
  })
  afterEach(() => fs.rmSync(dir, { force: true, recursive: true }))

  it('writes the manifest and the camera skill', () => {
    expect(ensureClaudePlugin(dir)).toBe(dir)
    const manifest = JSON.parse(
      fs.readFileSync(path.join(dir, '.claude-plugin/plugin.json'), 'utf8'),
    ) as { name: string }
    expect(manifest.name).toBe('reelmakeeasy')
    expect(fs.readFileSync(path.join(dir, 'skills', CAMERA_SKILL_NAME, 'SKILL.md'), 'utf8')).toBe(
      renderCameraSkill(),
    )
  })

  it('removes reelmakeeasy skills it no longer ships and keeps anything else', () => {
    fs.mkdirSync(path.join(dir, 'skills/reelmakeeasy-old'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'skills/other'), { recursive: true })
    ensureClaudePlugin(dir)
    expect(fs.existsSync(path.join(dir, 'skills/reelmakeeasy-old'))).toBe(false)
    expect(fs.existsSync(path.join(dir, 'skills/other'))).toBe(true)
  })
})
