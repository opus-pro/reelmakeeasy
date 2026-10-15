import { buildLongTakeScriptPrompt, ensureOpeningLine } from './long-take-script'

describe('ensureOpeningLine', () => {
  const opening = 'Is the Moon slowly slipping away from Earth?'

  it('keeps a script that already starts with it, ignoring case and punctuation', () => {
    const script = 'is the moon slowly slipping away from earth! It is. Here is why.'
    expect(ensureOpeningLine(script, opening)).toEqual({ changed: false, script })
  })

  it('replaces a first sentence the model changed', () => {
    expect(ensureOpeningLine('Is the Moon leaving? It is. Here is why.', opening)).toEqual({
      changed: true,
      script: 'Is the Moon slowly slipping away from Earth? It is. Here is why.',
    })
  })

  it('prepends the opening to a script with a single sentence', () => {
    expect(ensureOpeningLine('The Moon drifts 3.8 cm a year', opening)).toEqual({
      changed: true,
      script: 'Is the Moon slowly slipping away from Earth? The Moon drifts 3.8 cm a year',
    })
  })
})

describe('ensureOpeningLine on harder scripts', () => {
  it('replaces as many sentences as a two-sentence opening has, without duplicating', () => {
    expect(
      ensureOpeningLine(
        'Comets are just dirty snowballs, right? Not quite. They are rock and ice.',
        'Comets are dirty snowballs. Not quite.',
      ).script,
    ).toBe('Comets are dirty snowballs. Not quite. They are rock and ice.')
  })

  it('does not split on an abbreviation like "Dr."', () => {
    expect(
      ensureOpeningLine(
        'Dr. Jones changed medicine forever. Here is how.',
        'One doctor changed medicine forever.',
      ).script,
    ).toBe('One doctor changed medicine forever. Here is how.')
  })

  it('treats a sentence ending in a closing quote as one sentence', () => {
    expect(
      ensureOpeningLine(
        '"Look up." That is all it takes tonight. A comet passes.',
        'Look up tonight.',
      ).script,
    ).toBe('Look up tonight. That is all it takes tonight. A comet passes.')
  })

  it('does not end a sentence at an ellipsis followed by lowercase', () => {
    expect(
      ensureOpeningLine(
        'Three things surprise everyone… the last one is wild. First, sleep.',
        'Three things your brain does at night… the last one is wild.',
      ).script,
    ).toBe('Three things your brain does at night… the last one is wild. First, sleep.')
  })

  it('keeps decimals inside a sentence', () => {
    expect(
      ensureOpeningLine('It drifts 3.8 cm a year. That adds up.', 'Is the Moon leaving us?').script,
    ).toBe('Is the Moon leaving us? That adds up.')
  })
})

describe('buildLongTakeScriptPrompt', () => {
  const base = {
    hasUserLengthRequest: true,
    maxWords: 100,
    rawInput: 'A video about the Moon',
    targetWords: 75,
  }

  it('says nothing about an opening line when none is given', () => {
    expect(buildLongTakeScriptPrompt(base)).not.toContain('Opening line')
  })

  it('tells PATH B (writing a new script) to begin with the opening, quotes and all', () => {
    const prompt = buildLongTakeScriptPrompt({ ...base, openingLine: 'Is "the Moon" leaving?' })
    expect(prompt).toContain('Opening line')
    expect(prompt).toContain('Is "the Moon" leaving?')
    // A pasted script (PATH A) stays verbatim: the rule sits inside PATH B only.
    expect(prompt.indexOf('Opening line')).toBeGreaterThan(prompt.indexOf('[PATH B'))
    expect(prompt.indexOf('Opening line')).toBeLessThan(prompt.indexOf('Step 3'))
  })
})
