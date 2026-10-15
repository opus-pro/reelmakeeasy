import type { SetupStatus } from '@shared/types/api/setup'
import { fireEvent, render, screen } from '@testing-library/react'

jest.mock('@shared/ui', () => {
  const mockReact = jest.requireActual('react')
  return {
    Button: ({
      children,
      disabled,
      loading,
      onClick,
    }: {
      children: unknown
      disabled?: boolean
      loading?: boolean
      onClick?: () => void
    }) =>
      mockReact.createElement(
        'button',
        { disabled: Boolean(disabled || loading), onClick, type: 'button' },
        children,
      ),
    cn: (...parts: unknown[]) => parts.filter(Boolean).join(' '),
  }
})

import { CHECK_FAILED, NO_VIDEO_KEY, NO_WRITER } from './setup-status'
import { ready, setupStatus } from './setup-status.fixtures'
import { SetupCard } from './SetupCard'
import type { SetupStatusState } from './useSetupStatus'

function cardState(
  status: null | SetupStatus,
  over: Partial<SetupStatusState> = {},
): SetupStatusState {
  return {
    error: null,
    loading: false,
    recheck: jest.fn(async () => undefined),
    save: jest.fn(async () => true),
    saving: false,
    status,
    ...over,
  }
}

describe('SetupCard', () => {
  it('with only fal and Claude Code: ElevenLabs runs through fal, and Save stores Claude Code', () => {
    const state = cardState(setupStatus({ claude: ready, fal: true }))
    render(<SetupCard state={state} />)
    expect(screen.getByText('Through fal')).toBeTruthy()
    expect(screen.getByText('✓ Ready')).toBeTruthy()
    expect(screen.getByRole('radio', { name: /Claude Code/ }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(screen.queryByText('Who makes the pictures, clips and voice?')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(state.save).toHaveBeenCalledWith({ llm: 'claude' })
  })

  it('with fal and Gemini: asks who makes the videos, and saves the pick', () => {
    const state = cardState(setupStatus({ claude: ready, fal: true, gemini: true }))
    render(<SetupCard state={state} />)
    expect(screen.getByText('Who makes the pictures, clips and voice?')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /Uses your Gemini key/ }))
    expect(screen.getByText('Not needed')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(state.save).toHaveBeenCalledWith({ generation: 'google', llm: 'claude' })
  })

  it('with no keys and no agents: says what to add, and Save stays off', () => {
    render(<SetupCard state={cardState(setupStatus())} />)
    expect(screen.getByText(NO_VIDEO_KEY)).toBeTruthy()
    expect(screen.getByText(NO_WRITER)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Check again reads the status again', () => {
    const state = cardState(setupStatus({ fal: true }))
    render(<SetupCard state={state} />)
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }))
    expect(state.recheck).toHaveBeenCalled()
  })

  it('shows why a check failed', () => {
    render(<SetupCard state={cardState(null, { error: CHECK_FAILED })} />)
    expect(screen.getByText(CHECK_FAILED)).toBeTruthy()
  })
})
