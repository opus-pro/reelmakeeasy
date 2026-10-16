import type { Storage } from '../agent-v2/storage/storage'

import {
  buildStyleReferenceContents,
  LONG_TAKE_STYLE_REFERENCE_PATH,
  readLongTakeStyleReferenceUris,
  STYLE_REFERENCE_INSTRUCTION,
} from './style-reference'

function storageWith(files: Record<string, unknown>): Storage {
  return {
    exists: async (path: string) => path in files,
    readJsonFile: async (path: string) => {
      if (!(path in files)) throw new Error(`missing ${path}`)
      return files[path]
    },
  } as unknown as Storage
}

describe('buildStyleReferenceContents', () => {
  it('puts the instruction before the images so the model reads them as a style, not content', () => {
    expect(buildStyleReferenceContents(['store://a.png'])).toEqual([
      { type: 'text', text: STYLE_REFERENCE_INSTRUCTION },
      { type: 'image_url', imageUrl: 'store://a.png' },
    ])
  })

  it('returns nothing without images, and drops blanks', () => {
    expect(buildStyleReferenceContents([])).toEqual([])
    expect(buildStyleReferenceContents(['  ', ''])).toEqual([])
  })

  it('caps the number of references', () => {
    const parts = buildStyleReferenceContents(['store://1', 'store://2', 'store://3'])
    expect(parts.filter((part) => part.type === 'image_url')).toHaveLength(2)
  })
})

describe('readLongTakeStyleReferenceUris', () => {
  it('reads the project file', async () => {
    const storage = storageWith({
      [LONG_TAKE_STYLE_REFERENCE_PATH]: { imageUris: ['store://projects/p/long_take/x.png'] },
    })
    await expect(readLongTakeStyleReferenceUris(storage)).resolves.toEqual([
      'store://projects/p/long_take/x.png',
    ])
  })

  it('returns no references when the file is absent or malformed', async () => {
    await expect(readLongTakeStyleReferenceUris(storageWith({}))).resolves.toEqual([])
    await expect(
      readLongTakeStyleReferenceUris(
        storageWith({ [LONG_TAKE_STYLE_REFERENCE_PATH]: { imageUris: 'nope' } }),
      ),
    ).resolves.toEqual([])
  })
})
