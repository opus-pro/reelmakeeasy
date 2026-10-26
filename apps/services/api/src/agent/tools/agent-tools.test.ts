import { AGENT_TOOLS, toolsForSession, toolSummary } from './agent-tools'

describe('agent tools', () => {
  it('declares the tools with object schemas', () => {
    for (const name of [
      'make_beat_loop',
      'make_video',
      'regenerate_clip',
      'render_video',
      'set_music',
      'use_image_as_keyframe',
    ] as const) {
      const spec = AGENT_TOOLS[name]
      expect(spec.name).toBe(name)
      expect(spec.description.length).toBeGreaterThan(20)
      expect(spec.inputSchema).toMatchObject({ additionalProperties: false, type: 'object' })
    }
    expect(AGENT_TOOLS.regenerate_clip.inputSchema).toMatchObject({
      required: ['transitionId'],
    })
    expect(AGENT_TOOLS.make_video.inputSchema).toMatchObject({
      properties: { music: { type: 'string' } },
      required: ['title', 'script'],
    })
  })

  it('gives Easy sessions the edit tools only while editing, and Free chat all of them', () => {
    expect(toolsForSession({ mode: 'autonomous' })).toEqual([])
    expect(toolsForSession({ editing: true, mode: 'autonomous' }).map((t) => t.name)).toEqual([
      'regenerate_clip',
      'render_video',
      'set_music',
      'use_image_as_keyframe',
    ])
    expect(toolsForSession({ mode: 'free' }).map((t) => t.name)).toEqual([
      'make_video',
      'make_beat_loop',
      'regenerate_clip',
      'render_video',
      'set_music',
      'use_image_as_keyframe',
      'ranking_list',
      'ranking_create',
      'ranking_get',
      'ranking_update',
      'ranking_add_clip',
      'ranking_add_sound',
      'ranking_add_sticker_image',
      'ranking_export',
      'ranking_analyze_reference',
      'ranking_find_moments',
      'ranking_generate_clips',
      'ranking_style_list',
      'ranking_style_get',
      'ranking_style_save',
      'ranking_apply_style',
    ])
    expect(AGENT_TOOLS.set_music.inputSchema).toMatchObject({ required: ['enabled'] })
    expect(AGENT_TOOLS.set_music.inputSchema).toMatchObject({
      properties: { track: { type: 'string' } },
    })
    expect(AGENT_TOOLS.set_music.inputSchema).toMatchObject({
      properties: { volume: { maximum: 100, minimum: 0, type: 'integer' } },
    })
    expect(AGENT_TOOLS.set_music.inputSchema).toMatchObject({
      properties: { volume_change: { maximum: 100, minimum: -100, type: 'integer' } },
    })
    expect(toolsForSession({})).toEqual([])
  })

  it('summarises a call for the chat pill', () => {
    expect(toolSummary('regenerate_clip', { prompt: 'x', transitionId: 'transition_3' })).toBe(
      'Redoing clip transition_3',
    )
    expect(toolSummary('render_video', {})).toBe('Rebuilding the video')
    expect(toolSummary('set_music', { enabled: true })).toBe('Changing the music')
    expect(toolSummary('make_video', { title: 'Moon caves' })).toBe(
      'Starting the video: Moon caves',
    )
    expect(toolSummary('use_image_as_keyframe', { image: '/x.png', keyframe: '2' })).toBe(
      'Putting the new picture in as keyframe 2',
    )
    expect(toolSummary('other', null)).toBe('other')
  })
})

describe('use_image_as_keyframe', () => {
  it('takes the picture and the keyframe, flat', () => {
    expect(AGENT_TOOLS.use_image_as_keyframe.inputSchema).toMatchObject({
      additionalProperties: false,
      properties: { image: { type: 'string' }, keyframe: { type: 'string' } },
      required: ['image', 'keyframe'],
      type: 'object',
    })
  })

  it("says what it makes again, that the card's real button starts it, and nothing before", () => {
    const { description } = AGENT_TOOLS.use_image_as_keyframe
    expect(description).toMatch(/clip before and the clip after/)
    expect(description).toMatch(/loop short/)
    expect(description).toContain('"Make it"')
    expect(description).toMatch(/nothing is changed or spent until/i)
    expect(description).not.toMatch(/confirm/i)
  })

  it("lets generate_image fix one of the video's pictures once it exists", () => {
    expect(AGENT_TOOLS.generate_image.description).toMatch(/keyframe/)
    expect(AGENT_TOOLS.generate_image.description).toContain('use_image_as_keyframe')
  })
})

