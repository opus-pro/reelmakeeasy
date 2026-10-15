import { fireEvent, render, screen } from '@testing-library/react'

import { FirstVideoDialog, type FirstVideoDialogProps } from './FirstVideoDialog'

function renderDialog(over: Partial<FirstVideoDialogProps> = {}) {
  const props: FirstVideoDialogProps = {
    canStartEasy: true,
    generation: 'fal',
    onDismiss: jest.fn(),
    onNotNow: jest.fn(),
    onStart: jest.fn(),
    open: true,
    starting: false,
    ...over,
  }
  render(<FirstVideoDialog {...props} />)
  return props
}

describe('FirstVideoDialog', () => {
  it('asks, says what Easy does, and Go starts it', () => {
    const props = renderDialog()
    expect(screen.getByText('Make your first video?')).toBeTruthy()
    expect(screen.getByText(/Easy finds a fun fact, a news story or a famous figure/)).toBeTruthy()
    expect(screen.getByText(/makes the whole video in about 5 minutes/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    expect(props.onStart).toHaveBeenCalledTimes(1)
    expect(props.onNotNow).not.toHaveBeenCalled()
  })

  it('Not now answers the question without starting anything', () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(props.onNotNow).toHaveBeenCalledTimes(1)
    expect(props.onStart).not.toHaveBeenCalled()
  })

  it('closing it only hides it: the close button and Escape are not an answer', () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(props.onDismiss).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(props.onDismiss).toHaveBeenCalledTimes(2)
    expect(props.onNotNow).not.toHaveBeenCalled()
    expect(props.onStart).not.toHaveBeenCalled()
  })

  it('shows the cost on the video service in effect', () => {
    renderDialog({ generation: 'fal' })
    expect(screen.getByText('A 30-second video costs about $0.70 on fal.')).toBeTruthy()
  })

  it('shows the Gemini cost when Gemini makes the videos', () => {
    renderDialog({ generation: 'google' })
    expect(screen.getByText('A 30-second video costs about $3 on Gemini.')).toBeTruthy()
  })

  it('without Codex or Claude Code, offers an example idea instead of Easy', () => {
    const props = renderDialog({ canStartEasy: false, generation: 'google' })
    expect(screen.queryByRole('button', { name: 'Go' })).toBeNull()
    expect(screen.queryByText(/Easy finds/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try an example' }))
    expect(props.onStart).toHaveBeenCalledTimes(1)
  })

  it('while the chat opens, both buttons wait', () => {
    renderDialog({ starting: true })
    const opening = screen.getByRole('button', { name: 'Opening…' }) as HTMLButtonElement
    expect(opening.disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Not now' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
  })

  it('renders nothing while closed', () => {
    renderDialog({ open: false })
    expect(screen.queryByText('Make your first video?')).toBeNull()
  })
})
