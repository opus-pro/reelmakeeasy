import {
  capabilitiesFor,
  type ModelRegistryFile,
  resetGenerationProviderForTesting,
  resetModelRegistryForTesting,
  setGenerationProvider,
} from '@reelmakeeasy/llm/registry'

import {
  BEAT_LINE_SECONDS,
  type BeatClipSlots,
  beatLoopCost,
  beatLoopCostUsd,
  beatLoopDialect,
  beatLoopModelOrder,
  beatLoopStyle,
  buildBeatClipPrompt,
  buildBeatKeyframePrompt,
  estimateNarrationSeconds,
  EXPLAINER_COLLAGE_STYLE,
  fitBeatLoopLine,
  lineTooLongIssue,
  narrationTarget,
  validateBeatLoopStoryboard,
} from './beat-loop-craft'

/** A storyboard as a writer might send it: any field can be missing or wrong. */
interface Fixture {
  accent?: string
  caption_style?: string
  clips: {
    caption?: null | string
    cut?: string
    cut_camera?: string
    freeze?: string
    hit?: string
    hit_camera?: string
    id?: string
    narration?: string
    stamp?: null | string
  }[]
  duration_s?: number
  keyframes: { id: string; prompt?: string; same_as?: string }[]
  sources?: string
  style?: string
  title?: string
}

/** A storyboard tested on Google (24 s, six clips), keyframe prompts shortened. */
function sharksStoryboard(): Fixture {
  return {
    accent: '#FFE500',
    caption_style: 'explainer',
    clips: [
      {
        caption: null,
        cut: 'The camera tilts down fast past the shark to the fossil stone slab at the bottom until the fossil fills the whole frame.',
        cut_camera: 'Tilt down',
        freeze: 'The cutouts freeze, their paper edges lifted slightly off the page.',
        hit: 'From the same top-down angle, the shark cutout slams onto the page as the tree, dinosaur and fossil cutouts snap in from the corners and a yellow highlighter stroke swipes fast behind the shark.',
        hit_camera: 'Push in',
        id: 's1',
        narration: 'Sharks have been swimming longer than trees have been standing.',
        stamp: null,
      },
      {
        caption: 'The first sharks swam 450 million years ago.',
        cut: 'The camera whip-pans fast to the right along the paper to a lone ancient tree cutout standing on a strip of torn paper.',
        cut_camera: 'Pan right',
        freeze: 'The cracks and the red circle freeze on the stone.',
        hit: 'In the same close-up, cracks race across the stone slab and the red marker circle scribbles itself around the fossil shark in fast loops.',
        hit_camera: 'Zoom in',
        id: 's2',
        narration: 'The first sharks swam four hundred fifty million years ago.',
        stamp: '450M years ago',
      },
      {
        caption: 'The first true trees grew ~65 million years later.',
        cut: 'The camera tilts up fast past the treetop into the paper sky, where a huge asteroid cutout hangs above the horizon of the Earth.',
        cut_camera: 'Tilt up',
        freeze: 'The fronds and the arrow freeze mid-spring, their paper edges curled.',
        hit: 'From the same front angle, the tree cutout springs up from the paper strip, its fronds bursting open fast, and the red arrow slashes toward its trunk.',
        hit_camera: 'Push in',
        id: 's3',
        narration: 'The first true trees grew some sixty-five million years later.',
        stamp: '385M years ago',
      },
      {
        caption: "Sharks have survived all 5 of Earth's mass extinctions.",
        cut: 'The camera whip-pans fast to the left along the paper to a dinosaur skeleton cutout walking on a torn paper strip.',
        cut_camera: 'Pan left',
        freeze: 'The paper debris freezes in the air around the impact, the shark held mid-dart.',
        hit: 'From the same angle, the asteroid cutout slams into the horizon and torn paper debris bursts toward the camera while the small shark cutout darts through the ocean.',
        hit_camera: 'Shake',
        id: 's4',
        narration: "Sharks have survived all five of Earth's mass extinctions.",
        stamp: '5 of 5 survived',
      },
      {
        caption: 'They were already ancient when the first dinosaurs appeared.',
        cut: 'The camera zooms fast past the dinosaur into the row of tree cutouts behind it until the trees fill the whole frame.',
        cut_camera: 'Zoom in',
        freeze: 'The skeleton freezes mid-step, one foot lifted off the paper.',
        hit: 'From the same side angle, the dinosaur skeleton cutout stomps forward fast, its bones rattling, and the red marker circle scribbles around its skull.',
        hit_camera: 'Push in',
        id: 's5',
        narration: 'They were already ancient when the first dinosaurs appeared.',
        stamp: '230M years ago',
      },
      {
        caption: null,
        cut: 'The camera pulls back fast until the forest shrinks to the small tree cutout in the corner beside the big shark.',
        cut_camera: 'Pull out',
        freeze: 'The flying paper leaves freeze in mid-air around the fin.',
        hit: 'From the same front angle, the shark fin cutout bursts up through the paper strip and the tree cutouts shake hard, paper leaves flying.',
        hit_camera: 'Shake',
        id: 's6',
        narration: 'Every forest on Earth is younger than the shark.',
        stamp: null,
      },
    ],
    duration_s: 24,
    keyframes: [
      { id: 'f0', prompt: 'Hook: a large halftone cutout of a great white shark.' },
      { id: 'f1', prompt: 'NEW SHOT: an extreme close-up of a grey stone slab cutout.' },
      { id: 'f2', prompt: 'NEW SHOT: a tall halftone cutout of an ancient fern-like tree.' },
      { id: 'f3', prompt: 'NEW SHOT: a large halftone asteroid cutout above the Earth.' },
      { id: 'f4', prompt: 'NEW SHOT: an early dinosaur skeleton walking across the frame.' },
      { id: 'f5', prompt: 'NEW SHOT: a dense forest of tall halftone tree cutouts.' },
      { id: 'f6', same_as: 'f0' },
    ],
    sources: 'Earliest shark scales c. 450 Ma; earliest trees c. 385 Ma; five mass extinctions.',
    style: EXPLAINER_COLLAGE_STYLE,
    title: 'Sharks are older than trees',
  }
}

