import {
  attachmentName,
  attachmentProblem,
  filesFrom,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  readableSize,
  uploadAttachment,
} from './attachments'

const file = (name: string, type = '', size?: number): File => {
  const made = new File(['abc'], name, { type })
  if (size !== undefined) Object.defineProperty(made, 'size', { value: size })
  return made
}

const reply = (body: unknown, status = 200) => ({
  json: async () => body,
  ok: status < 400,
  status,
})

describe('chat attachments', () => {
  it('names a pasted picture by when it was pasted, and keeps a real name', () => {
    const at = new Date('2026-10-15T01:02:03Z')
    expect(attachmentName(file('image.png', 'image/png'), at)).toBe(
      'Pasted image 2026-10-15 01-02-03.png',
    )
    expect(attachmentName(file('', 'image/jpeg'), at)).toBe('Pasted image 2026-10-15 01-02-03.jpg')
    expect(attachmentName(file('song.mp3', 'audio/mpeg'), at)).toBe('song.mp3')
  })

  it('refuses a file over the limit and an eleventh file', () => {
    expect(attachmentProblem(file('a.mp4'), 0)).toBeNull()
    expect(attachmentProblem(file('big.mp4', 'video/mp4', MAX_ATTACHMENT_BYTES + 1), 0)).toMatch(
      /^Too big/,
    )
    expect(attachmentProblem(file('a.png'), MAX_ATTACHMENTS)).toBe(
      'Attach up to 10 files at a time.',
    )
    expect(readableSize(2048)).toBe('2 KB')
  })

  it('reads the files of a paste or drop, including a copied picture', () => {
    const png = file('image.png', 'image/png')
    expect(filesFrom({ files: [png] } as unknown as DataTransfer)).toEqual([png])
    const items = [
      { getAsFile: () => png, kind: 'file' },
      { getAsFile: () => null, kind: 'string' },
    ]
    expect(filesFrom({ files: [], items } as unknown as DataTransfer)).toEqual([png])
    expect(filesFrom(null)).toEqual([])
  })

  it("uploads the raw file and reports the API's reason when it fails", async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(reply({ kind: 'audio', name: 'song-a1.mp3', path: '/p', size: 3 }))
      .mockResolvedValueOnce(reply({ message: 'That file is too big' }, 413))
    global.fetch = fetchMock
    const song = file('song.mp3', 'audio/mpeg')
    await expect(
      uploadAttachment('http://localhost:5017', 's1', song, 'song.mp3'),
    ).resolves.toEqual({ kind: 'audio', name: 'song-a1.mp3', path: '/p', size: 3 })
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(url.toString()).toBe(
      'http://localhost:5017/api/agent/sessions/s1/attachments?name=song.mp3',
    )
    expect(init).toMatchObject({ body: song, method: 'POST' })
    await expect(uploadAttachment('http://localhost:5017', 's1', song, 'song.mp3')).rejects.toThrow(
      'That file is too big',
    )
  })
})