describe('a Ranking chat', () => {
  it('gets the ranking tools only, on either agent', () => {
    for (const harness of ['codex', 'claude'] as const) {
      for (const mode of ['ranking', 'ranking_easy'] as const) {
        const names = toolsForSession({ mode }, harness).map((t) => t.name)
        expect(names.every((n) => n.startsWith('ranking_'))).toBe(true)
        expect(names).toContain('ranking_analyze_reference')
        expect(names).toContain('ranking_add_sound')
        expect(names).toContain('ranking_style_save')
        expect(names).toHaveLength(15)
      }
    }
  })
})

describe('a Motion Reel chat', () => {
  it('gets its music and render tools; an Advanced one sets itself up with motion_setup', () => {
    for (const harness of ['codex', 'claude'] as const) {
      expect(toolsForSession({ mode: 'motion' }, harness).map((t) => t.name)).toEqual([
        'motion_music',
        'motion_still',
        'motion_render',
        'motion_review',
      ])
      expect(toolsForSession({ mode: 'motion_free' }, harness).map((t) => t.name)).toEqual([
        'motion_setup',
        'motion_music',
        'motion_still',
        'motion_render',
        'motion_review',
      ])
    }
    expect(toolSummary('motion_review', {})).toBe('Reviewing the render (contact sheets)')
    expect(toolSummary('motion_setup', {})).toBe('Looking at the reel types and music')
    expect(toolSummary('motion_setup', { type: 'launch' })).toBe('Setting up the reel')
  })
})

describe('toolsForSession by harness', () => {
  const names = (s: Parameters<typeof toolsForSession>[0], h?: 'claude' | 'codex') =>
    toolsForSession(s, h).map((t) => t.name)

  it('gives Claude chats generate_image in Free chat, never Easy before editing', () => {
    expect(names({ mode: 'free' }, 'claude')).toContain('generate_image')
    expect(names({ mode: 'free' }, 'codex')).not.toContain('generate_image')
    expect(names({ mode: 'free' })).not.toContain('generate_image')
    expect(names({ mode: 'autonomous' }, 'claude')).toEqual([])
  })

  it('keeps the Codex tool lists as they were, with the keyframe tool beside the edit tools', () => {
    expect(names({ mode: 'free' }, 'codex')).toEqual([
      'make_video',
      'make_beat_loop',
      'regenerate_clip',
      'render_video',
      'set_music',
      'use_image_as_keyframe',
      'ranking_list',
      'ranking_create',
      'ranking_get',
      'ranking_update',
      'ranking_add_clip',
      'ranking_add_sound',
      'ranking_add_sticker_image',
      'ranking_export',
      'ranking_analyze_reference',
      'ranking_find_moments',
      'ranking_generate_clips',
      'ranking_style_list',
      'ranking_style_get',
      'ranking_style_save',
      'ranking_apply_style',
    ])
    expect(names({ editing: true, mode: 'autonomous' })).toEqual([
      'regenerate_clip',
      'render_video',
      'set_music',
      'use_image_as_keyframe',
    ])
  })

  it('gives Claude its image tool while editing too, so it can fix a keyframe (Codex has its own)', () => {
    expect(names({ editing: true, mode: 'free' }, 'claude')).toContain('generate_image')
    expect(names({ editing: true, mode: 'autonomous' }, 'claude')).toEqual([
      'regenerate_clip',
      'render_video',
      'set_music',
      'use_image_as_keyframe',
      'generate_image',
    ])
    expect(names({ editing: true, mode: 'autonomous' }, 'codex')).not.toContain('generate_image')
  })

  it('summarizes generate_image for the pill', () => {
    expect(toolSummary('generate_image', { prompt: 'a red fox at dawn' })).toBe(
      'Making a preview image',
    )
  })
})

describe('generate_image wording', () => {
  it('names no vendor model, since the picture follows the generation provider', () => {
    expect(AGENT_TOOLS.generate_image.description).not.toMatch(/Nano Banana|\$0\.05/)
    expect(AGENT_TOOLS.generate_image.description).toContain('a few cents')
  })
})

