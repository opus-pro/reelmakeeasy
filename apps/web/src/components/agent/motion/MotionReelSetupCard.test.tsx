import type { AgentMotionOptions, AgentMotionSetupView } from '@shared/types/api/agent'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'

import { MotionReelSetupCard } from './MotionReelSetupCard'

const OPTIONS: AgentMotionOptions = {
  composers: [
    { cost: 'free', description: 'Note by note.', id: 'composer', label: 'Composed by the agent' },
  ],
  defaultLengthSec: 15,
  defaultRatio: '16:9',
  lengths: [10, 15, 30, 60],
  ratios: ['16:9', '9:16', '1:1'],
  tracks: [{ bpm: 128, id: 'pulse-drive', previewUrl: '/pulse.mp3', title: 'Pulse Drive' }],
  types: [
    {
      description: 'Make one product memorable: show it working.',
      id: 'launch',
      label: 'Product launch',
    },
    {
      description: 'Pure show-off motion that looks super cool.',
      id: 'showreel',
      label: 'Motion reel',
    },
  ],
}

jest.mock('./useMotionReelOptions', () => ({
  useMotionReelOptions: () => ({ error: false, options: OPTIONS, retry: () => undefined }),
}))

describe('MotionReelSetupCard', () => {
  // jsdom can't load the track preview.
  beforeAll(() =>
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined),
  )
  it('offers the two kinds of reel, each a label and one line, the launch picked first', () => {
    render(
      <MotionReelSetupCard
        entry={{ id: 'm1', kind: 'motion_setup', state: 'open' }}
        onSubmit={jest.fn()}
        sessionId="s1"
      />,
    )
    const radios = screen.getAllByRole('radio', { name: /Product launch|Motion reel/ })
    expect(radios.map((r) => r.textContent)).toEqual([
      'Product launchMake one product memorable: show it working.',
      'Motion reelPure show-off motion that looks super cool.',
    ])
    expect(radios.map((r) => r.getAttribute('aria-checked'))).toEqual(['true', 'false'])
    // No style picker, thumbnails or palettes: the agent decides the look.
    expect(screen.queryByText('Style')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })

  it('has a neutral placeholder and examples that fill the box, with the type and length they name', async () => {
    const onSubmit = jest.fn().mockResolvedValue(true)
    render(
      <MotionReelSetupCard
        entry={{ id: 'm1', kind: 'motion_setup', state: 'open' }}
        onSubmit={onSubmit}
        sessionId="s1"
      />,
    )
    const box = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(box.placeholder).toBe('Describe your reel…')
    const examples = within(screen.getByRole('group', { name: 'Examples' })).getAllByRole('button')
    expect(examples.length).toBeGreaterThanOrEqual(2)
    expect(examples.length).toBeLessThanOrEqual(3)

    fireEvent.change(box, { target: { value: 'something typed' } })
    fireEvent.click(screen.getByRole('button', { name: 'About yourself, Claude' }))
    // A click replaces the text.
    expect(box.value).toBe('Make a 15-second motion reel about yourself, Claude')
    expect(screen.getByRole('radio', { name: /Motion reel/ }).getAttribute('aria-checked')).toBe(
      'true',
    )

    fireEvent.click(screen.getByRole('button', { name: 'A ReelMakeEasy launch' }))
    expect(box.value).toBe(
      'A 30-second product launch for ReelMakeEasy: make shorts on your own computer',
    )
    expect(screen.getByRole('radio', { name: /Product launch/ }).getAttribute('aria-checked')).toBe(
      'true',
    )
    expect(screen.getByRole('radio', { name: '30 s' }).getAttribute('aria-checked')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: 'Build my reel' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toMatchObject({
      lengthSec: 30,
      subject: 'A 30-second product launch for ReelMakeEasy: make shorts on your own computer',
      type: 'launch',
    })
  })

  it('sends the picked type, and no style', async () => {
    const onSubmit = jest.fn().mockResolvedValue(true)
    render(
      <MotionReelSetupCard
        entry={{ id: 'm1', kind: 'motion_setup', state: 'open' }}
        onSubmit={onSubmit}
        sessionId="s1"
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: /Motion reel/ }))
    expect(screen.getByRole('radio', { name: /Motion reel/ }).getAttribute('aria-checked')).toBe(
      'true',
    )
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '  ReelMakeEasy  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Build my reel' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0]).toEqual({
      detail: 'xhigh',
      lengthSec: 15,
      music: { id: 'pulse-drive', source: 'library' },
      ratio: '16:9',
      subject: 'ReelMakeEasy',
      type: 'showreel',
    })
  })

  it('shows the chosen setup with its type label', () => {
    const setup: AgentMotionSetupView = {
      bars: 8,
      bpm: 128,
      lengthSec: 15,
      music: { source: 'none' },
      musicTitle: null,
      ratio: '16:9',
      reelSec: 15,
      subject: 'ReelMakeEasy',
      type: 'launch',
      typeLabel: 'Product launch',
    }
    render(
      <MotionReelSetupCard
        entry={{ id: 'm1', kind: 'motion_setup', setup, state: 'chosen' }}
        onSubmit={jest.fn()}
        sessionId="s1"
      />,
    )
    expect(screen.getByText('Product launch').textContent).toBe('Product launch')
  })
})
