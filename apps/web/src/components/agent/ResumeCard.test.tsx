import { act, fireEvent, render, screen } from '@testing-library/react'

import { RESUME_BUTTON, RESUME_LINE, ResumeCard, resumeWords } from './ResumeCard'

describe('ResumeCard', () => {
  it('says what happened in a short line, with the button', () => {
    render(<ResumeCard onResume={jest.fn(async () => true)} />)
    expect(screen.getByText(RESUME_LINE)).toBeTruthy()
    expect(screen.getByRole('button', { name: RESUME_BUTTON })).toBeTruthy()
    expect(RESUME_BUTTON).toBe('Pick up where you left off')
  })

  it('a loop answered "Make it" before the stop: says picking up makes it now, and its price', () => {
    render(
      <ResumeCard
        action={{ costUsd: 1.2, kind: 'make_loop' }}
        onResume={jest.fn(async () => true)}
      />,
    )
    expect(
      screen.getByText(
        "Your loop wasn't started before ReelMakeEasy stopped. Picking up makes it now: about $1.20.",
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Make it now' })).toBeTruthy()
    expect(screen.queryByText(RESUME_LINE)).toBeNull()
  })

  it('a story video whose style was picked: says picking up starts it now', () => {
    render(<ResumeCard action={{ kind: 'start_video' }} onResume={jest.fn(async () => true)} />)
    expect(
      screen.getByText(
        "Your video wasn't started before ReelMakeEasy stopped. Picking up starts it now.",
      ),
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Start the video' })).toBeTruthy()
  })

  it('picks up once for a double click, and stays busy while it does', async () => {
    let done: ((ok: boolean) => void) | undefined
    const onResume = jest.fn(() => new Promise<boolean>((resolve) => (done = resolve)))
    render(<ResumeCard onResume={onResume} />)
    const button = screen.getByRole('button', { name: RESUME_BUTTON }) as HTMLButtonElement

    fireEvent.click(button)
    fireEvent.click(button)

    expect(onResume).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
    await act(async () => done?.(false))
    // Refused (the reason shows as a notice): the button works again.
    expect(button.disabled).toBe(false)
  })
})

describe('resumeWords', () => {
  it('the plain words for a chat that asks a card first, or when the API does not say', () => {
    const plain = { button: RESUME_BUTTON, line: RESUME_LINE }
    expect(resumeWords({ kind: 'carry_on' })).toEqual(plain)
    expect(resumeWords(undefined)).toEqual(plain)
    expect(RESUME_LINE).toBe(
      'ReelMakeEasy restarted before your video was made. Your answers are saved.',
    )
  })

  it('a loop whose card can no longer say its price still says it makes it now', () => {
    expect(resumeWords({ kind: 'make_loop' })).toEqual({
      button: 'Make it now',
      line: "Your loop wasn't started before ReelMakeEasy stopped. Picking up makes it now.",
    })
  })

  it('names the price as the card did, to the cent', () => {
    expect(resumeWords({ costUsd: 3, kind: 'make_loop' }).line).toBe(
      "Your loop wasn't started before ReelMakeEasy stopped. Picking up makes it now: about $3.00.",
    )
  })
})