describe('loop shorts', () => {
  it('declares make_beat_loop with flat parameters: the storyboard is one JSON string', () => {
    const spec = AGENT_TOOLS.make_beat_loop
    expect(spec.name).toBe('make_beat_loop')
    expect(spec.inputSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        storyboard: { type: 'string' },
        title: { type: 'string' },
        voice: { type: 'string' },
      },
      required: ['title', 'storyboard'],
      type: 'object',
    })
    expect(spec.description).toMatch(/storyboard/)
    // Every line is said in the voice and checked against its clip before any card.
    expect(spec.description).toMatch(/says every narration line in the voice/)
    expect(spec.description).toMatch(/too long for its clip/)
    const voice = (spec.inputSchema['properties'] as Record<string, { description: string }>)[
      'voice'
    ]
    expect(voice?.description).toMatch(/free voice on this computer/)
    // The card's real button: an agent told the user "confirms" sent them to a "Confirm" one.
    expect(spec.description).toContain('"Make it"')
    expect(spec.description).not.toMatch(/confirm/i)
  })

  it('keeps every tool parameter flat, as the Claude tool bridge needs', () => {
    for (const spec of Object.values(AGENT_TOOLS)) {
      const props = (spec.inputSchema['properties'] ?? {}) as Record<string, { type?: string }>
      for (const [name, prop] of Object.entries(props))
        expect([`${spec.name}.${name}`, prop.type]).toEqual([
          `${spec.name}.${name}`,
          expect.stringMatching(/^(boolean|integer|number|string)$/),
        ])
    }
  })

  it('regenerate_clip takes a loop clip: redoFollowing and new slots, no prompt needed', () => {
    expect(AGENT_TOOLS.regenerate_clip.inputSchema).toMatchObject({
      properties: {
        changes: { type: 'string' },
        prompt: { type: 'string' },
        redoFollowing: { type: 'boolean' },
        transitionId: { type: 'string' },
      },
      required: ['transitionId'],
    })
    expect(AGENT_TOOLS.regenerate_clip.description).toMatch(/loop/i)
  })

  it('offers make_beat_loop in Free chat only, never in Easy', () => {
    expect(toolsForSession({ mode: 'free' }, 'claude').map((t) => t.name)).toContain(
      'make_beat_loop',
    )
    expect(toolsForSession({ editing: true, mode: 'free' }).map((t) => t.name)).toContain(
      'make_beat_loop',
    )
    expect(toolsForSession({ editing: true, mode: 'autonomous' }).map((t) => t.name)).not.toContain(
      'make_beat_loop',
    )
  })

  it('summarises a loop start and a loop clip redo for the pill', () => {
    expect(toolSummary('make_beat_loop', { storyboard: '{}', title: 'Pyramid time' })).toBe(
      'Starting the loop: Pyramid time',
    )
    expect(toolSummary('make_beat_loop', { storyboard: '{}' })).toBe('Starting the loop')
    expect(toolSummary('regenerate_clip', { redoFollowing: true, transitionId: 's3' })).toBe(
      'Redoing clip s3 and the clips after it',
    )
    expect(toolSummary('regenerate_clip', { redoFollowing: false, transitionId: 's3' })).toBe(
      'Redoing clip s3',
    )
  })
})

describe('a Claude Animation chat', () => {
  it('records voices from the lines and each speaker\'s voice', () => {
    const schema = AGENT_TOOLS.animation_voice.inputSchema as { required: string[] }
    expect(schema.required).toEqual(['lines', 'voices'])
    expect(toolSummary('animation_voice', { lines: [] })).toBe('Recording the voices')
  })
})

describe('the tools of a Claude Animation chat', () => {
  it('gives an Easy chat its four tools and Advanced the setup too', () => {
    expect(toolsForSession({ mode: 'animation' }, 'claude').map((t) => t.name)).toEqual([
      'animation_voice',
      'animation_music',
      'animation_still',
      'animation_render',
    ])
    expect(toolsForSession({ mode: 'animation_free' }, 'claude').map((t) => t.name)).toEqual([
      'animation_setup',
      'animation_voice',
      'animation_music',
      'animation_still',
      'animation_render',
    ])
  })

  it('says what each call is doing', () => {
    expect(toolSummary('animation_music', {})).toBe('Making the music')
    expect(toolSummary('animation_still', {})).toBe('Looking at frames of the animation')
    expect(toolSummary('animation_render', {})).toBe('Rendering the animation')
    expect(toolSummary('animation_setup', {})).toBe('Looking at the looks and music')
    expect(toolSummary('animation_setup', { lookId: '2d' })).toBe('Setting up the animation')
  })
})
