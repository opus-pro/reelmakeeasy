import { fireEvent, render, screen, within } from '@testing-library/react'

import { WelcomeCard } from './WelcomeCard'

function option(label: RegExp) {
  return screen.getByRole('button', { name: label }) as HTMLButtonElement
}

describe('WelcomeCard', () => {
  it('offers a tool picker, then Easy (Guided) and Advanced (Free chat) for the tool', () => {
    render(<WelcomeCard mode={null} onChoose={jest.fn(async () => true)} presetHarness="claude" />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual(['Short video', 'Ranking'])
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    const modes = within(screen.getByRole('tabpanel'))
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
    expect(modes).toHaveLength(2)
    expect(modes[0]).toMatch(/Easy \(Guided\).*Recommended/)
    expect(modes[1]).toMatch(/Advanced \(Free chat\)/)
    // The old third mode (Medium, Guided) is gone; "Guided" now describes Easy.
    expect(screen.queryByText(/Medium/)).toBeNull()
  })

  it("switches to Ranking's own Easy and Advanced", () => {
    const onChoose = jest.fn(async () => true)
    render(<WelcomeCard mode={null} onChoose={onChoose} presetHarness="claude" />)
    fireEvent.click(screen.getByRole('tab', { name: /Ranking/ }))
    expect(screen.getByText(/a YouTube Short to copy/)).toBeTruthy()
    fireEvent.click(option(/Easy \(Guided\)/))
    expect(onChoose).toHaveBeenCalledWith('ranking_easy')
  })

  it('shows the tool a link asks for first, and Advanced Ranking chooses the free Ranking chat', () => {
    const onChoose = jest.fn(async () => true)
    render(
      <WelcomeCard firstTool="ranking" mode={null} onChoose={onChoose} presetHarness="claude" />,
    )
    expect(screen.getByRole('tab', { name: /Ranking/ }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(option(/Advanced \(Free chat\)/))
    expect(onChoose).toHaveBeenCalledWith('ranking')
  })

  it("shows a chosen mode's tool, locked", () => {
    render(
      <WelcomeCard mode="ranking" onChoose={jest.fn(async () => true)} presetHarness="claude" />,
    )
    expect(screen.getByRole('tab', { name: /Ranking/ }).getAttribute('aria-selected')).toBe('true')
    expect((screen.getByRole('tab', { name: /Short video/ }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(option(/Advanced \(Free chat\)/).querySelector('[aria-label="Chosen"]')).toBeTruthy()
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
    expect(option(/Advanced \(Free chat\)/).querySelector('[aria-label="Chosen"]')).toBeTruthy()
  })
})