describe('validateBeatLoopStoryboard', () => {
  it('accepts the tested storyboard with no issues or warnings', () => {
    const result = validateBeatLoopStoryboard(sharksStoryboard())
    expect(result.issues).toEqual([])
    expect(result.warnings).toEqual([])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.storyboard.clips).toHaveLength(6)
    expect(result.storyboard.keyframes.at(-1)).toEqual({ id: 'f6', same_as: 'f0' })
  })

  it.each([
    [28, 7],
    [32, 8],
  ])('accepts a %i s loop of %i clips, its last keyframe a copy of the first', (seconds, n) => {
    const sb = sharksStoryboard()
    const extra = Array.from({ length: n - 6 }, (_, i) => ({
      ...sb.clips[1],
      id: `s${7 + i}`,
      narration: `Sharks have outlived every one of those ${['big', 'huge'][i]} changes.`,
    }))
    sb.clips = [...sb.clips, ...extra]
    sb.duration_s = seconds
    sb.keyframes = [
      ...sb.keyframes.slice(0, 6),
      ...extra.map((_, i) => ({ id: `f${6 + i}`, prompt: `NEW SHOT: scene ${7 + i}.` })),
      { id: `f${n}`, same_as: 'f0' },
    ]
    const result = validateBeatLoopStoryboard(sb)
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.storyboard.duration_s).toBe(seconds)
    expect(result.storyboard.clips).toHaveLength(n)
    expect(result.storyboard.keyframes.at(-1)).toEqual({ id: `f${n}`, same_as: 'f0' })
    // One clip short of the length is refused.
    const short = { ...sb, clips: sb.clips.slice(0, -1), keyframes: sb.keyframes.slice(0, -1) }
    expect(validateBeatLoopStoryboard(short).ok).toBe(false)
  })

  it('reads the storyboard from a JSON string (the tool passes text)', () => {
    const result = validateBeatLoopStoryboard(JSON.stringify(sharksStoryboard()))
    expect(result.ok).toBe(true)
  })

  it('says so when the text is not JSON', () => {
    const result = validateBeatLoopStoryboard('{"title": "Sharks",')
    expect(result.ok).toBe(false)
    expect(result.issues).toHaveLength(1)
    expect(result.issues[0]).toMatch(/^storyboard: not valid JSON/)
  })

  it('accepts N keyframes without the closing copy of f0', () => {
    const sb = sharksStoryboard()
    sb.keyframes.pop()
    expect(validateBeatLoopStoryboard(sb).ok).toBe(true)
  })

  it('reports every problem together', () => {
    const sb = sharksStoryboard()
    sb.clips[0].hit_camera = 'Dolly in'
    sb.clips[1].freeze = 'The cracks freeze as the camera zooms in on the slab.'
    sb.clips[2].cut = 'The tree becomes an asteroid.'
    sb.clips[3].narration = "Sharks have survived all 5 of Earth's mass extinctions."
    sb.clips[4].narration =
      'They were already very very ancient long before the first of all the dinosaurs appeared.'
    sb.clips[5].stamp = 'Older than every forest'
    sb.clips[5].cut_camera = 'Spin'
    const result = validateBeatLoopStoryboard(sb)
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      'clips[0].hit_camera: must be one of Push in, Shake, Zoom in (got "Dolly in")',
      expect.stringMatching(/^clips\[1\]\.freeze: no camera words in the freeze \("camera"/),
      expect.stringMatching(/^clips\[2\]\.cut: .*not "becomes"/),
      expect.stringMatching(/^clips\[3\]\.narration: write numbers as spoken words.*"5"/),
      expect.stringMatching(/^clips\[4\]\.narration: 15 words; use 6-12/),
      expect.stringMatching(/^clips\[5\]\.cut_camera: must be one of Push in, Zoom in, Pull out/),
      'clips[5].stamp: 23 characters; keep it to 16',
    ])
  })

  it('reports count problems alongside missing fields', () => {
    const sb = sharksStoryboard()
    sb.clips.pop()
    delete sb.clips[0].hit
    sb.keyframes.splice(1, 3)
    delete sb.title
    const result = validateBeatLoopStoryboard(sb)
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'title: is missing',
        'clips[0].hit: is missing',
        'clips: duration_s 24 needs 6 clips (4 s each); got 5',
        'keyframes: 6 clips need 6 keyframes, or 7 ending with {"id": "f6", "same_as": "f0"}; got 4',
      ]),
    )
    expect(result.issues).toHaveLength(4)
  })

  it("words a wrong-typed field in the schema's own words, not zod's", () => {
    const sb = sharksStoryboard() as unknown as {
      clips: unknown[]
      title: unknown
    }
    sb.clips[0] = { ...(sb.clips[0] as object), caption: 5, hit_camera: 5 }
    sb.clips[1] = { ...(sb.clips[1] as object), narration: 7 }
    sb.clips[2] = 'a'
    sb.title = ['Sharks']
    const result = validateBeatLoopStoryboard(sb)
    expect(result.issues).toEqual(
      expect.arrayContaining([
        'title: must be text',
        'clips[0].hit_camera: must be one of Push in, Shake, Zoom in (got 5)',
        'clips[0].caption: must be text or null',
        'clips[1].narration: must be text',
        'clips[2]: must be an object with id, hit_camera, hit, freeze, cut_camera, cut, narration, caption and stamp',
      ]),
    )
    expect(validateBeatLoopStoryboard({ ...sb, clips: 'x', keyframes: 'x' }).issues).toEqual(
      expect.arrayContaining(['clips: must be a list', 'keyframes: must be a list']),
    )
    expect(validateBeatLoopStoryboard('[]').issues).toEqual(['storyboard: must be a JSON object'])
    expect(validateBeatLoopStoryboard('null').issues).toEqual(['storyboard: must be a JSON object'])
  })

  it("takes the caption style and accent as optional: the app picks the captions' look", () => {
    /** The checked storyboard, or the issues as an error. */
    const checked = (input: unknown) => {
      const result = validateBeatLoopStoryboard(input)
      if (!result.ok) throw new Error(result.issues.join('\n'))
      return result.storyboard
    }
    const sb = sharksStoryboard()
    delete sb.accent
    delete sb.caption_style
    expect(checked(sb)).not.toHaveProperty('accent')

    // A caption style the writer still sends is accepted, whatever it says, and dropped.
    for (const caption_style of ['punch', 'Explainer', 'neon', 5]) {
      expect(checked({ ...sb, caption_style })).not.toHaveProperty('caption_style')
    }

    // The accent is kept as the writer's suggestion, as a colour.
    expect(checked({ ...sb, accent: ' #ffe500 ' }).accent).toBe('#FFE500')
  })

  it('checks the length, the accent colour and the closing keyframe', () => {
    const sb = sharksStoryboard()
    sb.duration_s = 30
    sb.accent = 'yellow'
    sb.keyframes[6] = { id: 'f6', same_as: 'f2' }
    sb.keyframes[2] = { id: 'f2', prompt: 'A tree.', same_as: 'f0' }
    const result = validateBeatLoopStoryboard(sb)
    expect(result.issues).toEqual([
      'duration_s: must be 16, 20, 24, 28 or 32 (got 30)',
      'accent: must be a colour like #FFE500 (got "yellow")',
      'keyframes[2]: set prompt or same_as, not both',
      'keyframes[6].same_as: must name the first keyframe ("f0") to close the loop',
    ])
  })

  it('refuses same_as before the last keyframe and repeated ids', () => {
    const sb = sharksStoryboard()
    sb.keyframes[3] = { id: 'f3', same_as: 'f0' }
    sb.clips[4].id = 's4'
    const result = validateBeatLoopStoryboard(sb)
    expect(result.issues).toEqual([
      'clips[4].id: "s4" is used twice',
      'keyframes[3]: only the last keyframe may use same_as; give this one a prompt',
    ])
  })

  it('tidies camera commands, empty captions and stamps', () => {
    const sb = sharksStoryboard()
    sb.clips[0].hit_camera = '[push in]'
    sb.clips[0].cut_camera = 'tilt-down'
    sb.clips[1].caption = '  '
    delete sb.clips[2].stamp
    sb.accent = '#fe0'
    const result = validateBeatLoopStoryboard(sb)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.storyboard.clips[0]).toMatchObject({
      cut_camera: 'Tilt down',
      hit_camera: 'Push in',
    })
    expect(result.storyboard.clips[1].caption).toBeNull()
    expect(result.storyboard.clips[2].stamp).toBeNull()
    expect(result.storyboard.accent).toBe('#FFEE00')
  })

  it('warns, without failing, when a line is outside 8-10 words', () => {
    const sb = sharksStoryboard()
    sb.clips[0].narration = 'Cleopatra lived closer to the Moon landing than to the pyramids.'
    sb.clips[1].narration = 'Sharks are older than trees.'
    sb.clips[1].caption = null
    const result = validateBeatLoopStoryboard(sb)
    expect(result.ok).toBe(false)
    expect(result.issues).toEqual([
      expect.stringMatching(/^clips\[1\]\.narration: 5 words; use 6-12/),
    ])
    sb.clips[1].narration = 'Sharks are much older than all trees.'
    const ok = validateBeatLoopStoryboard(sb)
    expect(ok.ok).toBe(true)
    expect(ok.warnings).toEqual([
      expect.stringMatching(/^clips\[0\]\.narration: 11 words; 8-10 fit/),
      expect.stringMatching(/^clips\[1\]\.narration: 7 words; 8-10 fit/),
    ])
  })

  it('warns early, without failing, when a line will likely take too long to say', () => {
    const sb = sharksStoryboard()
    sb.clips[2].narration =
      'Unbelievably, archaeologists discovered: "perfectly preserved, edible Egyptian honey" — astonishingly.'
    sb.clips[2].caption = null
    const result = validateBeatLoopStoryboard(sb)
    expect(result.ok).toBe(true)
    expect(result.warnings).toEqual([
      expect.stringMatching(
        /^clips\[2\]\.narration: about \d+\.\d s to say, likely too long even at 1\.3x speed \(a line has 3\.45 s\); aim for about 6 short words, no quotes, colons or dashes$/,
      ),
    ])
  })
})

