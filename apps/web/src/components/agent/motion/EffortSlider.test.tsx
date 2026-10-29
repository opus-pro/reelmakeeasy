import type { ChatModelState } from '@shared/types/api/agent'
import { fireEvent, render, screen } from '@testing-library/react'

import { type ChatModel, ChatModelProvider } from '../models/useChatModel'

import { EffortSlider } from './setup-parts'

const STATE: ChatModelState = {
  current: { effort: 'xhigh', model: 'claude-opus-5-5' },
  default: null,
  harness: 'claude',
  models: [{ efforts: ['medium', 'high', 'xhigh'], id: 'claude-opus-5-5', label: 'Opus 5.5' }],
  recommended: { effort: 'xhigh', model: 'claude-opus-5-5' },
  source: 'recommended',
}

const chatModel = (state: ChatModelState | null, pick = jest.fn()): ChatModel => ({
  busy: false,
  error: null,
  pick,
  refresh: jest.fn(),
  setDefault: jest.fn(),
  state,
})

const renderSlider = (model: ChatModel | null) =>
  render(
    <ChatModelProvider value={model}>
      <EffortSlider />
    </ChatModelProvider>,
  )

describe('EffortSlider', () => {
  it("shows the chat's level, recommended, from Faster to Extra high", () => {
    renderSlider(chatModel(STATE))
    const slider = screen.getByRole('slider', { name: 'Effort' })
    expect(slider.getAttribute('aria-valuetext')).toBe('Extra high')
    expect((slider as HTMLInputElement).value).toBe('2')
    expect(screen.getByText('Recommended')).toBeTruthy()
    expect(screen.getByText('Faster')).toBeTruthy()
    expect(screen.getByText(/Claude thinks hardest before each step/)).toBeTruthy()
  })

  it("sets the chat's model to the level picked, shown at once", () => {
    const pick = jest.fn().mockResolvedValue(undefined)
    renderSlider(chatModel(STATE, pick))
    const slider = screen.getByRole('slider', { name: 'Effort' })
    fireEvent.change(slider, { target: { value: '0' } })
    expect(pick).toHaveBeenCalledWith({ effort: 'medium', model: 'claude-opus-5-5' })
    expect(slider.getAttribute('aria-valuetext')).toBe('Medium')
    expect(screen.queryByText('Recommended')).toBeNull()
    expect(screen.getByText(/Claude thinks briefly before each step/)).toBeTruthy()
  })

  it('shows nothing before the model list loads, or outside a chat', () => {
    expect(renderSlider(chatModel(null)).container.textContent).toBe('')
    expect(renderSlider(null).container.textContent).toBe('')
  })
})
