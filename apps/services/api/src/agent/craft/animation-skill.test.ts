import fs from 'node:fs'
import path from 'node:path'

import { AGENT_SKILL_NAMES } from '../codex/codex-home'

import { ANIMATION_SKILL_NAMES, renderAnimationSkill } from './animation-skill'

const LOOKS = ['2d', '3d', '8bit'] as const

const checkedIn = (look: string) =>
  path.resolve(__dirname, `../../../../../../skills/reelmakeeasy-animation-${look}/SKILL.md`)

describe('renderAnimationSkill', () => {
  it.each(LOOKS)('the %s skill has one-line frontmatter and names every tool', (look) => {
    const skill = renderAnimationSkill(look)
    expect(skill.startsWith(`---\nname: reelmakeeasy-animation-${look}\ndescription: `)).toBe(true)
    const description = skill.split('\n')[2] ?? ''
    expect(description.slice('description: '.length)).not.toMatch(/: | #/)
    for (const tool of [
      'animation_voice',
      'animation_still',
      'animation_render',
      'animation_review',
      'animation_music',
    ])
      expect(skill).toContain(tool)
    // Never one render and done: check, fix, render again.
    expect(skill).toMatch(
      /\*\*Review\.\*\* Nothing is one-shot.*animation_review.*review\.md.*up to 3 rounds/,
    )
  })

  it.each(LOOKS)('the %s skill keeps Claude off the renderer and the network', (look) => {
    expect(renderAnimationSkill(look)).toMatch(
      /Never run `remotion render`, `remotion still` or `npm install` yourself/,
    )
  })

  it.each(LOOKS)('matches the checked-in %s copy (UPDATE_SKILLS=1 rewrites it)', (look) => {
    if (process.env['UPDATE_SKILLS'] === '1') {
      fs.mkdirSync(path.dirname(checkedIn(look)), { recursive: true })
      fs.writeFileSync(checkedIn(look), renderAnimationSkill(look))
    }
    expect(fs.readFileSync(checkedIn(look), 'utf8')).toBe(renderAnimationSkill(look))
  })

  it("names the look's own library and voices", () => {
    expect(renderAnimationSkill('2d')).toContain('src/toon')
    expect(renderAnimationSkill('2d')).toMatch(/two characters/)
    expect(renderAnimationSkill('3d')).toContain('src/stage')
    expect(renderAnimationSkill('8bit')).toContain('src/pixel')
    expect(renderAnimationSkill('8bit')).toMatch(/narrator/)
  })

  it('is shipped into the agent skills', () => {
    for (const name of ANIMATION_SKILL_NAMES) expect(AGENT_SKILL_NAMES).toContain(name)
  })
})
