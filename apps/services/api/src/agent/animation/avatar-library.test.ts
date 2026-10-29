import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  avatarVoice,
  deleteAvatar,
  isAvatarId,
  listAvatars,
  newAvatarId,
  readAvatar,
  saveAvatar,
  setAvatarVoice,
} from './avatar-library'

/** Puts DATA_DIR back as it was (unset stays unset: assigning undefined would set "undefined"). */
function restoreDataDir(value: string | undefined): void {
  if (value === undefined) delete process.env['DATA_DIR']
  else process.env['DATA_DIR'] = value
}

describe('the avatar library', () => {
  let data: string
  let work: string
  const before = process.env['DATA_DIR']
  beforeEach(() => {
    data = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'avatars-data-')))
    work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'avatars-work-')))
    process.env['DATA_DIR'] = data
    for (const [name, body] of [
      ['avatar.ts', 'export const avatar = 1'],
      ['preview.png', 'png'],
      ['photo.JPG', 'jpg'],
      ['voice.wav', 'wav'],
    ])
      fs.writeFileSync(path.join(work, name), body)
  })
  afterEach(() => {
    restoreDataDir(before)
    fs.rmSync(data, { force: true, recursive: true })
    fs.rmSync(work, { force: true, recursive: true })
  })
  const file = (name: string) => path.join(work, name)

  it('makes ids it can tell apart from anything else', () => {
    expect(isAvatarId(newAvatarId())).toBe(true)
    expect(isAvatarId('../etc')).toBe(false)
    expect(readAvatar('../../etc')).toBeNull()
  })

  it('saves an avatar with its rig, picture, photo and voice, and lists it', () => {
    const id = newAvatarId()
    saveAvatar({
      id,
      name: 'Sam',
      photo: file('photo.JPG'),
      preview: file('preview.png'),
      rig: file('avatar.ts'),
      style: '2d',
      voice: 'a warm, quick voice',
      voiceSample: { text: 'Hi, it is me.', wav: file('voice.wav') },
    })
    expect(readAvatar(id)).toMatchObject({
      id,
      name: 'Sam',
      style: '2d',
      voice: 'a warm, quick voice',
    })
    const dir = path.join(data, 'files', 'avatars', id)
    expect(fs.readFileSync(path.join(dir, 'avatar.ts'), 'utf8')).toBe('export const avatar = 1')
    expect(fs.existsSync(path.join(dir, 'photo.jpg'))).toBe(true)
    expect(avatarVoice(id)).toEqual({
      text: 'Hi, it is me.',
      wav: `store://avatars/${id}/voice.wav`,
    })
    expect(listAvatars()).toEqual([
      expect.objectContaining({ id, name: 'Sam', previewUrl: `store://avatars/${id}/preview.png` }),
    ])
  })

  it('keeps a fixed voice through saves, and changes or clears it', () => {
    const id = newAvatarId()
    const base = { id, preview: file('preview.png'), rig: file('avatar.ts'), style: '2d' as const }
    saveAvatar({ ...base, name: 'Sam', voice: 'calm', voiceId: 'kokoro-am_michael' })
    saveAvatar({ ...base, name: 'Sam', voice: 'calm' })
    expect(readAvatar(id)?.voiceId).toBe('kokoro-am_michael')
    expect(listAvatars()).toEqual([
      expect.objectContaining({
        voiceDescription: 'calm',
        voiceId: 'kokoro-am_michael',
        voiceSampleUrl: null,
      }),
    ])
    expect(setAvatarVoice(id, 'qwen3-ryan')?.voiceId).toBe('qwen3-ryan')
    expect(readAvatar(id)?.voiceId).toBe('qwen3-ryan')
    expect(setAvatarVoice(id, null)?.voiceId).toBeUndefined()
    expect(listAvatars()[0]?.voiceId).toBeNull()
    expect(setAvatarVoice(newAvatarId(), 'qwen3-ryan')).toBeNull()
  })

  it('keeps the photo, voice and first date when saved again, and deletes it', () => {
    const id = newAvatarId()
    const base = { id, preview: file('preview.png'), rig: file('avatar.ts'), style: '3d' as const }
    const first = saveAvatar({
      ...base,
      name: 'Sam',
      photo: file('photo.JPG'),
      voice: 'v1',
      voiceSample: { text: 'Hi.', wav: file('voice.wav') },
    })
    const again = saveAvatar({ ...base, name: 'Sammy', voice: 'v1' })
    expect(again.createdAt).toBe(first.createdAt)
    expect(readAvatar(id)?.name).toBe('Sammy')
    expect(avatarVoice(id)?.text).toBe('Hi.')
    expect(deleteAvatar(id)).toBe(true)
    expect(listAvatars()).toEqual([])
    expect(deleteAvatar(id)).toBe(false)
  })
})
