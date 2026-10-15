import {
  carryDeliveryTags,
  DELIVERY_TAGS,
  parseDelivery,
  planQwen3Segments,
  questionKind,
  RISING_QUESTION_INSTRUCT,
  splitTagQuestion,
  stripDeliveryMarkup,
} from './delivery-markup'

describe('delivery markup', () => {
  it('strips tags for speech and captions', () => {
    expect(stripDeliveryMarkup('[excited] We did it! [whisper] Tell no one.')).toBe(
      'We did it! Tell no one.',
    )
  })

  it('classifies questions', () => {
    expect(questionKind('We can finish today, right?')).toBe('tag')
    expect(questionKind("It's great, isn't it?")).toBe('tag')
    expect(questionKind('Can we finish today?')).toBe('yes-no')
    expect(questionKind('So when can we finish?')).toBe('wh')
    expect(questionKind('We finish today.')).toBeUndefined()
  })

  it('splits a tag question from its statement', () => {
    expect(splitTagQuestion('We can finish the whole video today, right?')).toEqual({
      head: 'We can finish the whole video today,',
      tag: 'Right?',
    })
    expect(splitTagQuestion("That's the plan, don't you think?")?.tag).toBe("Don't you think?")
    expect(splitTagQuestion('Can we finish today?')).toBeNull()
  })

  it('keeps a tag in effect until the next one, and drops unknown tags', () => {
    const s = parseDelivery('[excited] We did it! It works. [neutral] Next up. [shouting] Done.')
    expect(s.map((x) => [x.text, x.tag])).toEqual([
      ['We did it!', 'excited'],
      ['It works.', 'excited'],
      ['Next up.', undefined],
      ['Done.', undefined],
    ])
  })
})

describe('Qwen3 segment plan', () => {
  it('leaves a plain script as one request', () => {
    const plan = planQwen3Segments('One idea. Two ideas. Three.', true)
    expect(plan).toEqual([{ pauseBeforeMs: 0, text: 'One idea. Two ideas. Three.' }])
  })

  it('gives preset speakers an instruction per delivery run, rising on questions', () => {
    const plan = planQwen3Segments(
      '[excited] We did it! It works. Ready to launch? [calm] Take a breath.',
      true,
    )
    expect(plan.map((p) => [p.text, p.instruct, p.preferRising])).toEqual([
      ['We did it! It works.', DELIVERY_TAGS['excited'], undefined],
      ['Ready to launch?', `${DELIVERY_TAGS['excited']} ${RISING_QUESTION_INSTRUCT}`, true],
      ['Take a breath.', DELIVERY_TAGS['calm'], undefined],
    ])
  })

  it('does not force a rise on wh-questions', () => {
    const plan = planQwen3Segments('So where do we start? Right here.', true)
    expect(plan).toHaveLength(1)
  })

  it('re-rolls questions for cloned voices and splits off tag questions', () => {
    const plan = planQwen3Segments(
      '[excited] Big news. We can ship today, right? Can you believe it? Let us go.',
      false,
    )
    expect(plan).toEqual([
      { pauseBeforeMs: 0, text: 'Big news. We can ship today,' },
      { pauseBeforeMs: 70, preferRising: true, text: 'Right?' },
      { pauseBeforeMs: 450, preferRising: true, text: 'Can you believe it?' },
      { pauseBeforeMs: 450, text: 'Let us go.' },
    ])
    expect(plan.some((p) => p.instruct)).toBe(false)
  })

  it('carries the active tag into the next chunk', () => {
    expect(
      carryDeliveryTags(['[sad] It ended. Quietly.', 'Then morning came.', '[neutral] Fin.']),
    ).toEqual(['[sad] It ended. Quietly.', '[sad] Then morning came.', '[neutral] Fin.'])
  })
})
