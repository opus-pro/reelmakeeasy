import fs from 'node:fs'
import path from 'node:path'

import { SFX_NAMES } from '@reelmakeeasy/common/motion-reel/sfx'

import {
  MOTION_MUSIC_TOOL,
  MOTION_REEL_SKILL_NAME,
  MOTION_RENDER_TOOL,
  MOTION_REVIEW_TOOL,
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

  it('names the setup, music, render and review tools, the helpers and every sound effect', () => {
    for (const tool of [
      MOTION_SETUP_TOOL,
      MOTION_MUSIC_TOOL,
      MOTION_STILL_TOOL,
      MOTION_RENDER_TOOL,
      MOTION_REVIEW_TOOL,
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

  it('brings no styles or creative method: the type and the user bring the look', () => {
    expect(skill).toMatch(
      /The creative method comes from the reel's type \(in `brief.md`\) and the user/,
    )
    expect(skill).not.toMatch(/style\.md|style card|The styles|hud-showreel|product-ui-launch/)
    expect(skill).not.toMatch(/world|climax|Craft rules|How to work|Show the product working/i)
    expect(skill.split('\n').length).toBeLessThan(100)
  })

  it('names motion_review and says what it returns', () => {
    expect(MOTION_REVIEW_TOOL).toBe('motion_review')
    expect(skill).toMatch(
      /contact sheets \(a frame every 0\.5 s, 8 frames a row, so one row is 4 s/,
    )
    expect(skill).toMatch(/with a pace report/)
    expect(skill).toMatch(/every stall of 0\.5 s or more by time and beat/)
  })

  it('has the pace rules: one idea in 4 s, 8 s only with a reason, light screens in 1-2 s', () => {
    expect(skill).toMatch(/## Pace/)
    expect(skill).toMatch(/One idea gets at most 4 s/)
    expect(skill).toMatch(/over 8 s only with a reason written in the plan/)
    expect(skill).toMatch(/A light screen \(a score, a stat, a title\) gets 1-2 s/)
    expect(skill).toMatch(/split into two different shots on the same topic/)
    // The check never reads the plan: a joining move needs a visible change at each idea.
    expect(skill).toMatch(
      /The sync check never reads the plan: it finds shots from cuts and big changes/,
    )
  })

  it('treats depth as one tool: mostly flat scenes, transitions that join them', () => {
    expect(skill).toMatch(/## Transitions and depth/)
    expect(skill).toMatch(/Most scenes are flat and clean/)
    expect(skill).toMatch(/one tool among many, not the look: use it for one or two moments/)
    expect(skill).toMatch(/never add depth for its own sake/)
    expect(skill).toMatch(/the next scene is ready before the move reveals it/)
    expect(skill).not.toMatch(/Stage every scene in depth/)
    expect(skill).not.toMatch(/the exception, not the default/)
    // Shot's flat moves are fine; how to build the rare join in depth.
    expect(skill).toMatch(/These are flat moves, fine for most cuts/)
    expect(skill).toMatch(/one `<Sequence>` inside one `perspective` container/)
  })

  it('bans stall frames: something moves on every frame, holds at most 0.5 s', () => {
    expect(skill).toMatch(/## No stall frames/)
    expect(skill).toMatch(/Something visible moves on every frame/)
    expect(skill).toMatch(/A hold lasts at most 0\.5 s; only the end card holds longer/)
    expect(skill).toMatch(/once a reel a payoff beat .* of up to 1\.5 s/)
    expect(skill).toMatch(
      /starts on a cut or a big change in the reel's last fifth and at most 6 s from the end/,
    )
    expect(skill).toMatch(
      /A slow drift \(2% of the width a second\) or a glow alone reads as still/,
    )
  })

  it('has a plan.md block per scene with its idea, staging, transitions and motion', () => {
    expect(skill).toMatch(/one short block per scene: its seconds and its beats or bars/)
    expect(skill).toMatch(/the one idea it shows; what is on screen and where/)
    expect(skill).toMatch(
      /how each joins the neighbouring scene \(and, for the one or two moments that use depth, what waits behind\); and what keeps moving/,
    )
  })

  it('makes the review loop mandatory, with review.md and a fresh reviewer subagent', () => {
    expect(skill).toMatch(/## The review loop/)
    expect(skill).toMatch(/After every render, call `motion_review` and open every contact sheet/)
    expect(skill).toMatch(/Write `reel\/review\.md`: the problems by time/)
    expect(skill).toMatch(/the change of strategy/)
    expect(skill).toMatch(
      /If your harness has a subagent, give a fresh reviewer subagent the sheets/,
    )
    expect(skill).toMatch(/up to 3 rounds\. Never tell the user the reel is done after one render/)
    // Generic: no harness-specific tool names.
    expect(skill).not.toMatch(/\bAgent tool\b|\bTask tool\b/)
    // The render tool's own line sends the agent to the review too.
    expect(skill).toMatch(/Whether it passes or not, call `motion_review` next/)
    expect(skill).toMatch(/At most 3 renders, one per review round/)
  })

  it('sends composed music to the composer skill, and keeps the music models', () => {
    expect(skill).toContain(`\`${MUSIC_COMPOSER_SKILL_NAME}\` skill`)
    expect(skill).toContain('`engine: "composer"`')
    expect(skill).toContain('`engine: "eleven-music"` or `"ace-step"`')
  })

  it('has the agent show the plan in its reply before it asks to build it', () => {
    expect(skill).toMatch(/## The plan/)
    expect(skill).toMatch(/write the plan in your reply text too, not only in your thinking/)
    expect(skill).toMatch(/one short line per scene with its beats or bars/)
    expect(skill).toMatch(/never ask "Build this plan\?" without the plan above it/)
    expect(skill).toMatch(/the Tasks panel shows it to the user/)
    expect(skill.indexOf('in your reply text')).toBeLessThan(skill.indexOf('Only then ask'))
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
