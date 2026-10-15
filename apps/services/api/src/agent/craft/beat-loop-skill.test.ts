import fs from 'node:fs'
import path from 'node:path'

import {
  BEAT_CLIP_TEMPLATE_H3,
  BEAT_LINE_OFFSET_SECONDS,
  BEAT_LOOP_LENGTHS,
  BEAT_LOOP_STYLE_PRESETS,
  BEAT_MAX_SPEEDUP,
  BEAT_SPEECH_END_SECONDS,
  CUT_CAMERAS,
  EXPLAINER_COLLAGE_STYLE,
  HIT_CAMERAS,
  KEYFRAME_STYLE_REFERENCE_PREFIX,
  NARRATION_WORDS,
  NO_TEXT_LINE,
  STAMP_MAX_CHARS,
  validateBeatLoopStoryboard,
} from '@reelmakeeasy/common/long-take/beat-loop-craft'

import { BEAT_LOOP_SKILL_NAME, renderBeatLoopSkill } from './beat-loop-skill'

const CHECKED_IN = path.resolve(__dirname, '../../../../../../skills/reelmakeeasy-beat-loop/SKILL.md')

/** The text of one `## ` section, up to the next one. */
function section(skill: string, heading: string): string {
  const start = skill.indexOf(`\n## ${heading}`)
  if (start === -1) throw new Error(`no section "${heading}"`)
  const end = skill.indexOf('\n## ', start + 1)
  return skill.slice(start, end === -1 ? undefined : end)
}

