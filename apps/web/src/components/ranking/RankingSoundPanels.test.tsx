import { DEFAULT_RANKING_TRANSITION } from '@reelmakeeasy/common/ranking/ranking-project'
import type { RankingTransition } from '@shared/types/api/ranking'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'

import { TransitionPanel } from './RankingSoundPanels'

/** The panel with its transition kept in state, as the studio keeps it; `seen` gets every save. */
function Host({ seen, start }: { seen: (t: RankingTransition) => void; start: RankingTransition }) {
  const [value, setValue] = useState(start)
  return (
    <TransitionPanel
      onChange={(t) => {
        seen(t)
        setValue(t)
      }}
      slides={[2, 1]}
      sounds={[]}
      value={value}
    />
  )
}

const ON = { ...DEFAULT_RANKING_TRANSITION, enabled: true, text: 'Number {rank}…' }
const row = (rank: number) =>
  screen.getByRole('textbox', { name: `Text of the slide before #${rank}` }) as HTMLInputElement

describe('TransitionPanel slide rows', () => {
  it('lets words be typed with their spaces, and keeps them when the box is left', () => {
    const seen = jest.fn()
    render(<Host seen={seen} start={ON} />)
    expect(row(2).value).toBe('Number 2…')
    // Typed a key at a time: the space after a word stays in the box.
    for (const typed of ['A', 'An', 'And', 'And ', 'And t', 'And th', 'And the ']) {
      fireEvent.change(row(2), { target: { value: typed } })
      expect(row(2).value).toBe(typed)
    }
    expect(seen).not.toHaveBeenCalled()
    fireEvent.blur(row(2))
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ texts: { '2': 'And the' } }))
    expect(row(2).value).toBe('And the')
    expect(row(1).value).toBe('Number 1…')
  })

  it('follows the template again when its words are typed back, and Escape drops a draft', () => {
    const seen = jest.fn()
    render(<Host seen={seen} start={{ ...ON, texts: { '2': 'Who did it?' } }} />)
    fireEvent.change(row(2), { target: { value: '  Number   2… ' } })
    fireEvent.keyDown(row(2), { key: 'Enter' })
    expect(seen.mock.calls.at(-1)?.[0]).not.toHaveProperty('texts')
    fireEvent.change(row(1), { target: { value: 'Oops' } })
    fireEvent.keyDown(row(1), { key: 'Escape' })
    fireEvent.blur(row(1))
    expect(row(1).value).toBe('Number 1…')
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('keeps an emptied box as a blank slide, and Reset puts the template back', () => {
    const seen = jest.fn()
    render(<Host seen={seen} start={ON} />)
    fireEvent.change(row(1), { target: { value: '' } })
    fireEvent.blur(row(1))
    expect(seen).toHaveBeenLastCalledWith(expect.objectContaining({ texts: { '1': '' } }))
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }))
    expect(seen.mock.calls.at(-1)?.[0]).not.toHaveProperty('texts')
    expect(row(1).value).toBe('Number 1…')
  })

  it('compares as the slide is saved: a template with a run of spaces still counts as itself', () => {
    const seen = jest.fn()
    render(<Host seen={seen} start={{ ...ON, text: 'Number  {rank}' }} />)
    // Left untouched: nothing saved.
    fireEvent.focus(row(2))
    fireEvent.blur(row(2))
    // Its words typed back, spaced either way: still the template.
    fireEvent.change(row(2), { target: { value: 'Number 2' } })
    fireEvent.blur(row(2))
    fireEvent.change(row(1), { target: { value: 'Number   1 ' } })
    fireEvent.keyDown(row(1), { key: 'Enter' })
    expect(seen).not.toHaveBeenCalled()
  })
})
