import fs from 'node:fs'
import path from 'node:path'

import { CAMERA_MOVES, DYNAMIC_MOVEMENT_RULES } from '@reelmakeeasy/common/long-take/camera-craft'

import { CAMERA_SKILL_NAME, renderCameraSkill } from './camera-skill'

const CHECKED_IN = path.resolve(__dirname, '../../../../../../skills/reelmakeeasy-camera/SKILL.md')

describe('renderCameraSkill', () => {
  const skill = renderCameraSkill()

  it('has Codex skill frontmatter', () => {
    expect(skill.startsWith(`---\nname: ${CAMERA_SKILL_NAME}\ndescription: `)).toBe(true)
    expect(skill).toMatch(/\n---\n/)
  })

  it('teaches both styles, the movement rules, the moves and the pacing', () => {
    expect(skill).toContain('**Calm**')
    expect(skill).toContain('**Dynamic**')
    expect(skill).toContain(DYNAMIC_MOVEMENT_RULES)
    for (const move of CAMERA_MOVES) expect(skill).toContain(move)
    expect(skill).toContain('3-6s')
    expect(skill).toContain('5-8s')
  })

  it('matches the checked-in copy (run with UPDATE_SKILLS=1 to rewrite it)', () => {
    if (process.env.UPDATE_SKILLS === '1') {
      fs.mkdirSync(path.dirname(CHECKED_IN), { recursive: true })
      fs.writeFileSync(CHECKED_IN, skill)
    }
    expect(fs.readFileSync(CHECKED_IN, 'utf8')).toBe(skill)
  })
})