describe('renderBeatLoopSkill', () => {
  const skill = renderBeatLoopSkill()

  it('has skill frontmatter whose description is one plain YAML line', () => {
    expect(skill.startsWith(`---\nname: ${BEAT_LOOP_SKILL_NAME}\ndescription: `)).toBe(true)
    const description = skill.split('\n')[2] ?? ''
    // A plain YAML scalar can't hold ": " or " #".
    expect(description.slice('description: '.length)).not.toMatch(/: | #/)
    expect(description).toMatch(/fun facts, explainers, product moments/)
    expect(description).toContain('make_beat_loop')
    expect(skill.split('\n')[3]).toBe('---')
  })

  it("keeps the owner's sections 1-4, 6, 7 and 10, and leaves out what ReelMakeEasy does itself", () => {
    for (const heading of [
      '1. What the pipeline needs',
      '2. Story structure',
      '3. Keyframes (the storyboard images)',
      '4. The clip prompt',
      '6. Narration',
      '7. Text on screen (captions and facts)',
      '10. Storyboard schema (hand this to the writing bot)',
      'How to make one here',
    ])
      expect(skill).toContain(`\n## ${heading}\n`)
    for (const left of ['## 5.', '## 8.', '## 9.', '## 11.']) expect(skill).not.toContain(left)
    expect(skill).toContain('### Style presets that worked')
  })

  it('shows the H3 clip template verbatim, with the music line last', () => {
    expect(skill).toContain(`\`\`\`\n${BEAT_CLIP_TEMPLATE_H3}\n\`\`\``)
    expect(BEAT_CLIP_TEMPLATE_H3.trimEnd().endsWith('non_diegetic_music: N/A')).toBe(true)
  })

  it('lists exactly the camera commands the storyboard check accepts', () => {
    const vocabulary = section(skill, '4. The clip prompt').split('### Camera vocabulary')[1] ?? ''
    const row = vocabulary.split('\n').find((line) => line.startsWith('| `')) ?? ''
    const [hits = '', cuts = ''] = row.split('|').slice(1, 3)
    const named = (cell: string): string[] =>
      [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1] ?? '')
    expect(named(hits)).toEqual([...HIT_CAMERAS])
    expect(new Set(named(cuts))).toEqual(new Set(CUT_CAMERAS))
    expect(named(cuts)).toHaveLength(CUT_CAMERAS.length)
  })

  it('takes the lengths, word counts, timings and keyframe lines from the craft constants', () => {
    const lengths = section(skill, '1. What the pipeline needs')
    for (const seconds of BEAT_LOOP_LENGTHS)
      expect(lengths).toMatch(new RegExp(`\\b${seconds}s = ${seconds / 4}\\b`))
    expect(lengths).toContain('**24s = 6**')
    const narration = section(skill, '6. Narration')
    expect(narration).toContain(`**${NARRATION_WORDS.bestMin}–${NARRATION_WORDS.bestMax} words`)
    expect(narration).toContain(`about ${BEAT_SPEECH_END_SECONDS}s`)
    expect(narration).toContain(`max about ${BEAT_MAX_SPEEDUP}×`)
    expect(narration).toContain(`**${BEAT_LINE_OFFSET_SECONDS}s into its clip**`)
    expect(section(skill, '7. Text on screen')).toContain('from 0.3s until 3.0s of the clip')
    const keyframes = section(skill, '3. Keyframes')
    expect(keyframes).toContain(`"${KEYFRAME_STYLE_REFERENCE_PREFIX.trimEnd()} …"`)
    expect(keyframes).toContain(`"${NO_TEXT_LINE.replace(/\.$/, '')}"`)
  })

  it('gives every style preset, the explainer collage as the example style', () => {
    const presets = skill.split('### Style presets that worked')[1] ?? ''
    // Camera commands named in a preset are set as code ("impacts with `Shake`").
    expect(presets).toContain('impacts with `Shake`')
    const plain = presets.replaceAll('`', '')
    for (const preset of BEAT_LOOP_STYLE_PRESETS) {
      expect(presets).toContain(`**${preset.name}`)
      expect(plain).toContain(preset.hits)
      expect(plain).toContain(preset.cuts)
    }
    const spelledOut = BEAT_LOOP_STYLE_PRESETS.filter((p) => p.style !== EXPLAINER_COLLAGE_STYLE)
    expect(spelledOut.length).toBeGreaterThan(0)
    for (const preset of spelledOut) expect(presets).toContain(`"${preset.style}"`)
    expect(presets).toContain('the style string above.')
    expect(section(skill, '10. Storyboard schema')).toContain(
      `"style": ${JSON.stringify(EXPLAINER_COLLAGE_STYLE)}`,
    )
  })

  it("writes an example storyboard whose fields pass the server's checks", () => {
    const schema = section(skill, '10. Storyboard schema')
    const json = /```json\n([\s\S]*?)\n```/.exec(schema)?.[1] ?? ''
    const result = validateBeatLoopStoryboard(json)
    expect(result.ok).toBe(false)
    // Only the shortened lists fall short: two of six clips, and a placeholder string for the
    // keyframes in between.
    const fieldIssues = result.ok
      ? []
      : result.issues.filter(
          (issue) =>
            !issue.startsWith('clips: duration_s 24 needs 6 clips') &&
            !issue.startsWith('keyframes: 6 clips need 6 keyframes') &&
            !/^keyframes\[2\]: must be an object/.test(issue),
        )
    expect(fieldIssues).toEqual([])
    expect(json).toContain('"same_as": "f0"')
    expect(json).toContain(NO_TEXT_LINE)
  })

  it('says how to make one here: storyboard JSON, the lines and stamps shown, then make_beat_loop', () => {
    const howTo = section(skill, 'How to make one here')
    expect(howTo).toContain('make_beat_loop')
    expect(howTo).toMatch(/storyboard JSON/i)
    expect(howTo).toMatch(/numbered narration lines/)
    expect(howTo).toMatch(/stamp/)
    expect(howTo.indexOf('numbered narration lines')).toBeLessThan(howTo.indexOf('make_beat_loop'))
    for (const camera of [...HIT_CAMERAS, ...CUT_CAMERAS]) expect(howTo).toContain(camera)
    expect(howTo).toContain(`${NARRATION_WORDS.min}–${NARRATION_WORDS.max} words`)
    expect(howTo).toContain(`at most ${STAMP_MAX_CHARS} characters`)
    // On Gemini, "newsprint" made Omni paint lettered pages; ReelMakeEasy blanks it there.
    expect(howTo).toMatch(/newsprint/)
    expect(howTo).toMatch(/blank/)
  })

  it('says make_beat_loop says every line first, and what it answers for a line too long', () => {
    const howTo = section(skill, 'How to make one here')
    expect(howTo).toMatch(/says every line in that voice first/)
    expect(howTo).toContain(`even at ${BEAT_MAX_SPEEDUP}x`)
    expect(howTo).toContain('"about 8 short words, no quotes or colons"')
    expect(howTo).toMatch(/free voice on this computer/)
    expect(howTo).toMatch(/quotes, colons and dashes add pauses/)
  })

  it("starts loops in Punch and leaves the captions' look to the user: no placement, no recipe", () => {
    const text = section(skill, '7. Text on screen')
    // The chunking rules stay: they are what the app draws.
    expect(text).toMatch(/1–3 words at a time/)
    expect(text).toMatch(/until the\s+next one, never past its own clip/)
    // What a new loop looks like, so the agent describes it right.
    expect(text).toMatch(/A loop starts in the Punch caption style/)
    expect(text).toMatch(/one highlighted\s+word per caption/)
    expect(text).toMatch(/you never set them/)
    expect(text).not.toMatch(/66%|Explainer|stroke|paper strip|typewriter/)
    expect(skill).not.toContain('caption_style')
    const howTo = section(skill, 'How to make one here')
    expect(howTo).toMatch(/`accent` is optional/)
    expect(howTo).toMatch(/only as a suggestion/)
    expect(howTo).toMatch(/never applied on its own/)
  })

  it('names the card\'s real button, "Make it", never a confirm step', () => {
    // An agent told "the user confirms" sent the user to a "Confirm" button that isn't there.
    expect(skill).toContain('"Make it"')
    expect(skill).not.toMatch(/confirm/i)
  })

  it('shows the user only the lines, the stamps and a one-line ask: no notes, no files', () => {
    const howTo = section(skill, 'How to make one here')
    // A live chat showed "The loop skill requires ..." and a link to this file.
    expect(howTo).toMatch(/one-line ask/)
    expect(howTo).toMatch(/never the storyboard JSON/)
    expect(howTo).toMatch(/never mention this skill, its rules or why you ask/i)
    expect(howTo).toMatch(/no file paths or links/)
    // The card's answers, so the agent sends the user to the right button.
    expect(howTo).toContain('**Make it**')
    expect(howTo).toContain('**Not now**')
  })

  it('matches the checked-in copy (run with UPDATE_SKILLS=1 to rewrite it)', () => {
    if (process.env.UPDATE_SKILLS === '1') {
      fs.mkdirSync(path.dirname(CHECKED_IN), { recursive: true })
      fs.writeFileSync(CHECKED_IN, skill)
    }
    expect(fs.readFileSync(CHECKED_IN, 'utf8')).toBe(skill)
  })
})
