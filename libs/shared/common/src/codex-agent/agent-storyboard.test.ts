import type { AgentQuestion } from '@shared/types/api/agent'
import type { LongTakeKeyframe, LongTakeTransition } from '@shared/types/api/long-take'

import {
  CAMERA_STYLE_HEADER,
  loopScriptLines,
  MUSIC_HEADER,
  orderKeyframes,
  pickedCameraStyle,
  pickedIdea,
  pickedMusic,
  pickedOpening,
  scriptLines,
  splitRecommended,
  versionedVideoUrl,
} from './agent-storyboard'
import type { TranscriptEntry } from './agent-transcript'

describe('versionedVideoUrl', () => {
  it('leaves version 0 alone and adds the version as a query otherwise', () => {
    expect(versionedVideoUrl('http://h/f.mp4', 0)).toBe('http://h/f.mp4')
    expect(versionedVideoUrl('http://h/f.mp4', 2)).toBe('http://h/f.mp4?v=2')
    expect(versionedVideoUrl('http://h/f.mp4?t=1#x', 3)).toBe('http://h/f.mp4?t=1&v=3#x')
  })
})

describe('orderKeyframes', () => {
  const k = (shotId: string): LongTakeKeyframe => ({ keyframeUrl: `u-${shotId}`, shotId })
  const t = (fromShotId: string, toShotId: string, startMs: number): LongTakeTransition => ({
    endMs: startMs + 1000,
    fromShotId,
    prompt: '',
    startMs,
    toShotId,
    transitionId: `${fromShotId}-${toShotId}`,
    videoUri: '',
  })
  const ids = (list: LongTakeKeyframe[]) => list.map((x) => x.shotId)

  it('keeps the plan order with no transitions', () => {
    expect(ids(orderKeyframes([k('1'), k('3'), k('2')], []))).toEqual(['1', '3', '2'])
  })

  it('follows a complete chain covering every keyframe, whatever the transitions array order', () => {
    const transitions = [t('2', '3', 2000), t('1', '2', 0)]
    expect(ids(orderKeyframes([k('3'), k('1'), k('2')], transitions))).toEqual(['1', '2', '3'])
  })

  it('keeps the plan order when the transitions cover only some keyframes', () => {
    expect(ids(orderKeyframes([k('3'), k('1'), k('2')], [t('1', '2', 0)]))).toEqual(['3', '1', '2'])
  })

  it('keeps the plan order when the transitions do not chain, or revisit a shot', () => {
    const plan = [k('3'), k('1'), k('2')]
    expect(ids(orderKeyframes(plan, [t('1', '2', 0), t('3', '1', 1000)]))).toEqual(['3', '1', '2'])
    expect(ids(orderKeyframes(plan, [t('1', '2', 0), t('2', '1', 1000)]))).toEqual(['3', '1', '2'])
  })

  it('keeps the plan order when the chain names a shot with no keyframe', () => {
    const plan = [k('2'), k('1')]
    expect(ids(orderKeyframes(plan, [t('1', '2', 0), t('2', 'x', 1000)]))).toEqual(['2', '1'])
  })
})

describe('pickedIdea', () => {
  const ideaQuestion: AgentQuestion = {
    header: 'Idea',
    id: 'idea',
    isOther: true,
    isSecret: false,
    options: [
      { description: 'Three hearts.', label: 'Fun fact: Octopus hearts (Recommended)' },
      { description: '', label: 'Recent news: A comet' },
    ],
    question: 'Which idea should we make?',
  }
  const answered = (answer: string, header = 'Idea'): TranscriptEntry => ({
    answers: { idea: [answer] },
    id: 'autonomous-idea-1',
    kind: 'question',
    questions: [{ ...ideaQuestion, header }],
    state: 'answered',
  })

  it('returns the picked option without "(Recommended)", with its description as the hook', () => {
    expect(pickedIdea([answered('Fun fact: Octopus hearts (Recommended)')])).toEqual({
      hook: 'Three hearts.',
      title: 'Fun fact: Octopus hearts',
    })
  })

  it('leaves out an empty hook', () => {
    expect(pickedIdea([answered('Recent news: A comet')])).toEqual({
      hook: undefined,
      title: 'Recent news: A comet',
    })
  })

  it('returns typed text as is, with no hook', () => {
    expect(pickedIdea([answered('  my own idea ')])).toEqual({ title: 'my own idea' })
  })

  it('is null for an open card, another card, or no card', () => {
    expect(pickedIdea([])).toBeNull()
    expect(pickedIdea([answered('x', 'Try again')])).toBeNull()
    expect(
      pickedIdea([{ id: 'q', kind: 'question', questions: [ideaQuestion], state: 'open' }]),
    ).toBeNull()
  })
})