describe('fitBeatLoopLine', () => {
  it('leaves a line that fits the 3.45 s between 0.15 s and 3.6 s alone', () => {
    expect(BEAT_LINE_SECONDS).toBeCloseTo(3.45, 9)
    expect(fitBeatLoopLine(3.45)).toEqual({ fits: true, tempo: 1 })
  })

  it('speeds a long line up to 1.3x at most', () => {
    expect(fitBeatLoopLine(3.9)).toEqual({ fits: true, tempo: 3.9 / 3.45 })
    expect(fitBeatLoopLine(3.45 * 1.3)).toMatchObject({ fits: true })
    expect(fitBeatLoopLine(3.45 * 1.31)).toMatchObject({ fits: false })
  })
})

describe('estimateNarrationSeconds', () => {
  it('reads a line at about 4.6 syllables a second (Kokoro Heart said this one in 2.34 s)', () => {
    const estimate = estimateNarrationSeconds('There are more stars than grains of sand on Earth.')
    expect(estimate.syllables).toBe(10)
    expect(estimate.pauseSeconds).toBe(0)
    expect(estimate.seconds).toBeCloseTo(10 / 4.6, 5)
  })

  it('adds the pauses voices make at quotes, colons, dashes and commas', () => {
    const plain = estimateNarrationSeconds('He said stop then he left the room.')
    const paused = estimateNarrationSeconds('He said: "stop" — then, he left the room.')
    expect(paused.syllables).toBe(plain.syllables)
    // A colon and a dash 0.3 s each, two quote marks 0.25 s each, a comma 0.15 s.
    expect(paused.pauseSeconds).toBeCloseTo(0.3 + 0.3 + 0.5 + 0.15, 5)
    expect(paused.seconds - plain.seconds).toBeCloseTo(1.25, 5)
  })

  it("counts single quotes as quotes, never an apostrophe (the live run's lines)", () => {
    // Said in 4.5 s, 5.4 s and 4.6 s by the default voice: the quotes are what made the first
    // two long, and the estimate read them as no pause at all.
    const quoted = "'Per se' means 'by itself': the symbol itself meant 'and.'"
    const recited = "Said quickly, 'and per se and' became the word 'ampersand.'"
    const plain = "The ampersand once joined schoolchildren's alphabet as letter twenty-seven."
    // Six quote marks and a colon; four quote marks and a comma; an apostrophe is no pause.
    expect(estimateNarrationSeconds(quoted).pauseSeconds).toBeCloseTo(6 * 0.25 + 0.3, 5)
    expect(estimateNarrationSeconds(recited).pauseSeconds).toBeCloseTo(4 * 0.25 + 0.15, 5)
    expect(estimateNarrationSeconds(plain).pauseSeconds).toBe(0)
    expect(estimateNarrationSeconds("The dogs' bowls aren’t 'full'.").pauseSeconds).toBeCloseTo(
      2 * 0.25,
      5,
    )
    expect(estimateNarrationSeconds('He said ‘stop’ twice.').pauseSeconds).toBeCloseTo(0.5, 5)
    // The quoted line now warns before any voice says it, and the rewrite drops the quotes.
    expect(fitBeatLoopLine(estimateNarrationSeconds(quoted).seconds).fits).toBe(false)
    expect(narrationTarget(quoted, 4.5)).toBe('about 8 short words, no quotes or colons')
    expect(narrationTarget(recited, 5.4)).toBe('about 7 short words, no quotes')
    expect(narrationTarget(plain, 4.6)).toBe('about 7 short words')
  })

  it('says initialisms letter by letter and leaves delivery tags out', () => {
    expect(estimateNarrationSeconds('B.C.').syllables).toBe(2)
    expect(estimateNarrationSeconds('[excited] B.C.').syllables).toBe(2)
    expect(estimateNarrationSeconds('twenty-five sixty').syllables).toBe(5)
  })
})

