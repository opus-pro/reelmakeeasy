import {
  emptyItems,
  newRankingProject,
  transitionOf,
  withSlideText,
} from '@reelmakeeasy/common/ranking/ranking-project'
import type { RankingClip, RankingProject } from '@shared/types/api/ranking'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import { type RankFocusRequest, RankingPreview } from './RankingPreview'

beforeAll(() => {
  ;(globalThis as { ResizeObserver?: unknown }).ResizeObserver = jest.fn(() => ({
    disconnect: jest.fn(),
    observe: jest.fn(),
    unobserve: jest.fn(),
  }))
  for (const [name, value] of [
    ['play', jest.fn(() => Promise.resolve())],
    ['pause', jest.fn()],
    ['load', jest.fn()],
  ] as const)
    Object.defineProperty(HTMLMediaElement.prototype, name, { configurable: true, value })
})

const clip = (name: string): RankingClip => ({
  durationSec: 4,
  name,
  trimEndSec: 4,
  trimStartSec: 0,
  url: `https://x/${name}.mp4`,
})

/** Three ranks in countdown, 4 s clips on `withClips`, a 1 s slide between them. */
function make(withClips: number[]): RankingProject {
  const base = newRankingProject('p1', '2026-10-21T00:00:00Z')
  return {
    ...base,
    items: emptyItems(3).map((it) => ({
      ...it,
      clip: withClips.includes(it.rank) ? clip(`c${it.rank}`) : null,
      label: `L${it.rank}`,
    })),
    reveal: { mode: 'countdown', order: [3, 2, 1] },
    transition: { ...transitionOf(base), durationSec: 1, enabled: true, text: 'Number {rank}' },
  }
}

let latest: RankingProject
let upload: (rank: number) => void = jest.fn()

/** The preview as the studio holds it: a clip upload sets the clip and asks to jump to it. */
function Host({ start }: { start: RankingProject }) {
  const [project, setProject] = useState(start)
  const [focusRequest, setFocusRequest] = useState<null | RankFocusRequest>(null)
  latest = project
  upload = (rank) => {
    setProject((p) => ({
      ...p,
      items: p.items.map((i) => (i.rank === rank ? { ...i, clip: clip(`c${rank}`) } : i)),
    }))
    setFocusRequest((r) => ({ nonce: (r?.nonce ?? 0) + 1, rank }))
  }
  return (
    <RankingPreview
      focusRequest={focusRequest}
      fontsReady
      onEditSlideText={(nextRank, text) =>
        setProject((p) => ({ ...p, transition: withSlideText(transitionOf(p), nextRank, text) }))
      }
      project={project}
      sounds={[]}
    />
  )
}

const timeline = () => screen.getByRole('slider', { name: 'Timeline' })
const at = () => Number(timeline().getAttribute('aria-valuenow'))
/** Moves the playhead a second at a time (the timeline's own arrow keys). */
function goTo(seconds: number) {
  for (let i = 0; i < seconds; i++)
    act(() => void fireEvent.keyDown(timeline(), { key: 'ArrowRight' }))
}
const editor = (rank: number) =>
  screen.queryByRole('textbox', {
    name: `Text of the slide before #${rank}, on the preview`,
  }) as HTMLInputElement | null
function openSlide(rank: number) {
  fireEvent.click(
    screen.getByRole('button', { name: `Change the text of the slide before #${rank}` }),
  )
  return editor(rank) as HTMLInputElement
}

describe('editing a slide on the preview', () => {
  it('keeps the text being typed when a clip arrives after the slide', () => {
    render(<Host start={make([3, 2])} />) // #3 0-4, slide to #2 4-5, #2 5-9
    goTo(4)
    fireEvent.change(openSlide(2), { target: { value: 'my draft' } })
    act(() => upload(1))
    expect(editor(2)?.value).toBe('my draft')
    expect(at()).toBe(4)
  })

  it('keeps it, and stays on the slide, when a clip arrives before it and moves it later', () => {
    render(<Host start={make([2, 1])} />) // #2 0-4, slide to #1 4-5, #1 5-9
    goTo(4)
    fireEvent.change(openSlide(1), { target: { value: 'my draft' } })
    act(() => upload(3)) // now #3 0-4, slide to #2 4-5, #2 5-9, slide to #1 9-10
    expect(editor(1)?.value).toBe('my draft')
    expect(at()).toBe(9)
    fireEvent.keyDown(editor(1) as HTMLInputElement, { key: 'Enter' })
    expect(latest.transition?.texts).toEqual({ '1': 'my draft' })
  })

  it('finishing by clicking the picture saves without starting playback', () => {
    render(<Host start={make([2, 1])} />)
    goTo(4)
    const input = openSlide(1)
    fireEvent.change(input, { target: { value: 'typed' } })
    const canvas = screen.getByTestId('ranking-stage').querySelector('canvas') as HTMLCanvasElement
    fireEvent.pointerDown(canvas)
    fireEvent.blur(input)
    fireEvent.click(canvas)
    expect(latest.transition?.texts).toEqual({ '1': 'typed' })
    expect(screen.queryByRole('button', { name: 'Pause (Space)' })).toBeNull()
    // The next click on the picture plays as usual.
    fireEvent.pointerDown(canvas)
    fireEvent.click(canvas)
    expect(screen.queryByRole('button', { name: 'Pause (Space)' })).not.toBeNull()
  })

  it('resets from the keyboard and puts the focus back on the slide', () => {
    const start = make([2, 1])
    start.transition = withSlideText(transitionOf(start), 1, 'Own one')
    render(<Host start={start} />)
    goTo(4)
    openSlide(1)
    const reset = screen.getByRole('button', { name: 'Same as every slide' })
    act(() => reset.focus())
    expect(editor(1)).not.toBeNull()
    // Enter on a button is a click with no pointer (detail 0).
    fireEvent.click(reset, { detail: 0 })
    expect(latest.transition).not.toHaveProperty('texts')
    expect(document.activeElement?.getAttribute('aria-label')).toBe(
      'Change the text of the slide before #1',
    )
  })

  it("an Enter that picks an input method's candidate doesn't finish it", () => {
    render(<Host start={make([2, 1])} />)
    goTo(4)
    const input = openSlide(1)
    fireEvent.change(input, { target: { value: 'にほん' } })
    fireEvent.keyDown(input, { isComposing: true, key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
    expect(editor(1)).not.toBeNull()
    expect(latest.transition).not.toHaveProperty('texts')
  })
})
