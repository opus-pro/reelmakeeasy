import { fireEvent, render, screen } from '@testing-library/react'
import type { AgentAnimationOptions } from '@shared/types/api/agent'

import { AnimationSetupCard } from './AnimationSetupCard'
import { useAnimationOptions } from './useAnimationOptions'

jest.mock('./useAnimationOptions', () => ({ useAnimationOptions: jest.fn() }))
jest.mock('jotai', () => ({ ...jest.requireActual('jotai'), useAtomValue: () => '' }))
jest.mock('../attachments/attachments', () => ({
  ...jest.requireActual('../attachments/attachments'),
  uploadAttachment: jest.fn(async (_o: string, _s: string, _f: File, name: string) => ({
    kind: 'image',
    name,
    path: `/w/attachments/${name}`,
    size: 3,
  })),
}))

const OPTIONS: AgentAnimationOptions = {
  avatars: [],
  composers: [
    { cost: 'Free', description: 'Claude writes it', id: 'composer', label: 'Composed by Claude' },
    { cost: '$0.60 a minute', description: 'Rich', id: 'eleven-music', label: 'ElevenLabs Music' },
    { cost: 'about $0.01', description: 'Quick', id: 'ace-step', label: 'ACE-Step' },
  ],
  maxLengthSec: 90,
  minLengthSec: 10,
  looks: [
    {
      defaultLengthSec: 30,
      defaultTrackId: 'data-pulse',
      description: 'Cartoon characters talk you through it, with voices and lip sync.',
      id: '2d',
      label: '2D',
      lengths: [15, 30, 45, 60, 90],
      previewUrl: null,
    },
    {
      defaultLengthSec: 30,
      defaultTrackId: 'dark-precision',
      description: 'A 3D scene shows how something works, with a narrator.',
      id: '3d',
      label: '3D',
      lengths: [15, 30, 45, 60, 90],
      previewUrl: '/api/presets/animation/looks/3d.mp4',
    },
    {
      defaultLengthSec: 30,
      defaultTrackId: 'neon-drive',
      description: 'Pixel art, like an old video game, with a narrator.',
      id: '8bit',
      label: '8-bit',
      lengths: [15, 30, 45, 60, 90],
      previewUrl: null,
    },
    {
      defaultLengthSec: 30,
      defaultTrackId: 'data-pulse',
      description: 'Your own avatar talks to the camera, waist up, with gestures.',
      id: 'avatar',
      label: 'Avatar',
      lengths: [15, 30, 45, 60, 90],
      previewUrl: null,
    },
  ],
  tracks: [
    { bpm: 90, id: 'data-pulse', previewUrl: '/a.mp3', title: 'Data Pulse' },
    { bpm: 96, id: 'dark-precision', previewUrl: '/b.mp3', title: 'Dark Precision' },
    { bpm: 120, id: 'neon-drive', previewUrl: '/c.mp3', title: 'Neon Drive' },
  ],
}

const open = { id: 'animation-setup-1', kind: 'animation_setup' as const, state: 'open' as const }

function renderCard(options: AgentAnimationOptions = OPTIONS) {
  jest.mocked(useAnimationOptions).mockReturnValue({ error: false, options, retry: jest.fn() })
  const onSubmit = jest.fn(async () => true)
  render(<AnimationSetupCard entry={open} onSubmit={onSubmit} sessionId="s1" />)
  return onSubmit
}

const look = (name: RegExp) => screen.getByRole('radio', { name }) as HTMLButtonElement

