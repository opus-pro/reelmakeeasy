import {
  DICTATION_MENU_ORDER,
  DICTATION_PRICE,
  formatElapsed,
  insertSpoken,
  recordingMimeType,
} from './dictation-text'

describe('insertSpoken', () => {
  it('fills an empty box', () => {
    expect(insertSpoken('', '  make a video about cats ')).toEqual({
      cursor: 'make a video about cats'.length,
      value: 'make a video about cats',
    })
  })

  it('adds a space after existing text, at the end by default', () => {
    expect(insertSpoken('Hello', 'world')).toEqual({ cursor: 11, value: 'Hello world' })
    expect(insertSpoken('Hello ', 'world')).toEqual({ cursor: 11, value: 'Hello world' })
  })

  it('goes in at the cursor, with spaces on both sides as needed', () => {
    const value = 'Make a video in watercolor'
    const at = 'Make a video'.length
    expect(insertSpoken(value, 'about cats', at)).toEqual({
      cursor: 'Make a video about cats'.length,
      value: 'Make a video about cats in watercolor',
    })
  })

  it('leaves the box alone when nothing was said', () => {
    expect(insertSpoken('Hi', '   ', 1)).toEqual({ cursor: 1, value: 'Hi' })
  })

  it('keeps a cursor past the end inside the text', () => {
    expect(insertSpoken('Hi', 'there', 99).value).toBe('Hi there')
  })
})

describe('formatElapsed', () => {
  it('shows minutes and seconds', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(9.7)).toBe('0:09')
    expect(formatElapsed(75)).toBe('1:15')
  })
})

describe('recordingMimeType', () => {
  it('prefers WebM/Opus, then WebM, then MP4 (Safari)', () => {
    expect(recordingMimeType(() => true)).toBe('audio/webm;codecs=opus')
    expect(recordingMimeType((t) => t === 'audio/mp4')).toBe('audio/mp4')
    expect(recordingMimeType(() => false)).toBeUndefined()
  })
})

describe('DICTATION_MENU_ORDER', () => {
  it('lists Auto, then the free engines, then the paid ones, then Off', () => {
    const engines = DICTATION_MENU_ORDER.slice(1, -1) as (keyof typeof DICTATION_PRICE)[]
    expect(DICTATION_MENU_ORDER[0]).toBe('auto')
    expect(DICTATION_MENU_ORDER.at(-1)).toBe('off')
    expect(engines.map((e) => DICTATION_PRICE[e])).toEqual(['free', 'free', 'paid', 'paid'])
    expect(new Set(engines)).toEqual(new Set(Object.keys(DICTATION_PRICE)))
  })
})
