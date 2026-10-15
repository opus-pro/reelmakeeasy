import type { AgentQuestion } from '@shared/types/api/agent'
import { fireEvent, render, screen } from '@testing-library/react'

import { QuestionCard, type QuestionCardProps } from './QuestionCard'

const sample = (id: string) => ({
  posterUrl: `http://api.test/presets/v9/camera-samples/${id}.jpg`,
  videoUrl: `http://api.test/presets/v9/camera-samples/${id}.mp4`,
})

const CAMERA: AgentQuestion = {
  header: 'Camera style',
  id: 'camera',
  isOther: false,
  isSecret: false,
  options: [
    { description: 'Moves a lot.', label: 'Dynamic', sample: sample('dynamic') },
    { description: 'Moves slowly.', label: 'Calm', sample: sample('calm') },
    {
      description: 'Hit, hit, freeze, cut.',
      label: 'Beat loop',
      sample: sample('beat-loop'),
    },
  ],
  question: 'How should the camera move?',
}

const MUSIC: AgentQuestion = {
  header: 'Music',
  id: 'music',
  isOther: false,
  isSecret: false,
  options: [
    { description: 'Lively.', label: 'Upbeat (Recommended)' },
    { description: 'Quiet.', label: 'Calm' },
  ],
  question: 'What music?',
}

function card(
  question: AgentQuestion,
  over: Partial<QuestionCardProps['entry']> = {},
  onAnswer: QuestionCardProps['onAnswer'] = jest.fn(async () => true),
) {
  return render(
    <QuestionCard
      entry={{ id: 'q1', kind: 'question', questions: [question], state: 'open', ...over }}
      onAnswer={onAnswer}
    />,
  )
}

const option = (name: RegExp) => screen.getByRole('button', { name })
const posters = (root: HTMLElement) =>
  [...root.querySelectorAll('img')].map((img) => img.getAttribute('src'))
const videoIn = (button: HTMLElement) => button.querySelector('video')

// jsdom has no PointerEvent, so `fireEvent.pointerDown(el, { pointerType })` would lose the type.
if (window.PointerEvent === undefined) {
  class PointerEventStub extends MouseEvent {
    pointerType: string
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerType = init.pointerType ?? ''
    }
  }
  ;(window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventStub
}

let play: jest.SpyInstance
let pause: jest.SpyInstance

beforeEach(() => {
  play = jest.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
  pause = jest.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
})

afterEach(() => {
  play.mockRestore()
  pause.mockRestore()
})