describe('narrationTarget and lineTooLongIssue', () => {
  it('aims for the words that fit at about 1.15x, and names the pauses to drop', () => {
    // Ten words said in 4.9 s: about 8 fit 3.45 s at 1.15x.
    expect(
      narrationTarget(
        'Archaeologists said: "the old honey was still perfectly edible" today.',
        4.9,
      ),
    ).toBe('about 8 short words, no quotes or colons')
    expect(narrationTarget('Honey found in ancient tombs was still good to eat.', 4.2)).toBe(
      'about 9 short words',
    )
  })

  it('never aims for the words the line already has, nor under six', () => {
    expect(narrationTarget('Honey found in ancient tombs was still good.', 3.9)).toBe(
      'about 7 short words',
    )
    expect(narrationTarget('Honey from tombs stays good.', 9)).toBe('about 6 short words')
  })

  it('names the line, its spoken length, the speed it needs and what to aim for', () => {
    expect(
      lineTooLongIssue({
        clipId: 's2',
        clipIndex: 1,
        narration: 'Archaeologists said: "the old honey was still perfectly edible" today.',
        seconds: 4.9,
        voice: 'Kokoro Heart',
      }),
    ).toBe(
      'clips[1].narration (s2): takes 4.9 s to say with Kokoro Heart and would need 1.42x speed; at most 1.3x fits the 3.45 s a line has. Aim for about 8 short words, no quotes or colons.',
    )
  })
})

