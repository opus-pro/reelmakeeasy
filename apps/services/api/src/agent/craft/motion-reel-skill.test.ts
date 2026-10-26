import fs from 'node:fs'
import path from 'node:path'

import { SFX_NAMES } from '@reelmakeeasy/common/motion-reel/sfx'

import {
  MOTION_MUSIC_TOOL,
  MOTION_REEL_SKILL_NAME,
  MOTION_RENDER_TOOL,
  MOTION_SETUP_TOOL,
  MOTION_STILL_TOOL,
  renderMotionReelSkill,
} from './motion-reel-skill'
import { MUSIC_COMPOSER_SKILL_NAME } from './music-composer-skill'

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

  it('names the setup, music and render tools, the helpers and every sound effect', () => {
    for (const tool of [
      MOTION_SETUP_TOOL,
      MOTION_MUSIC_TOOL,
      MOTION_STILL_TOOL,
      MOTION_RENDER_TOOL,
    ])
      expect(skill).toContain(`\`${tool}\``)
    for (const file of ['brief.md', 'public/reel.json', 'music-map.md', 'music.wav', 'sfx/'])
      expect(skill).toContain(file)
    for (const helper of [
      'src/grid.ts',
      'src/kit.tsx',
      'src/transitions.tsx',
      '`beat(n)`',
      '`bar(n)`',
    ])
      expect(skill).toContain(helper)
    expect(skill).toMatch(/sync report/)
    for (const name of SFX_NAMES) expect(skill).toContain(`\`${name}\``)
  })

  it('is mechanics only: no styles, no creative method; the type and the user bring that', () => {
    expect(skill).toMatch(
      /The creative method comes from the reel's type \(in `brief.md`\) and the user/,
    )
    expect(skill).not.toMatch(/style\.md|style card|The styles|hud-showreel|product-ui-launch/)
    expect(skill).not.toMatch(/world|climax|Craft rules|How to work|Show the product working/i)
    expect(skill.split('\n').length).toBeLessThan(80)
  })

  it('sends composed music to the composer skill, and keeps the music models', () => {
    expect(skill).toContain(`\`${MUSIC_COMPOSER_SKILL_NAME}\` skill`)
    expect(skill).toContain('`engine: "composer"`')
    expect(skill).toContain('`engine: "eleven-music"` or `"ace-step"`')
  })

  it('keeps the hard technical rules', () => {
    expect(skill).toMatch(/Never run `remotion render`, `remotion still` or `npm install` yourself/)
    expect(skill).toMatch(/Work only inside `reel\/`/)
    expect(skill).toMatch(/deterministic: no `Math.random\(\)`/)
    expect(skill).toMatch(/6% safe margin/)
    expect(skill).toMatch(/Fonts only through `@remotion\/google-fonts`/)
  })

  it('matches the checked-in copy (run the skill renderer to update it)', () => {
    expect(fs.readFileSync(CHECKED_IN, 'utf8')).toBe(skill)
  })
})
