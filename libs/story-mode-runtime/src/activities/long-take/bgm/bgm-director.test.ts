import {
  BGM_DIRECTOR_SYSTEM_PROMPT,
  BgmDirectorResponseSchema,
  buildBgmDirectorPrompt,
} from './bgm-director'

describe('BGM director prompt', () => {
  it('lists a user request first, only when present', () => {
    const withWish = buildBgmDirectorPrompt({ tone: 'warm', userRequest: 'lo-fi hip hop' })
    expect(withWish.split('\n')[1]).toBe('user_request: lo-fi hip hop')
    expect(buildBgmDirectorPrompt({ tone: 'warm' })).not.toContain('user_request')
  })

  it('tells the director a user request outranks the genre table', () => {
    expect(BGM_DIRECTOR_SYSTEM_PROMPT).toContain('## User request')
    expect(BGM_DIRECTOR_SYSTEM_PROMPT).toContain('outranks the house sound')
  })
})

describe('director tags', () => {
  it('asks for comma-separated style tags for tag-based music models', () => {
    const shape = BgmDirectorResponseSchema.shape
    expect(shape.tags).toBeDefined()
    expect(shape.tags.description).toMatch(/comma-separated/i)
  })

  it('gives the director the camera style, right after a user request', () => {
    const lines = buildBgmDirectorPrompt({
      cameraStyle: 'dynamic',
      tone: 'warm',
      userRequest: 'piano',
    }).split('\n')
    expect(lines.slice(1, 3)).toEqual(['user_request: piano', 'camera_style: dynamic'])
  })

  it('asks for easy lo-fi or piano music, gentle even when dynamic, and real music not filler', () => {
    expect(BGM_DIRECTOR_SYSTEM_PROMPT).toMatch(/lo-fi hip hop, lo-fi piano/)
    expect(BGM_DIRECTOR_SYSTEM_PROMPT).toMatch(/dynamic → 84-96 BPM/)
    expect(BGM_DIRECTOR_SYSTEM_PROMPT).toMatch(/Ignore the visual style/)
    // v3's filler-bed rules are gone.
    expect(BGM_DIRECTOR_SYSTEM_PROMPT).not.toMatch(/mid-scooped|build-and-drop/)
  })
})