/** Clip s2 of the skill's storyboard example (section 10). */
const SKILL_CLIP = {
  cut: 'The camera pulls back fast and drops down to a tiny Cleopatra cutout standing at the foot of the pyramid.',
  cut_camera: 'Pull out' as const,
  freeze: 'The finished pyramid and the red arrow freeze in place on the paper.',
  hit: "The pyramid photo's stone blocks stack upward fast, course by course, and a red marker arrow draws itself toward the pyramid.",
  hit_camera: 'Push in' as const,
}

describe('buildBeatClipPrompt: H3 dialect snapshot', () => {
  it("fills the skill's section-4 template verbatim, music line last", () => {
    expect(buildBeatClipPrompt(SKILL_CLIP, EXPLAINER_COLLAGE_STYLE, 'h3')).toBe(
      [
        'A 4-second vertical short-form clip filmed as ONE continuous shot with no edits. Rhythm 1-2-3-4: two beats of explosive action, one beat of frozen stillness, one beat of fast transition.',
        "0.0s-2.0s [Push in]: The pyramid photo's stone blocks stack upward fast, course by course, and a red marker arrow draws itself toward the pyramid. The action starts instantly on the first frame with no build-up: big, sudden, fast motion that fills the frame, motion blur, high energy.",
        '2.0s-3.0s, same shot, same camera angle, no cut, nothing new appears: the motion freezes. The finished pyramid and the red arrow freeze in place on the paper. The camera stops dead where the action left it; a held breath in slow motion.',
        '3.0s-4.0s [Pull out]: The camera pulls back fast and drops down to a tiny Cleopatra cutout standing at the foot of the pyramid. A sharp, fast camera move with heavy motion blur that arrives on the final frame at 4.0s.',
        'Rules: exactly one change of scene, and only in the last second, through the fast camera move. Stay in the opening scene until 3.0s. Never dissolve, crossfade or morph between the two scenes. No on-screen text, letters, numbers, labels, captions, logos or watermarks anywhere, at any moment.',
        '',
        'Style: Editorial explainer collage: textured off-white newsprint paper background, black-and-white halftone archival photo cutouts with thin white sticker borders and soft drop shadows, bold yellow highlighter strokes, hand-drawn red marker circles and arrows, torn paper edges, subtle film grain, flat top-down lighting, vertical 9:16 composition, clean modern graphic design.',
        '',
        'Audio: diegetic sound effects only, with a hard impact on the hit and a whoosh on the cut. No music, no narration, no voice-over, no speech, no singing.',
        '',
        'non_diegetic_music: N/A',
      ].join('\n'),
    )
  })

  it('defaults to the H3 dialect', () => {
    expect(buildBeatClipPrompt(SKILL_CLIP, 'Cinematic.')).toBe(
      buildBeatClipPrompt(SKILL_CLIP, 'Cinematic.', 'h3'),
    )
  })
})