describe('pickedOpening', () => {
  const openingQuestion: AgentQuestion = {
    header: 'Attention hook',
    id: 'opening',
    isOther: true,
    isSecret: false,
    options: [
      {
        description: 'Everyone looks up.',
        label: 'Question: Is the comet visible tonight? (Recommended)',
      },
      { description: 'A huge number.', label: 'Shock number: Ten thousand years.' },
    ],
    question: 'How should the video start?',
  }
  const answered = (answer: string): TranscriptEntry => ({
    answers: { opening: [answer] },
    id: 'autonomous-opening-2',
    kind: 'question',
    questions: [openingQuestion],
    state: 'answered',
  })

  it('returns the picked opening without "(Recommended)", with why it hooks', () => {
    expect(
      pickedOpening([answered('Question: Is the comet visible tonight? (Recommended)')]),
    ).toEqual({
      hook: 'Everyone looks up.',
      title: 'Question: Is the comet visible tonight?',
    })
  })

  it('returns a typed opening as it was written', () => {
    expect(pickedOpening([answered('Look up tonight.')])).toEqual({ title: 'Look up tonight.' })
  })

  it('still reads cards from chats made when the header was "Opening"', () => {
    const legacy = answered('Look up tonight.')
    if (legacy.kind !== 'question') throw new Error('fixture')
    expect(
      pickedOpening([{ ...legacy, questions: [{ ...openingQuestion, header: 'Opening' }] }]),
    ).toEqual({ title: 'Look up tonight.' })
  })

  it('is null without an answered opening card, and ignores the idea card', () => {
    expect(pickedOpening([])).toBeNull()
    expect(
      pickedOpening([{ ...answered('x'), questions: [{ ...openingQuestion, header: 'Idea' }] }]),
    ).toBeNull()
  })
})

describe('scriptLines', () => {
  it('splits on line breaks and after sentence punctuation followed by whitespace', () => {
    expect(
      scriptLines('Look up tonight! A comet passes.\n\nIt costs 3.5 dollars? Wow…  Really'),
    ).toEqual(['Look up tonight!', 'A comet passes.', 'It costs 3.5 dollars?', 'Wow…', 'Really'])
  })

  it('keeps runs of punctuation together and drops empty lines', () => {
    expect(scriptLines('What?! Yes...  \n  \nEnd')).toEqual(['What?!', 'Yes...', 'End'])
  })

  it('ends a sentence after its closing quotes and brackets too', () => {
    // A live loop's lines 3-6 ran together: each ended in a quote after the full stop.
    expect(
      scriptLines(
        "Children recited its name as 'and per se and.' 'Per se' means 'by itself': the symbol meant ‘and.’ Said quickly, it became “ampersand.” (Really.) Next time, remember it.",
      ),
    ).toEqual([
      "Children recited its name as 'and per se and.'",
      "'Per se' means 'by itself': the symbol meant ‘and.’",
      'Said quickly, it became “ampersand.”',
      '(Really.)',
      'Next time, remember it.',
    ])
  })
})

describe('loopScriptLines', () => {
  const lines = [
    { narration: 'Honey found in ancient tombs was still good to eat.', stamp: 'c. 1325 BC' },
    { narration: "'Per se' means 'by itself': the symbol meant 'and.'", stamp: null },
    { narration: 'Seal the lid and it keeps. For thousands of years.', stamp: '3,000 YEARS' },
  ]

  it("shows the storyboard's lines, each with its stamp, before the video has a script", () => {
    expect(loopScriptLines(lines, null)).toEqual(lines)
  })

  it("takes each line's words from the project's script (one line per clip), so a redo's new words show", () => {
    const script = [
      'Honey from the tombs of Egypt was still good to eat.',
      lines[1].narration,
      lines[2].narration,
    ].join('\n')
    expect(loopScriptLines(lines, script)).toEqual([
      { narration: 'Honey from the tombs of Egypt was still good to eat.', stamp: 'c. 1325 BC' },
      lines[1],
      lines[2],
    ])
  })

  it("keeps the storyboard's lines when the script doesn't have one line per clip", () => {
    expect(loopScriptLines(lines, lines.map((l) => l.narration).join(' '))).toEqual(lines)
    expect(loopScriptLines(lines, `${lines[0].narration}\n${lines[1].narration}`)).toEqual(lines)
  })
})

describe('splitRecommended', () => {
  it('strips the suffix in any case and spacing', () => {
    expect(splitRecommended('Bold ( recommended )')).toEqual({ recommended: true, text: 'Bold' })
    expect(splitRecommended('Bold')).toEqual({ recommended: false, text: 'Bold' })
  })
})

describe('pickedCameraStyle', () => {
  it('returns the picked camera style with its description', () => {
    const entries: TranscriptEntry[] = [
      {
        answers: { camera: ['Dynamic'] },
        id: 'autonomous-camera-3',
        kind: 'question',
        questions: [
          {
            header: CAMERA_STYLE_HEADER,
            id: 'camera',
            isOther: false,
            isSecret: false,
            options: [
              {
                description: 'Bold camera moves, quicker shots, something moving in every scene.',
                label: 'Dynamic',
              },
              { description: 'Smooth, steady camera and longer shots.', label: 'Calm' },
            ],
            question: 'How should the camera move?',
          },
        ],
        state: 'answered',
      },
    ]
    expect(pickedCameraStyle(entries)).toEqual({
      hook: 'Bold camera moves, quicker shots, something moving in every scene.',
      title: 'Dynamic',
    })
    expect(pickedCameraStyle([])).toBeNull()
  })
})

describe('pickedMusic', () => {
  it('returns the picked music choice with its description', () => {
    const entries: TranscriptEntry[] = [
      {
        answers: { music: ['Upbeat'] },
        id: 'autonomous-music-4',
        kind: 'question',
        questions: [
          {
            header: MUSIC_HEADER,
            id: 'music',
            isOther: true,
            isSecret: false,
            options: [
              {
                description: "A bed that fits the video's mood.",
                label: 'Pick for me (Recommended)',
              },
              { description: 'Energetic and driving, with a clear pulse.', label: 'Upbeat' },
            ],
            question: 'Background music?',
          },
        ],
        state: 'answered',
      },
    ]
    expect(pickedMusic(entries)).toMatchObject({ title: 'Upbeat' })
    expect(pickedMusic([])).toBeNull()
  })
})