describe('QuestionCard', () => {
  it('options without a sample render as before: no thumbnail, no clip', () => {
    const { container } = card(MUSIC)
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
    expect(option(/Upbeat/).textContent).toContain('Recommended')
  })

  it('shows a poster per sampled option, with a muted looping clip that is not fetched yet', () => {
    const { container } = card(CAMERA)
    expect(posters(container)).toEqual(CAMERA.options.map((o) => o.sample?.posterUrl))
    for (const o of CAMERA.options) {
      const video = videoIn(
        option(new RegExp(o.label.replace(/[()]/g, String.raw`\$&`))),
      ) as HTMLVideoElement
      expect(video.getAttribute('src')).toBe(o.sample?.videoUrl)
      expect(video.getAttribute('preload')).toBe('none')
      expect(video.muted).toBe(true)
      expect(video.loop).toBe(true)
      expect(video.hasAttribute('playsinline')).toBe(true)
      expect(video.closest('[aria-hidden="true"]')).not.toBeNull()
      expect(video.className).toMatch(/object-cover/)
    }
    expect(play).not.toHaveBeenCalled()
  })

  it('the option stays the button, named by its label', () => {
    card(CAMERA)
    expect(option(/^Dynamic/)).toBeTruthy()
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })

  it('plays the clip on hover and stops it when the pointer leaves', () => {
    card(CAMERA)
    const calm = option(/^Calm/)
    fireEvent.pointerEnter(calm)
    expect(play).toHaveBeenCalledTimes(1)
    expect(play.mock.contexts[0]).toBe(videoIn(calm))
    fireEvent.pointerLeave(calm)
    expect(pause).toHaveBeenCalled()
  })

  it('plays the clip when the option gets keyboard focus', () => {
    card(CAMERA)
    const dynamic = option(/^Dynamic/)
    fireEvent.focus(dynamic)
    expect(play.mock.contexts[0]).toBe(videoIn(dynamic))
  })

  it('on a phone, a tap on the thumbnail plays the clip instead of answering', () => {
    const onAnswer = jest.fn(async () => true)
    card(CAMERA, {}, onAnswer)
    const loop = option(/^Beat loop/)
    const thumb = loop.querySelector('[aria-hidden="true"]') as Element
    fireEvent.pointerDown(thumb, { pointerType: 'touch' })
    fireEvent.click(thumb)
    expect(onAnswer).not.toHaveBeenCalled()
    expect(play.mock.contexts[0]).toBe(videoIn(loop))
    // A tap on the words still answers.
    fireEvent.pointerDown(loop, { pointerType: 'touch' })
    fireEvent.click(loop)
    expect(onAnswer).toHaveBeenCalledWith({ camera: ['Beat loop'] })
  })

  it('on Android, tapping one thumbnail and then another compares clips without answering', () => {
    // Chrome on Android focuses a tapped button: pointerdown, then focus moves (blur, focus), then click.
    const onAnswer = jest.fn(async () => true)
    card(CAMERA, {}, onAnswer)
    const dynamic = option(/^Dynamic/)
    const calm = option(/^Calm/)
    const thumbOf = (button: HTMLElement) => button.querySelector('[aria-hidden="true"]') as Element
    fireEvent.pointerDown(thumbOf(dynamic), { pointerType: 'touch' })
    fireEvent.focus(dynamic)
    fireEvent.click(thumbOf(dynamic))
    expect(play.mock.contexts.at(-1)).toBe(videoIn(dynamic))
    fireEvent.pointerDown(thumbOf(calm), { pointerType: 'touch' })
    fireEvent.blur(dynamic)
    fireEvent.focus(calm)
    fireEvent.click(thumbOf(calm))
    expect(onAnswer).not.toHaveBeenCalled()
    expect(play.mock.contexts.at(-1)).toBe(videoIn(calm))
    expect(pause.mock.contexts).toContain(videoIn(dynamic))
  })

  it('after a tap, moving to an option with the keyboard plays its clip again', () => {
    card(CAMERA)
    const dynamic = option(/^Dynamic/)
    const calm = option(/^Calm/)
    fireEvent.pointerDown(dynamic.querySelector('[aria-hidden="true"]') as Element, {
      pointerType: 'touch',
    })
    fireEvent.focus(dynamic)
    expect(play).not.toHaveBeenCalled()
    fireEvent.keyDown(dynamic, { key: 'Tab' })
    fireEvent.blur(dynamic)
    fireEvent.focus(calm)
    expect(play.mock.contexts.at(-1)).toBe(videoIn(calm))
  })

  it('a click on the thumbnail with a mouse answers, like the rest of the option', () => {
    const onAnswer = jest.fn(async () => true)
    card(CAMERA, {}, onAnswer)
    const thumb = option(/^Calm/).querySelector('[aria-hidden="true"]') as Element
    fireEvent.pointerDown(thumb, { pointerType: 'mouse' })
    fireEvent.click(thumb)
    expect(onAnswer).toHaveBeenCalledWith({ camera: ['Calm'] })
  })

  it('an answered card keeps the chosen poster, with no clip to play', () => {
    const { container } = card(CAMERA, { answers: { camera: ['Calm'] }, state: 'answered' })
    const calm = option(/^Calm/)
    expect(calm.querySelector('img')?.getAttribute('src')).toBe(CAMERA.options[1].sample?.posterUrl)
    expect(container.querySelector('video')).toBeNull()
    fireEvent.pointerEnter(calm)
    expect(play).not.toHaveBeenCalled()
  })
})

describe('an expired card', () => {
  const expired = (expiredHint?: string) =>
    render(
      <QuestionCard
        entry={{ id: 'q1', kind: 'question', questions: [MUSIC], server: true, state: 'expired' }}
        onAnswer={jest.fn(async () => true)}
        {...(expiredHint ? { expiredHint } : {})}
      />,
    )

  it('says to reply in the chat, in a chat that takes a reply', () => {
    expired()
    expect(screen.getByText('This question expired. Reply in the chat instead.')).toBeTruthy()
  })

  it('says only that it expired where the chat takes no reply (an Easy chat)', () => {
    expired('This question expired.')
    expect(screen.getByText('This question expired.')).toBeTruthy()
    expect(screen.queryByText(/Reply in the chat/)).toBeNull()
  })
})
