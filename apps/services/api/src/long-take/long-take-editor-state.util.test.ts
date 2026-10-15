import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import type { LongTakeEditorState } from '@shared/types/api/long-take'

import { withLoopKeyframesInProgress } from './long-take-editor-state.util'

const LOOP_KEYFRAMES = 'long_take/beat_loop_keyframes.json'

/** A storage holding `files` (path -> JSON); any other read fails as a missing object would. */
function storageWith(files: Record<string, unknown>) {
  return {
    readJsonFile: jest.fn(async (path: string) => {
      if (!(path in files)) throw Object.assign(new Error(`No such object: ${path}`), { code: 404 })
      return files[path]
    }),
  } as never
}

const EMPTY: LongTakeEditorState = { keyframes: [], transitions: [] }
const frame = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  prompt: `the ${id} shot`,
  uri: `store://projects/p1/long_take/keyframes/${id}.png`,
  ...extra,
})

describe('withLoopKeyframesInProgress', () => {
  it("shows a loop's keyframes as each one is made, before keyframes.json is written", async () => {
    const storage = storageWith({
      [LOOP_KEYFRAMES]: { complete: false, dialect: 'h3', frames: [frame('f0'), frame('f1')] },
    })

    const state = await withLoopKeyframesInProgress(storage, EMPTY)

    expect(state.keyframes).toEqual([
      { keyframeUrl: storeUriToUrl(frame('f0').uri), shotId: 'f0' },
      { keyframeUrl: storeUriToUrl(frame('f1').uri), shotId: 'f1' },
    ])
    expect(state.transitions).toEqual([])
  })

  it('leaves out the closing copy of the first frame, as keyframes.json does', async () => {
    const storage = storageWith({
      [LOOP_KEYFRAMES]: {
        complete: true,
        dialect: 'h3',
        frames: [frame('f0'), frame('f1'), frame('f2', { copyOf: 'f0' })],
      },
    })

    const state = await withLoopKeyframesInProgress(storage, EMPTY)

    expect(state.keyframes.map((k) => k.shotId)).toEqual(['f0', 'f1'])
  })

  it('keeps the keyframes the editor state already has, and reads nothing else', async () => {
    const storage = storageWith({ [LOOP_KEYFRAMES]: { frames: [frame('f0')] } })
    const state: LongTakeEditorState = {
      keyframes: [{ keyframeUrl: 'https://cdn/f0.png', shotId: 'f0' }],
      transitions: [],
    }

    expect(await withLoopKeyframesInProgress(storage, state)).toBe(state)
    expect((storage as { readJsonFile: jest.Mock }).readJsonFile).not.toHaveBeenCalled()
  })

  it('is the state as it was for a story video, or a record it cannot read', async () => {
    expect(await withLoopKeyframesInProgress(storageWith({}), EMPTY)).toBe(EMPTY)
    for (const record of [null, 'oops', { frames: 'oops' }, { frames: [{ id: 'f0' }, null] }]) {
      const state = await withLoopKeyframesInProgress(
        storageWith({ [LOOP_KEYFRAMES]: record }),
        EMPTY,
      )
      expect(state.keyframes).toEqual([])
    }
  })
})
