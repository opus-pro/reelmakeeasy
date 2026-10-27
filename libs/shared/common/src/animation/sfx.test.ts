import fs from 'node:fs'
import path from 'node:path'

import { SFX_SAMPLE_RATE } from '../motion-reel/sfx'

import { ANIMATION_SFX_NAMES, CARTOON_SFX_NAMES, synthesiseAnimationSfx } from './sfx'

describe('the animation sound effects', () => {
  it.each(ANIMATION_SFX_NAMES)('%s is short, audible and the same every time', (name) => {
    const a = synthesiseAnimationSfx(name)
    const b = synthesiseAnimationSfx(name)
    expect(a).toEqual(b)
    expect(a.length / SFX_SAMPLE_RATE).toBeLessThan(2.5)
    expect(Math.max(...a.map(Math.abs))).toBeGreaterThan(0.05)
  })

  it.each(CARTOON_SFX_NAMES)('%s starts and stops at silence (no click)', (name) => {
    const s = synthesiseAnimationSfx(name)
    expect(Math.abs(s[0] ?? 1)).toBeLessThan(0.01)
    expect(Math.abs(s[s.length - 1] ?? 1)).toBeLessThan(0.01)
  })

  it("matches the kit's list, so <Sfx name> only names sounds that exist", () => {
    const kit = fs.readFileSync(
      path.join(__dirname, '../../../../../presets/animation/template/src/kit.tsx'),
      'utf8',
    )
    const listed = /export const SFX = \[([^\]]*)\]/.exec(kit)?.[1] ?? ''
    expect([...listed.matchAll(/'([a-z-]+)'/g)].map((m) => m[1])).toEqual([...ANIMATION_SFX_NAMES])
  })
})
