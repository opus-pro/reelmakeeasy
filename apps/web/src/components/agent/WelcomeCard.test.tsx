import { fireEvent, render, screen } from '@testing-library/react'

import { WelcomeCard } from './WelcomeCard'

function option(label: RegExp) {
  return screen.getByRole('button', { name: label }) as HTMLButtonElement
}

describe('WelcomeCard', () => {
  it('offers Easy (Guided) and Advanced (Free chat), then Motion Reel below a line', () => {
    render(<WelcomeCard mode={null} onChoose={jest.fn(async () => true)} presetHarness="claude" />)
    const labels = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(labels).toHaveLength(3)
    expect(labels[0]).toMatch(/Easy \(Guided\)/)
    expect(labels[1]).toMatch(/Advanced \(Free chat\)/)
    expect(labels[2]).toMatch(/Motion Reel/)
    expect(screen.getByRole('separator')).toBeTruthy()
    // The old third mode (Medium · Guided) is gone; "Guided" now describes Easy.
    expect(screen.queryByText(/Medium/)).toBeNull()
  })

  it('chooses Motion Reel like the other modes', async () => {
    const onChoose = jest.fn(async () => true)
    render(<WelcomeCard mode={null} onChoose={onChoose} presetHarness="claude" />)
    fireEvent.click(option(/Motion Reel/))
    expect(onChoose).toHaveBeenCalledWith('motion')
  })

  it('locks while the page starts Easy for the user (from the first-video prompt)', () => {
    const onChoose = jest.fn(async () => true)
    render(
      <WelcomeCard
        mode={null}
        onChoose={onChoose}
        presetHarness="claude"
        startingMode="autonomous"
      />,
    )
    expect(option(/Easy \(Guided\)/).disabled).toBe(true)
    fireEvent.click(option(/Advanced \(Free chat\)/))
    expect(onChoose).not.toHaveBeenCalled()
  })

  it('without a mode being started, a click chooses', () => {
    const onChoose = jest.fn(async () => true)
    render(<WelcomeCard mode={null} onChoose={onChoose} presetHarness="claude" />)
    fireEvent.click(option(/Advanced \(Free chat\)/))
    expect(onChoose).toHaveBeenCalledWith('free')
  })

  it('marks a Free chat as chosen (also one first saved in Guided mode)', () => {
    render(<WelcomeCard mode="free" onChoose={jest.fn(async () => true)} presetHarness="claude" />)
    expect(option(/Advanced \(Free chat\)/).textContent).toContain('✓')
  })
})
