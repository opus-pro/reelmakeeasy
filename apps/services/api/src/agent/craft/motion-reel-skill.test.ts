import fs from 'node:fs'
import path from 'node:path'

import { SFX_NAMES } from '@reelmakeeasy/common/motion-reel/sfx'
import { MOTION_REEL_STYLES } from '@reelmakeeasy/common/motion-reel/styles'

import {
  MOTION_MUSIC_TOOL,
  MOTION_REEL_SKILL_NAME,
  MOTION_RENDER_TOOL,
  MOTION_STILL_TOOL,
  renderMotionReelSkill,
} from './motion-reel-skill'

const CHECKED_IN = path.resolve(
  __dirname,
  '../../../../../../skills/reelmakeeasy-motion-reel/SKILL.md',
)

describe('renderMotionReelSkill', () => {
  const skill = renderMotionReelSkill()

  it('has skill frontmatter whose description is one plain YAML line', () => {
    expect(skill.startsWith(`---\nname: ${MOTION_REEL_SKILL_NAME}\ndescription: `)).toBe(true)
    const description = skill.split('\n')[2] ?? ''
    expect(description.slice('description: '.length)).not.toMatch(/: | #/)
  })

  it('names the music and render tools, every sound effect and every style', () => {
    expect(skill).toContain(MOTION_STILL_TOOL)
    expect(skill).toContain(MOTION_RENDER_TOOL)
    expect(skill).toContain(MOTION_MUSIC_TOOL)
    for (const name of SFX_NAMES) expect(skill).toContain(`\`${name}\``)
    for (const style of MOTION_REEL_STYLES) expect(skill).toContain(`\`${style.id}\``)
  })

  it('keeps the agent off the network and the renderer', () => {
    expect(skill).toMatch(/Never run `remotion render`, `remotion still` or `npm install` yourself/)
  })

  it('matches the checked-in copy (run the skill renderer to update it)', () => {
    expect(fs.readFileSync(CHECKED_IN, 'utf8')).toBe(skill)
  })
})
