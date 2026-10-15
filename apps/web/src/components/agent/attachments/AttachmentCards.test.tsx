import { fireEvent, render, screen } from '@testing-library/react'

import {
  attachmentUrl,
  fileKind,
  PendingAttachmentCards,
  SentAttachmentCards,
} from './AttachmentCards'
import type { PendingAttachment } from './attachments'

jest.mock('jotai', () => ({
  ...jest.requireActual('jotai'),
  useAtomValue: () => 'http://localhost:5017',
}))

const pending = (patch: Partial<PendingAttachment>): PendingAttachment => ({
  file: new File(['abc'], 'song.mp3', { type: 'audio/mpeg' }),
  id: 'a1',
  previewUrl: 'blob:song',
  status: 'ready',
  ...patch,
})

describe('attachment cards', () => {
  it('shows every file as the same square tile: a picture whole, else its name and size', () => {
    const onRemove = jest.fn()
    render(
      <PendingAttachmentCards
        items={[
          pending({
            file: new File(['png'], 'shot.png', { type: 'image/png' }),
            id: 'img',
            previewUrl: 'blob:shot',
          }),
          pending({ id: 'mp3' }),
        ]}
        onRemove={onRemove}
      />,
    )
    const picture = screen.getByAltText('shot.png')
    expect(picture.getAttribute('src')).toBe('blob:shot')
    expect(picture.className).toContain('object-contain')
    const tiles = screen.getAllByRole('button', { name: /^Open / })
    expect(tiles.map((t) => t.className.includes('size-20'))).toEqual([true, true])
    expect(screen.getByText('song.mp3')).toBeTruthy()
    expect(screen.getByText('3 B')).toBeTruthy()
    fireEvent.click(screen.getByLabelText('Remove song.mp3'))
    expect(onRemove).toHaveBeenCalledWith('mp3')
  })

  it('says why a file failed, and it does not open', () => {
    render(
      <PendingAttachmentCards
        items={[pending({ error: 'Too big (300.0 MB)', status: 'error' })]}
        onRemove={jest.fn()}
      />,
    )
    expect(screen.getByText('Too big (300.0 MB)')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Open song.mp3' }).hasAttribute('disabled')).toBe(
      true,
    )
  })

  it('opens a sent file in the viewer: a sound file plays, a picture is shown large', () => {
    render(
      <SentAttachmentCards
        attachments={[
          { kind: 'image', name: 'shot-a1.png', path: '/w/attachments/shot-a1.png', size: 10 },
          { kind: 'audio', name: 'um-b2.mp3', path: '/w/attachments/um-b2.mp3', size: 2048 },
        ]}
        sessionId="s1"
      />,
    )
    const served = 'http://localhost:5017/api/agent/sessions/s1/attachments/'
    expect(screen.getByAltText('shot-a1.png').getAttribute('src')).toBe(`${served}shot-a1.png`)

    fireEvent.click(screen.getByRole('button', { name: 'Open um-b2.mp3' }))
    const audio = document.querySelector('audio')
    expect(audio?.getAttribute('src')).toBe(`${served}um-b2.mp3`)
    expect(screen.getByText('/w/attachments/um-b2.mp3')).toBeTruthy()
  })

  it('tells kinds apart by type, else by extension, and builds the served URL', () => {
    expect(fileKind({ name: 'clip.mov', type: '' })).toBe('video')
    expect(fileKind({ name: 'x', type: 'audio/wav' })).toBe('audio')
    expect(fileKind({ name: 'notes.pdf', type: 'application/pdf' })).toBe('file')
    expect(attachmentUrl('http://localhost:5017', 's 1', 'a b.png')).toBe(
      'http://localhost:5017/api/agent/sessions/s%201/attachments/a%20b.png',
    )
  })
})