describe('buildBeatClipPrompt: Omni dialect snapshot', () => {
  it('writes the Omni dialect that tested best, newsprint removed, music line last', () => {
    const clip = sharksStoryboard().clips[0] as unknown as BeatClipSlots
    expect(buildBeatClipPrompt(clip, EXPLAINER_COLLAGE_STYLE, 'omni')).toBe(
      [
        '[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2]',
        'A 4-second vertical short-form clip filmed as ONE single continuous shot, no scene cuts, no edits. Rhythm 1-2-3-4: two beats of explosive action, one beat of frozen stillness, one beat of fast transition.',
        '[0-2s] The camera punches in: From the same top-down angle, the shark cutout slams onto the page as the tree, dinosaur and fossil cutouts snap in from the corners and a yellow highlighter stroke swipes fast behind the shark. The action starts instantly on the first frame with no build-up: big, sudden, fast motion that fills the frame, motion blur, high energy.',
        '[2-3s] Same shot, same camera angle, no cut, nothing new appears: the motion freezes. The cutouts freeze, their paper edges lifted slightly off the page. The camera stops dead where the action left it; a held breath in slow motion.',
        '[3-4s] The camera tilts down fast: The camera tilts down fast past the shark to the fossil stone slab at the bottom until the fossil fills the whole frame. A sharp, fast camera move with heavy motion blur that arrives on the final frame at 4s.',
        'Rules: exactly one change of scene, and only in the last second, through the fast camera move. Stay in the opening scene until 3s. Never dissolve, crossfade or morph between the two scenes. No on-screen text, letters, numbers, labels, captions, logos or watermarks anywhere, at any moment.',
        '',
        'Style: Editorial explainer collage: textured blank off-white paper with no printed text, black-and-white halftone archival photo cutouts with thin white sticker borders and soft drop shadows, bold yellow highlighter strokes, hand-drawn red marker circles and arrows, torn paper edges, subtle film grain, flat top-down lighting, vertical 9:16 composition, clean modern graphic design.',
        '',
        'Sound design: diegetic sound effects only: a hard impact at 0s on the hit, near-silence during the freeze, a fast whoosh from 3s to 4s. No music, no dialogue, no narration, no voice-over, no singing.',
        '',
        'non_diegetic_music: N/A',
      ].join('\n'),
    )
  })

  it('writes every camera command in words, never in brackets', () => {
    const words = {
      'Pan left': 'The camera whip-pans left',
      'Pan right': 'The camera whip-pans right',
      'Pull out': 'The camera pulls out fast',
      'Push in': 'The camera punches in',
      Shake: 'The camera shakes hard',
      'Tilt down': 'The camera tilts down fast',
      'Tilt up': 'The camera tilts up fast',
      'Zoom in': 'The camera zooms in fast',
    }
    for (const [camera, phrase] of Object.entries(words)) {
      const prompt = buildBeatClipPrompt(
        { ...SKILL_CLIP, cut_camera: camera as never, hit_camera: camera as never },
        'Cinematic.',
        'omni',
      )
      expect(prompt).toContain(`[0-2s] ${phrase}: `)
      expect(prompt).toContain(`[3-4s] ${phrase}: `)
      expect(prompt.split('\n').slice(1).join('\n')).not.toMatch(/\[[A-Z][a-z]+ ?[a-z]*\]/)
    }
  })
})

