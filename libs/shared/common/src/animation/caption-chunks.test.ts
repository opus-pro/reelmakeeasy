import {
  captionChunks,
  chunkAt,
  chunkSizes,
} from '../../../../../presets/animation/template/src/caption-chunks'
import { chunkCaptionWords } from '../long-take/beat-loop-captions'

/** Words of a sentence, 0.3 s each, back to back from `from`. */
const timed = (text: string, from = 0) =>
  text.split(' ').map((w, i) => ({ end: from + i * 0.3 + 0.25, start: from + i * 0.3, text: w }))

describe("an animation's captions", () => {
  it.each([
    'Tonight, the Moon moves about 3.8 centimeters farther from Earth each year.',
    'Good evening, I am Allen, and this is the Knowledge Desk.',
    'So why is it leaving? The answer is the tides.',
    'It lasted c. 22 hours, 400 million years ago.',
  ])('groups words exactly as the app captions do: %s', (line) => {
    const words = line.split(' ')
    expect(chunkSizes(words)).toEqual(chunkCaptionWords(words).map((c) => c.length))
  })

  it('pages a phrase at a time: what is on screen only changes to a whole new phrase', () => {
    const words = timed('The Moon moves about 3.8 centimeters farther from Earth each year.')
    const chunks = captionChunks(words)
    const shown = new Set<string>()
    for (let t = 0; t < 3.6; t += 1 / 30) {
      const chunk = chunkAt(chunks, t)
      if (chunk) shown.add(chunk.words.map((w) => w.text).join(' '))
    }
    // 11 words: 3 + 3 + 3 + 2, each its own page; no page shares a tail with the next.
    expect([...shown]).toEqual([
      'The Moon moves',
      'about 3.8 centimeters',
      'farther from Earth',
      'each year.',
    ])
    // Every word is on screen while it is said.
    for (const w of words) expect(chunkAt(chunks, w.start + 0.01)?.words).toContainEqual(w)
  })

  it('breaks after punctuation and clears the screen through a long pause', () => {
    const words = [...timed('Good evening,'), ...timed('I am Allen.', 2.5)]
    const chunks = captionChunks(words)
    expect(chunks.map((c) => c.words.map((w) => w.text).join(' '))).toEqual([
      'Good evening,',
      'I am Allen.',
    ])
    expect(chunkAt(chunks, 1.5)).toBeNull()
  })
})
