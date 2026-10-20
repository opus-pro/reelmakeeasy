import fs from 'node:fs'
import path from 'node:path'

import { AGENT_TOOLS } from '../tools/agent-tools'

import { RANKING_SKILL_NAME, renderRankingSkill } from './ranking-skill'

const CHECKED_IN = path.resolve(__dirname, '../../../../../../skills/reelmakeeasy-ranking/SKILL.md')

describe('renderRankingSkill', () => {
  const skill = renderRankingSkill()

  it('has skill frontmatter whose description is one plain YAML line', () => {
    expect(skill.startsWith(`---\nname: ${RANKING_SKILL_NAME}\ndescription: `)).toBe(true)
    expect((skill.split('\n')[2] ?? '').slice('description: '.length)).not.toMatch(/: | #/)
  })

  it('names every ranking tool, and each one exists', () => {
    const tools = Object.keys(AGENT_TOOLS).filter((t) => t.startsWith('ranking_'))
    expect(tools).toHaveLength(13)
    for (const tool of tools) expect(skill).toContain(`\`${tool}\``)
  })

  it('matches the checked-in copy', () => {
    expect(fs.readFileSync(CHECKED_IN, 'utf8')).toBe(skill)
  })
})
