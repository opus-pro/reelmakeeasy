import { composerPrompt, parseComposeRequest } from './motion-music'

describe('parseComposeRequest', () => {
  it('takes a prompt and an optional whole-number tempo', () => {
    expect(parseComposeRequest({ prompt: '  launch anthem ' })).toEqual({ prompt: 'launch anthem' })
    expect(parseComposeRequest({ bpm: 128, prompt: 'x' })).toEqual({ bpm: 128, prompt: 'x' })
  })

  it('says what to fix', () => {
    expect(parseComposeRequest({})).toMatch(/Describe the music/)
    expect(parseComposeRequest({ prompt: 'x'.repeat(801) })).toMatch(/under 800/)
    expect(parseComposeRequest({ bpm: 300, prompt: 'x' })).toMatch(/60 to 180/)
    expect(parseComposeRequest({ bpm: 120.5, prompt: 'x' })).toMatch(/whole number/)
  })
})

describe('composerPrompt', () => {
  it('states the tempo and keeps it instrumental, once', () => {
    expect(composerPrompt({ bpm: 128, prompt: 'Punchy launch anthem.' })).toBe(
      'Punchy launch anthem. 128 BPM, steady tempo. Instrumental, no vocals.',
    )
    expect(composerPrompt({ bpm: 128, prompt: 'Anthem at 128 BPM. Instrumental.' })).toBe(
      'Anthem at 128 BPM. Instrumental.',
    )
  })
})
