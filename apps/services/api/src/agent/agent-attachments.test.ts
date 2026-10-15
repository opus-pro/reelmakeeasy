import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  attachmentFileName,
  attachmentKind,
  messageWithAttachments,
  modelImageType,
  resolveAttachment,
  turnInput,
} from './agent-attachments'

describe('agent attachments', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-attach-'))
  })
  afterEach(() => fs.rmSync(dir, { force: true, recursive: true }))

  it('saves under a safe, unique name that keeps the extension', () => {
    expect(attachmentFileName('Screen Shot 2026.png', 'a1b2c3')).toBe('Screen-Shot-2026-a1b2c3.png')
    expect(attachmentFileName('../../etc/passwd', 'a1b2c3')).toBe('passwd-a1b2c3')
    expect(attachmentFileName(String.raw`..\evil\clip.MP4`, 'a1b2c3')).toBe('clip-a1b2c3.mp4')
    expect(attachmentFileName('.env', 'a1b2c3')).toBe('env-a1b2c3')
    expect(attachmentFileName('', 'a1b2c3')).toBe('file-a1b2c3')
    expect(attachmentFileName('a.png')).not.toBe(attachmentFileName('a.png'))
  })

  it('tells pictures, sound and video apart by extension', () => {
    expect(['x.PNG', 'x.mp3', 'x.mov', 'x.pdf'].map(attachmentKind)).toEqual([
      'image',
      'audio',
      'video',
      'file',
    ])
    expect(modelImageType('x.jpg')).toBe('image/jpeg')
    expect(modelImageType('x.heic')).toBeNull()
  })

  it('finds only a plain file saved in the folder', () => {
    fs.writeFileSync(path.join(dir, 'song-a1.mp3'), 'abc')
    fs.writeFileSync(path.join(dir, '.hidden'), 'x')
    fs.mkdirSync(path.join(dir, 'sub'))
    const outside = path.join(os.tmpdir(), `outside-${process.pid}.txt`)
    fs.writeFileSync(outside, 'secret')
    fs.symlinkSync(outside, path.join(dir, 'link.txt'))
    try {
      expect(resolveAttachment(dir, 'song-a1.mp3')).toEqual({
        kind: 'audio',
        name: 'song-a1.mp3',
        path: fs.realpathSync(path.join(dir, 'song-a1.mp3')),
        size: 3,
      })
      for (const bad of ['../song-a1.mp3', 'sub', '.hidden', 'link.txt', 'missing.png', '', 42])
        expect(resolveAttachment(dir, bad)).toBeNull()
    } finally {
      fs.rmSync(outside, { force: true })
    }
  })

  it("lists the files' paths after the text, and sends pictures the model can take", () => {
    const image = {
      kind: 'image' as const,
      name: 'a.png',
      path: '/w/attachments/a.png',
      size: 2048,
    }
    const song = {
      kind: 'audio' as const,
      name: 'b.mp3',
      path: '/w/attachments/b.mp3',
      size: 3_145_728,
    }
    const heic = { kind: 'image' as const, name: 'c.heic', path: '/w/attachments/c.heic', size: 10 }
    expect(messageWithAttachments('Use these', [image, song])).toBe(
      'Use these\n\nThe user attached these files (saved on this computer; open them from these paths):\n- /w/attachments/a.png (image, 2 KB)\n- /w/attachments/b.mp3 (audio, 3.0 MB)',
    )
    expect(messageWithAttachments('', [song])).toMatch(/^The user attached this file/)
    expect(messageWithAttachments('Hi', [])).toBe('Hi')
    expect(turnInput('Hi', [image, song, heic])).toEqual([
      { text: messageWithAttachments('Hi', [image, song, heic]), type: 'text' },
      { path: '/w/attachments/a.png', type: 'localImage' },
    ])
  })
})
