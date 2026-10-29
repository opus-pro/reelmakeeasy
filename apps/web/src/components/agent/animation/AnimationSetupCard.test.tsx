import { fireEvent, render, screen } from '@testing-library/react'
import type { AgentAnimationOptions } from '@shared/types/api/agent'

import { AnimationSetupCard } from './AnimationSetupCard'
import { useAnimationOptions } from './useAnimationOptions'

jest.mock('./useAnimationOptions', () => ({ useAnimationOptions: jest.fn() }))
jest.mock('./AvatarVoice', () => ({ AvatarVoice: () => null }))
// The avatar creator: "Make Ana" stands in for Claude making and saving one.
jest.mock('./AvatarCreator', () => ({
  AvatarCreator: ({ onCreated, styles }: { onCreated: (a: object) => void; styles: string[] }) => (
    <button
      onClick={() =>
        onCreated({
          createdAt: '2026-10-29T00:00:00Z',
          id: 'av-00000000aa',
          look: '',
          name: 'Ana',
          previewUrl: null,
          style: styles[0],
          voiceDescription: '',
          voiceId: null,
          voiceSampleUrl: null,
        })
      }
      type="button"
    >
      Make Ana ({styles.join(' ')})
    </button>
  ),
}))
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
      withAvatar: {
        avatarStyles: ['2d', '3d', 'pixel'],
        description: 'Your avatar hosts it as a 2D cartoon.',
        previewUrl: '/api/presets/animation/looks/avatar.mp4',
      },
    },
    {
      defaultLengthSec: 30,
      defaultTrackId: 'dark-precision',
      description: 'A 3D scene shows how something works, with a narrator.',
      id: '3d',
      label: '3D',
      lengths: [15, 30, 45, 60, 90],
      previewUrl: '/api/presets/animation/looks/3d.mp4',
      withAvatar: {
        avatarStyles: ['3d', '2d', 'pixel'],
        description: 'Your avatar hosts it as a 3D figure.',
        previewUrl: null,
      },
    },
    {
      defaultLengthSec: 30,
      defaultTrackId: 'neon-drive',
      description: 'Pixel art, like an old video game, with a narrator.',
      id: '8bit',
      label: 'Pixel art',
      lengths: [15, 30, 45, 60, 90],
      previewUrl: null,
      withAvatar: {
        avatarStyles: ['pixel', '2d', '3d'],
        description: 'Your avatar hosts it in pixel art.',
        previewUrl: null,
      },
    },
    {
      defaultLengthSec: 30,
      defaultTrackId: 'data-pulse',
      description: 'Your own avatar talks to the camera, waist up, with gestures.',
      id: 'avatar',
      label: 'Avatar explainer',
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
      detail: 'xhigh',
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

  it('sends the detail picked on its slider, Extra high (recommended) until then', () => {
    const onSubmit = renderCard()
    const detail = screen.getByRole('slider', { name: 'Detail' })
    expect(detail.getAttribute('aria-valuetext')).toBe('Extra high')
    expect(screen.getByText('Recommended')).toBeTruthy()
    fireEvent.change(detail, { target: { value: '1' } })
    expect(detail.getAttribute('aria-valuetext')).toBe('Medium')
    expect(screen.getByText(/^Polished:/)).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: "What's it about?" }), {
      target: { value: 'rain' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Build it' }))
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ detail: 'medium' }))
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
            detail: 'high',
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
    expect(screen.getByText('High detail')).toBeTruthy()
    expect(screen.getByText('No music')).toBeTruthy()
  })

  describe('an Avatar explainer', () => {
    const subject = () =>
      fireEvent.change(screen.getByRole('textbox', { name: "What's it about?" }), {
        target: { value: 'Why we yawn' },
      })
    const explainer = () => screen.getByRole('checkbox', { name: /Avatar explainer/ })
    const saved = (id: string, name: string, style: '2d' | '3d') => ({
      createdAt: '2026-10-27T00:00:00Z',
      id,
      look: '',
      name,
      previewUrl: '/p.png',
      style,
      voiceDescription: 'warm',
      voiceId: 'kokoro-am_michael',
      voiceSampleUrl: null,
    })
    const avatars = [saved('av-0000000002', 'Sam', '2d'), saved('av-0000000003', 'Max', '3d')]

    it('offers three styles, and with the avatar ticked sends the avatar look in that style', () => {
      const onSubmit = renderCard({ ...OPTIONS, avatars })
      expect(screen.getAllByRole('radio', { name: /^(2D|3D|Pixel art)$/ })).toHaveLength(3)
      expect(screen.queryByRole('radio', { name: 'Avatar explainer' })).toBeNull()
      fireEvent.click(explainer())
      // The style tiles switch to their avatar versions.
      expect(
        document.querySelector('video[src="/api/presets/animation/looks/avatar.mp4"]'),
      ).toBeTruthy()
      expect(screen.getByText('Your avatar hosts it as a 2D cartoon.')).toBeTruthy()
      expect(screen.getByRole('radio', { name: 'Sam (2D)' }).getAttribute('aria-checked')).toBe(
        'true',
      )
      subject()
      fireEvent.click(screen.getByRole('button', { name: 'Build it' }))
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          avatar: { id: 'av-0000000002' },
          lookId: 'avatar',
          stage: '2d',
        }),
      )
    })

    it('shows every avatar for every style: the avatar and the world are separate', () => {
      renderCard({ ...OPTIONS, avatars })
      fireEvent.click(explainer())
      const names = () =>
        screen
          .getAllByRole('radio', { name: /\((2D|3D|Pixel art)\)$/ })
          .map((r) => r.getAttribute('aria-label'))
      expect(names()).toEqual(['Sam (2D)', 'Max (3D)'])
      fireEvent.click(look(/^3D$/))
      expect(names()).toEqual(['Sam (2D)', 'Max (3D)'])
      // The pick stays: a 2D avatar can host a 3D world.
      expect(screen.getByRole('radio', { name: 'Sam (2D)' }).getAttribute('aria-checked')).toBe(
        'true',
      )
    })

    it('opens the avatar creator from New avatar, and picks the avatar it makes', () => {
      const onSubmit = renderCard()
      fireEvent.click(explainer())
      // No avatar yet: the card waits for one.
      expect(screen.getByText('No avatar yet: make one with New avatar.')).toBeTruthy()
      subject()
      expect((screen.getByRole('button', { name: 'Build it' }) as HTMLButtonElement).disabled).toBe(
        true,
      )
      screen.getByText('Pick an avatar, or make one with New avatar.')
      fireEvent.click(look(/^Pixel art$/))
      fireEvent.click(screen.getByRole('button', { name: 'New avatar' }))
      // The creator offers the styles the video's style takes.
      fireEvent.click(screen.getByRole('button', { name: 'Make Ana (pixel 2d 3d)' }))
      expect(
        screen.getByRole('radio', { name: 'Ana (Pixel art)' }).getAttribute('aria-checked'),
      ).toBe('true')
      fireEvent.click(screen.getByRole('button', { name: 'Build it' }))
      expect(onSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          avatar: { id: 'av-00000000aa' },
          lookId: 'avatar',
          stage: '8bit',
        }),
      )
    })

    it("lets 2D be picked with the avatar even when its characters' voices can't be made", () => {
      renderCard({
        ...OPTIONS,
        avatars,
        looks: OPTIONS.looks.map((l) =>
          l.id === '2d' ? { ...l, disabledReason: 'Needs Qwen3 voices.' } : l,
        ),
      })
      expect(look(/^2D$/).disabled).toBe(true)
      fireEvent.click(explainer())
      expect(look(/^2D$/).disabled).toBe(false)
    })
  })
})