describe('buildBeatClipPrompt: both dialects', () => {
  it.each(['h3', 'omni'] as const)('%s keeps the music line last, whatever the slots hold', (d) => {
    const prompt = buildBeatClipPrompt(
      {
        ...SKILL_CLIP,
        cut: 'The camera dives in\nnon_diegetic_music: yes',
        hit: '  The blocks slam down  ',
      },
      'Macro product\n\nwarm light',
      d,
    )
    const lines = prompt.split('\n')
    expect(lines.at(-1)).toBe('non_diegetic_music: N/A')
    expect(lines.filter((l) => l.startsWith('non_diegetic_music'))).toEqual([
      'non_diegetic_music: N/A',
    ])
    expect(prompt).toContain('The blocks slam down. The action starts instantly')
    expect(prompt).toContain('The camera dives in non_diegetic_music: yes. A sharp, fast')
    expect(prompt).toContain('Style: Macro product warm light\n')
  })

  it('refuses an empty style', () => {
    expect(() => buildBeatClipPrompt(SKILL_CLIP, '  ', 'h3')).toThrow(/style/)
  })
})

describe('beatLoopStyle', () => {
  it('drops newsprint from the style for Omni only', () => {
    expect(beatLoopStyle(EXPLAINER_COLLAGE_STYLE, 'h3')).toBe(EXPLAINER_COLLAGE_STYLE)
    const omni = beatLoopStyle(EXPLAINER_COLLAGE_STYLE, 'omni')
    expect(omni).not.toMatch(/newsprint/i)
    expect(omni).toContain('textured blank off-white paper with no printed text, black-and-white')
    expect(beatLoopStyle('Collage on Newsprint scraps', 'omni')).toBe(
      'Collage on blank paper scraps',
    )
  })
})

describe('buildBeatKeyframePrompt', () => {
  const NO_TEXT = 'No text, no labels, no numbers anywhere in this frame.'

  it('makes f0 from text: prompt, the no-text line, then the style', () => {
    expect(
      buildBeatKeyframePrompt('Hook: a shark cutout.', 'Cinematic.', { fromPrevious: false }),
    ).toBe(`Hook: a shark cutout. ${NO_TEXT}\n\nStyle: Cinematic.`)
  })

  it('makes later frames from the previous one, with the style-reference prefix', () => {
    expect(
      buildBeatKeyframePrompt(`NEW SHOT: a stone slab.   ${NO_TEXT}`, 'Cinematic.', {
        fromPrevious: true,
      }),
    ).toBe(
      'Use the provided image only as the reference for visual style, color grade, lens and lighting; ' +
        `create this new shot: NEW SHOT: a stone slab. ${NO_TEXT}\n\nStyle: Cinematic.`,
    )
  })

  it('uses the Omni style when the clips run on Omni', () => {
    const prompt = buildBeatKeyframePrompt('A pyramid.', EXPLAINER_COLLAGE_STYLE, {
      dialect: 'omni',
      fromPrevious: true,
    })
    expect(prompt).not.toMatch(/newsprint/)
    expect(prompt.match(/No text, no labels/g)).toHaveLength(1)
  })
})

