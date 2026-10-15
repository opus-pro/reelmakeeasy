import { createTailwindColors, createTailwindFontSize } from './index'

describe('tokens', () => {
  it('builds the Tailwind font sizes from the typescale', () => {
    const sizes = createTailwindFontSize()
    expect(Object.keys(sizes)).toHaveLength(17)
    expect(sizes['body-sm']).toEqual([
      '14px',
      { fontWeight: '400', letterSpacing: '0px', lineHeight: '22px' },
    ])
  })

  it('binds the function-form colors to the given withAlphaVar', () => {
    const colors = createTailwindColors((cssVar) => `alpha(${cssVar})`) as Record<string, unknown>
    expect(colors.background).toBe('alpha(--bg-background)')
    expect(colors.error).toBe('#E5484D')
  })
})
