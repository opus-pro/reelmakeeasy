import { fireEvent, render, screen, within } from '@testing-library/react'

import type { AgentStatusResponse } from '@shared/types/api/agent'

import { WelcomeCard } from './WelcomeCard'

function option(label: RegExp) {
  return screen.getByRole('button', { name: label }) as HTMLButtonElement
}

describe('WelcomeCard', () => {
  it('offers a tool picker, then Easy (Guided) and Advanced (Free chat) for the tool', () => {
    render(<WelcomeCard mode={null} onChoose={jest.fn(async () => true)} presetHarness="claude" />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Short video',
      'Ranking',
      'Motion Reel',
      'Claude Animation',
    ])
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

  it("offers Motion Reel's Easy (its setup card) and Advanced (the agent sets it up)", () => {
    const onChoose = jest.fn(async () => true)
    render(<WelcomeCard mode={null} onChoose={onChoose} presetHarness="claude" />)
    fireEvent.click(screen.getByRole('tab', { name: /Motion Reel/ }))
    const modes = within(screen.getByRole('tabpanel'))
      .getAllByRole('button')
      .map((b) => b.textContent ?? '')
    expect(modes).toHaveLength(2)
    expect(modes[0]).toMatch(/Easy \(Guided\).*Recommended.*one card/)
    expect(modes[1]).toMatch(/Advanced \(Free chat\).*Talk it through/)
    fireEvent.click(option(/Pick a style and the music on one card/))
    expect(onChoose).toHaveBeenCalledWith('motion')
  })

  it("chooses Motion Reel's Advanced, the free chat", () => {
    const onChoose = jest.fn(async () => true)
    render(
      <WelcomeCard firstTool="motion" mode={null} onChoose={onChoose} presetHarness="claude" />,
    )
    fireEvent.click(option(/Talk it through/))
    expect(onChoose).toHaveBeenCalledWith('motion_free')
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

  describe('Claude Animation', () => {
    const ready = { available: true, binary: '/bin/x', loggedIn: true, version: '1' }
    const status = (claude: object): AgentStatusResponse => ({
      ...ready,
      claude: { ...ready, ...claude },
      codex: ready,
      defaultHarness: 'codex',
    })

    it('offers its Easy (the look card) and Advanced, both run on Claude Code', () => {
      const onChoose = jest.fn(async () => true)
      render(<WelcomeCard mode={null} onChoose={onChoose} status={status({})} />)
      fireEvent.click(screen.getByRole('tab', { name: /Claude Animation/ }))
      const modes = within(screen.getByRole('tabpanel'))
        .getAllByRole('button')
        .map((b) => b.textContent ?? '')
      expect(modes[0]).toMatch(/Easy \(Guided\).*Recommended.*every frame in code: 2D, 3D or 8-bit.*No AI video model/)
      expect(modes[1]).toMatch(/Advanced \(Free chat\).*the story, the look, the music/)
      // No agent switch: it runs on Claude Code.
      expect(screen.queryByRole('radiogroup')).toBeNull()
      expect(screen.getByText(/Runs on Claude Code/)).toBeTruthy()
      fireEvent.click(option(/Easy \(Guided\)/))
      expect(onChoose).toHaveBeenCalledWith('animation', 'claude')
    })

    it('names Claude as the partner on its tab', () => {
      render(<WelcomeCard mode={null} onChoose={jest.fn(async () => true)} presetHarness="codex" />)
      expect(screen.getByText(/Codex is your creative partner/)).toBeTruthy()
      fireEvent.click(screen.getByRole('tab', { name: /Claude Animation/ }))
      expect(screen.getByText(/Claude is your creative partner/)).toBeTruthy()
    })

    it('runs on Claude Code even when the chat was opened on Codex', () => {
      const onChoose = jest.fn(async () => true)
      render(
        <WelcomeCard firstTool="animation" mode={null} onChoose={onChoose} presetHarness="codex" />,
      )
      fireEvent.click(option(/Advanced \(Free chat\)/))
      expect(onChoose).toHaveBeenCalledWith('animation_free', 'claude')
    })

    it('is disabled, saying why, when Claude Code is signed out', () => {
      render(
        <WelcomeCard
          firstTool="animation"
          mode={null}
          onChoose={jest.fn(async () => true)}
          status={status({ available: false, loggedIn: false, reason: 'not-logged-in' })}
        />,
      )
      expect(option(/Easy \(Guided\)/).disabled).toBe(true)
      expect(option(/Advanced \(Free chat\)/).disabled).toBe(true)
      expect(screen.getByText('Sign in to Claude Code: run claude login in a terminal')).toBeTruthy()
    })

    it('is disabled when Claude Code is not installed', () => {
      render(
        <WelcomeCard
          firstTool="animation"
          mode={null}
          onChoose={jest.fn(async () => true)}
          status={status({ available: false, binary: null, reason: 'not-found' })}
        />,
      )
      expect(option(/Easy \(Guided\)/).disabled).toBe(true)
      expect(screen.getByText('Install Claude Code to use it here')).toBeTruthy()
    })
  })

  it('tags Short video as made with AI video models', () => {
    render(<WelcomeCard mode={null} onChoose={jest.fn(async () => true)} presetHarness="claude" />)
    expect(option(/Easy \(Guided\)/).textContent).toMatch(/Made with AI video models\.$/)
  })
})