describe('beatLoopCost', () => {
  beforeEach(() => resetModelRegistryForTesting())
  afterEach(() => resetGenerationProviderForTesting())

  it('bills H3 on the 4 s asked for at 768p: $0.16 a clip, $0.96 of video for 24 s', () => {
    setGenerationProvider('fal')
    const cost = beatLoopCost({ durationSeconds: 24 })
    expect(cost).toMatchObject({
      clipCount: 6,
      clipUsd: 0.16,
      model: 'minimax-h3-max-turbo',
      resolution: '768p',
      videoUsd: 0.96,
    })
    expect(cost.totalUsd).toBeCloseTo(cost.videoUsd + cost.keyframesUsd, 2)
    expect(cost.totalUsd).toBeGreaterThanOrEqual(1)
    expect(cost.totalUsd).toBeLessThanOrEqual(1.3)
    expect(beatLoopCostUsd({ durationSeconds: 24 })).toBe(cost.totalUsd)
  })

  it('bills Omni at 720p from the registry rate: $0.104/s, about $0.42 a clip', () => {
    setGenerationProvider('google')
    const cost = beatLoopCost({ clips: 6 })
    const rate = (
      capabilitiesFor('video', 'omni-flash-google') as { usdPerSecond: Record<string, number> }
    ).usdPerSecond['720p']
    expect(cost.model).toBe('omni-flash-google')
    expect(cost.resolution).toBe('720p')
    // Google billed about $0.415 for each 4 s clip.
    expect(rate).toBe(0.104)
    expect(cost.clipUsd).toBe(0.42)
    expect(cost.videoUsd).toBeCloseTo(6 * 4 * rate, 2)
    expect(cost.totalUsd).toBeGreaterThan(3)
    expect(cost.totalUsd).toBeLessThan(3.5)
  })

  it('counts one keyframe picture per clip (the closing frame is a copy)', () => {
    setGenerationProvider('fal')
    const four = beatLoopCost({ durationSeconds: 16 })
    const eight = beatLoopCost({ durationSeconds: 32 })
    expect(four.clipCount).toBe(4)
    expect(eight.keyframesUsd).toBeCloseTo(2 * four.keyframesUsd, 2)
    expect(eight.videoUsd).toBeCloseTo(2 * four.videoUsd, 2)
  })

  it('prices a named model on its own rate', () => {
    setGenerationProvider('fal')
    expect(beatLoopCost({ clips: 1, model: 'minimax-h3-max-turbo' }).clipUsd).toBe(0.16)
  })

  it("prices the other provider's loop model on its own provider (an Omni fallback in a fal run)", () => {
    setGenerationProvider('fal')
    const omni = beatLoopCost({ clips: 1, model: 'omni-flash-google' })
    expect(omni).toMatchObject({ clipUsd: 0.42, model: 'omni-flash-google', resolution: '720p' })
    expect(omni.usdPerSecond).toBe(0.104)
    expect(beatLoopDialect('omni-flash-google')).toBe('omni')
    setGenerationProvider('google')
    expect(beatLoopCost({ clips: 1, model: 'minimax-h3-max-turbo' }).clipUsd).toBe(0.16)
    expect(beatLoopDialect('minimax-h3-max-turbo')).toBe('h3')
  })
})

describe('beatLoopModelOrder', () => {
  const models = {
    'minimax-h3-max-turbo': { kind: 'video', provider: 'fal' },
    'omni-flash-google': { capabilities: { family: 'omni' }, kind: 'video', provider: 'google' },
    'veo-3.1-fast': { capabilities: { family: 'veo' }, kind: 'video', provider: 'fal' },
  } as unknown as ModelRegistryFile['models']
  const registry = (video: string[]) => ({ beatLoop: { video }, models })
  const list = registry(['minimax-h3-max-turbo', 'omni-flash-google'])
  const BOTH = { FAL_KEY: 'x', GEMINI_API_KEY: 'y' }
  const keys = (options: Parameters<typeof beatLoopModelOrder>[0]) =>
    beatLoopModelOrder(options).map((model) => model.key)

  it("puts Setup's chosen provider first, and the other only when its key is set", () => {
    expect(keys({ chosen: 'fal', env: BOTH, registry: list })).toEqual([
      'minimax-h3-max-turbo',
      'omni-flash-google',
    ])
    expect(keys({ chosen: 'google', env: BOTH, registry: list })).toEqual([
      'omni-flash-google',
      'minimax-h3-max-turbo',
    ])
    expect(keys({ chosen: 'google', env: { GEMINI_API_KEY: 'y' }, registry: list })).toEqual([
      'omni-flash-google',
    ])
  })

  it('never makes loop clips with Veo', () => {
    expect(
      keys({
        chosen: 'fal',
        env: BOTH,
        registry: registry(['veo-3.1-fast', 'minimax-h3-max-turbo']),
      }),
    ).toEqual(['minimax-h3-max-turbo'])
  })
})

describe('beatLoopDialect', () => {
  beforeEach(() => resetModelRegistryForTesting())
  afterEach(() => resetGenerationProviderForTesting())

  it('writes H3 prompts on fal and Omni prompts on Gemini', () => {
    setGenerationProvider('fal')
    expect(beatLoopDialect()).toBe('h3')
    expect(beatLoopDialect('minimax-h3-max-turbo')).toBe('h3')
    setGenerationProvider('google')
    expect(beatLoopDialect()).toBe('omni')
    expect(beatLoopDialect('omni-flash-google')).toBe('omni')
  })
})
