import { OPENING_RULES, OPENING_TEMPLATES } from '../craft/opening-craft'

import {
  BRIEF_SCHEMA,
  BriefSchema,
  IDEAS_PROMPT,
  OPENINGS_PROMPT,
  OpeningsSchema,
  POLISH_PROMPT,
} from './autonomous-prompts'

describe('timing in the ideas and the brief', () => {
  const ideas = IDEAS_PROMPT('2026-10-08', {
    avoid: [],
    figureKind: 'an explorer',
    funFactTopic: 'water',
  })

  it('asks for the date of the finding itself, traced to its original publication', () => {
    expect(ideas).toContain('when:')
    expect(ideas).toContain('first published or announced')
    expect(ideas).toContain('2026-09-24')
  })

  it('asks Codex to fact-check every idea against reputable sources', () => {
    expect(ideas).toContain('Fact-check every idea')
  })

  it('has the brief fact-check its claims and keep timing true without adding dates', () => {
    const brief = POLISH_PROMPT('Fun fact: Droplets climb uphill. (When: 2006)')
    expect(brief).toContain('Fact-check every claim')
    expect(brief).toContain('Never call it new, recent or just discovered')
    expect(brief).toContain('do not put dates in the brief')
  })

  it("leaves the length out of the brief: the user picks it on Easy's length card", () => {
    const brief = POLISH_PROMPT('Fun fact: Droplets climb uphill.')
    expect(brief).not.toMatch(/durationSeconds|15, 30 or 60/)
    expect(BRIEF_SCHEMA).toMatchObject({ required: ['title', 'brief'] })
    expect(BriefSchema.parse({ brief: 'b', durationSeconds: 15, title: 't' })).toEqual({
      brief: 'b',
      title: 't',
    })
  })
})

describe('OPENING_TEMPLATES', () => {
  it('holds the 30 proven short-video openers in six groups', () => {
    expect(OPENING_TEMPLATES.map((g) => g.group)).toEqual([
      'Curiosity',
      'Callout',
      'Opinion',
      'List',
      'Story',
      'How-to',
    ])
    expect(OPENING_TEMPLATES.flatMap((g) => g.templates)).toHaveLength(30)
  })
})

describe('OPENINGS_PROMPT', () => {
  const brief = {
    brief: 'Why the Moon drifts away.',
    title: 'The Drifting Moon',
  }
  const prompt = OPENINGS_PROMPT(brief)

  it('asks for three openings, best first, with the rules and the brief', () => {
    expect(prompt).toContain('three opening lines')
    // The length is picked after the hook, so the openings don't assume one.
    expect(prompt).not.toMatch(/\d+-second/)
    expect(prompt).toContain(OPENING_RULES)
    expect(prompt).toContain('Why the Moon drifts away.')
    expect(prompt).toContain('best first')
  })

  it('lists every template and asks to fill the three that fit best, from different groups', () => {
    for (const template of OPENING_TEMPLATES.flatMap((g) => g.templates))
      expect(prompt).toContain(template)
    expect(prompt).toContain('Pick the three templates')
    expect(prompt).toContain('different groups')
    expect(prompt).toContain('style (the group name')
  })

  it('never invents a personal story for the narrator', () => {
    expect(prompt).toContain('Never invent a personal experience')
  })
})

describe('opening craft', () => {
  it('wants familiar everyday words, and no longer bans "Did you know"', () => {
    expect(OPENING_RULES).toContain('familiar')
    expect(OPENING_RULES).toContain('vending machine')
    expect(OPENING_RULES).not.toMatch(/Never start with[^\n]*Did you know/)
  })
})

describe('OpeningsSchema', () => {
  const opening = {
    line: 'Is the Moon leaving us?',
    style: 'Question',
    why: 'Everyone sees the Moon.',
  }

  it('accepts exactly three openings and trims them', () => {
    const parsed = OpeningsSchema.parse({
      openings: [opening, opening, { ...opening, line: '  X?  ' }],
    })
    expect(parsed.openings[2].line).toBe('X?')
  })

  it('rejects two or four openings', () => {
    expect(() => OpeningsSchema.parse({ openings: [opening, opening] })).toThrow()
    expect(() => OpeningsSchema.parse({ openings: [opening, opening, opening, opening] })).toThrow()
  })
})
