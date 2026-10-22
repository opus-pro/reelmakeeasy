import { act, renderHook, waitFor } from '@testing-library/react'

import { MAX_ATTACHMENTS } from './attachments'
import { useAttachments } from './useAttachments'

jest.mock('./attachments', () => ({
  ...jest.requireActual('./attachments'),
  uploadAttachment: jest.fn((_origin: string, _session: string, file: File, name: string) =>
    Promise.resolve({ kind: 'image', name, path: `/tmp/${name}`, size: file.size }),
  ),
}))

describe('useAttachments', () => {
  const revoke = jest.fn()

  beforeEach(() => {
    revoke.mockClear()
    let n = 0
    URL.createObjectURL = jest.fn(() => `blob:${++n}`)
    URL.revokeObjectURL = revoke
  })

  async function withOneFile(sessionId = 's1') {
    const hook = renderHook(({ id }) => useAttachments(id), { initialProps: { id: sessionId } })
    act(() => hook.result.current.add([new File(['png'], 'dog.png', { type: 'image/png' })]))
    await waitFor(() => expect(hook.result.current.ready).toEqual(['dog.png']))
    return hook
  }

  it('take empties the box; a refused send restores the files as they were', async () => {
    const { result } = await withOneFile()
    let taken: ReturnType<typeof result.current.take> | undefined
    act(() => {
      taken = result.current.take()
    })
    expect(result.current.items).toEqual([])
    act(() => taken?.restore())
    expect(result.current.ready).toEqual(['dog.png'])
    expect(result.current.items[0]?.previewUrl).toBe('blob:1')
    expect(revoke).not.toHaveBeenCalled()
  })

  it('a sent message lets the taken files go', async () => {
    const { result } = await withOneFile()
    let taken: ReturnType<typeof result.current.take> | undefined
    act(() => {
      taken = result.current.take()
    })
    taken?.release()
    expect(revoke).toHaveBeenCalledWith('blob:1')
    expect(result.current.items).toEqual([])
  })

  it('lets the files go when the box is gone by the time the send is refused', async () => {
    const { result, unmount } = await withOneFile()
    let taken: ReturnType<typeof result.current.take> | undefined
    act(() => {
      taken = result.current.take()
    })
    unmount()
    taken?.restore()
    expect(revoke).toHaveBeenCalledWith('blob:1')
  })

  it('a refused send restores no more than the limit: files added meanwhile past it are marked', async () => {
    const files = (n: number, tag: string) =>
      Array.from({ length: n }, (_, i) => new File(['x'], `${tag}${i}.png`, { type: 'image/png' }))
    const { result } = renderHook(() => useAttachments('s1'))
    act(() => result.current.add(files(MAX_ATTACHMENTS, 'a')))
    await waitFor(() => expect(result.current.ready).toHaveLength(MAX_ATTACHMENTS))
    let taken: ReturnType<typeof result.current.take> | undefined
    act(() => {
      taken = result.current.take()
    })
    // More attached while the send is out.
    act(() => result.current.add(files(2, 'b')))
    await waitFor(() => expect(result.current.ready).toHaveLength(2))
    act(() => taken?.restore())
    expect(result.current.ready).toHaveLength(MAX_ATTACHMENTS)
    expect(result.current.ready[0]).toBe('a0.png')
    const marked = result.current.items.filter((item) => item.status === 'error')
    expect(marked.map((item) => item.file.name)).toEqual(['b0.png', 'b1.png'])
    expect(marked[0]?.error).toBe(`Attach up to ${MAX_ATTACHMENTS} files at a time.`)
  })

  it("doesn't restore the files into another chat's box", async () => {
    const { rerender, result } = await withOneFile()
    let taken: ReturnType<typeof result.current.take> | undefined
    act(() => {
      taken = result.current.take()
    })
    rerender({ id: 's2' })
    act(() => taken?.restore())
    expect(result.current.items).toEqual([])
    expect(revoke).toHaveBeenCalledWith('blob:1')
  })
})
