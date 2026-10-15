import { toEnginePlanJson } from './engine-plan-json'

describe('toEnginePlanJson', () => {
  it('hands caption presets to the engine in its own scheme, and nothing else changes', () => {
    const plan = {
      tracks: [
        {
          segs: [
            { type: 'text', uri: 'caption-preset://word-level_highlight_color' },
            { type: 'text', uri: 'caption-preset://deep-diver' },
            { type: 'video', uri: 'http://localhost:5017/api/files/projects/p1/final_video.mp4' },
          ],
        },
      ],
    }
    const json = toEnginePlanJson(plan)
    expect(JSON.parse(json).tracks[0].segs.map((s: { uri: string }) => s.uri)).toEqual([
      'opus://preset/word-level_highlight_color',
      'opus://preset/deep-diver',
      'http://localhost:5017/api/files/projects/p1/final_video.mp4',
    ])
    expect(json).not.toContain('caption-preset://')
  })

  it('leaves a plan without caption presets as plain JSON', () => {
    const plan = { tracks: [{ segs: [{ text: 'a caption-preset:// mention in words' }] }] }
    expect(toEnginePlanJson(plan)).toBe(JSON.stringify(plan))
  })
})