describe('AnimationSetupCard', () => {
  it('sends the look, length, music and subject', () => {
    const onSubmit = renderCard()
    fireEvent.click(look(/3D/))
    fireEvent.click(screen.getByRole('radio', { name: '45 s' }))
    fireEvent.change(screen.getByRole('textbox', { name: "What's it about?" }), {
      target: { value: '  black holes  ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }))
    expect(onSubmit).toHaveBeenCalledWith({
      lengthSec: 45,
      lookId: '3d',
      music: { id: 'dark-precision', source: 'library' },
      subject: 'black holes',
    })
  })

  it('shows Surprise me as a toggle chip, on and off', () => {
    renderCard()
    const surprise = screen.getByRole('checkbox', { name: /Surprise me/ })
    expect(surprise.tagName).toBe('BUTTON')
    expect(surprise.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(surprise)
    expect(surprise.getAttribute('aria-checked')).toBe('true')
  })

  it('sends no subject for Surprise me', () => {
    const onSubmit = renderCard()
    fireEvent.click(screen.getByRole('checkbox', { name: /Surprise me/ }))
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ lookId: '2d', subject: null }))
  })

  it('waits for what it is about', () => {
    renderCard()
    expect((screen.getByRole('button', { name: 'Build it' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.getByText(/Say what it's about, or pick Surprise me/)).toBeTruthy()
  })

  it('offers 15 to 90 s for every look, and a length of your own', () => {
    const onSubmit = renderCard()
    expect(screen.getAllByRole('radio', { name: /^\d+ s$/ }).map((r) => r.textContent)).toEqual([
      '15 s',
      '30 s',
      '45 s',
      '60 s',
      '90 s',
    ])
    fireEvent.change(screen.getByRole('textbox', { name: "What's it about?" }), {
      target: { value: 'rain' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Custom length in seconds' }), {
      target: { value: '75' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ lengthSec: 75 }))
  })

  it('refuses a custom length outside 10 to 90 s', () => {
    renderCard()
    fireEvent.change(screen.getByRole('textbox', { name: "What's it about?" }), {
      target: { value: 'rain' },
    })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Custom length in seconds' }), {
      target: { value: '120' },
    })
    expect((screen.getByRole('button', { name: 'Build it' }) as HTMLButtonElement).disabled).toBe(
      true,
    )
    expect(screen.getByText('Pick a length from 10 to 90 seconds.')).toBeTruthy()
  })

  it('plays a look preview when there is one', () => {
    renderCard()
    expect(document.querySelector('video[src="/api/presets/animation/looks/3d.mp4"]')).toBeTruthy()
  })

  it('shows why a look is unavailable and starts on one that is', () => {
    const onSubmit = renderCard({
      ...OPTIONS,
      looks: OPTIONS.looks.map((l) =>
        l.id === '2d'
          ? { ...l, disabledReason: 'Needs Qwen3 voices on this computer or a fal key.' }
          : l,
      ),
    })
    expect(look(/2D/).disabled).toBe(true)
    expect(screen.getByText('Needs Qwen3 voices on this computer or a fal key.')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'volcanoes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ lookId: '3d' }))
  })

  it('shows what was chosen once it is sent', () => {
    jest
      .mocked(useAnimationOptions)
      .mockReturnValue({ error: false, options: OPTIONS, retry: jest.fn() })
    render(
      <AnimationSetupCard
        entry={{
          ...open,
          setup: {
            lengthSec: 30,
            lookId: '2d',
            lookLabel: '2D',
            music: { source: 'none' },
            musicTitle: null,
            subject: null,
          },
          state: 'chosen',
        }}
        onSubmit={jest.fn()}
        sessionId="s1"
      />,
    )
    expect(screen.getByText('Claude Animation')).toBeTruthy()
    expect(screen.getByText('A fun fact Claude picks')).toBeTruthy()
    expect(screen.getByText('2D')).toBeTruthy()
    expect(screen.getByText('30 s')).toBeTruthy()
    expect(screen.getByText('No music')).toBeTruthy()
  })

  describe('an Avatar video', () => {
    const subject = () =>
      fireEvent.change(screen.getByRole('textbox', { name: "What's it about?" }), {
        target: { value: 'Why we yawn' },
      })

    it('picks the newest saved avatar and sends it', () => {
      const onSubmit = renderCard({
        ...OPTIONS,
        avatars: [
          {
            createdAt: '2026-10-27T00:00:00Z',
            id: 'av-0123456789',
            name: 'Sam',
            previewUrl: '/p.png',
            style: '2d',
          },
        ],
      })
      fireEvent.click(look(/^Avatar$/))
      expect(screen.getByRole('radio', { name: 'Sam (2D)' }).getAttribute('aria-checked')).toBe(
        'true',
      )
      subject()
      fireEvent.click(screen.getByRole('button', { name: 'Build it' }))
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({ avatar: { id: 'av-0123456789' }, lookId: 'avatar' }),
      )
    })

    it('makes a new avatar only with a photo and a name', async () => {
      global.URL.createObjectURL = jest.fn(() => 'blob:photo')
      global.URL.revokeObjectURL = jest.fn()
      const onSubmit = renderCard()
      fireEvent.click(look(/^Avatar$/))
      subject()
      expect((screen.getByRole('button', { name: 'Build it' }) as HTMLButtonElement).disabled).toBe(
        true,
      )
      screen.getByText('Add a photo and a name for the new avatar.')
      const photo = new File(['abc'], 'me.jpg', { type: 'image/jpeg' })
      fireEvent.change(screen.getByLabelText('Photo for the avatar'), {
        target: { files: [photo] },
      })
      await screen.findByAltText('The photo to draw the avatar from')
      fireEvent.change(screen.getByPlaceholderText('e.g. Sam'), { target: { value: ' Ana ' } })
      fireEvent.click(screen.getByRole('radio', { name: '3D figure' }))
      fireEvent.click(screen.getByRole('button', { name: 'Build it' }))
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          avatar: { name: 'Ana', photo: 'me.jpg', style: '3d' },
          lookId: 'avatar',
        }),
      )
    })
  })
})
