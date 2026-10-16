import { LONG_TAKE_STYLE_REFERENCE_PATH } from '@reelmakeeasy/common/long-take/style-reference'

const copyStoredFile = jest.fn(async () => undefined)
const files = new Map<string, unknown>()

jest.mock('@reelmakeeasy/common/storage/stored-files', () => ({
  copyStoredFile: (...args: unknown[]) => copyStoredFile(...(args as [])),
}))
jest.mock('@reelmakeeasy/common/agent-v2/storage/project-store', () => ({
  ProjectStore: class {
    constructor(private readonly projectId: string) {}
    async deleteFile(path: string) {
      files.delete(path)
    }
    async exists(path: string) {
      return files.has(path)
    }
    getFullPath(path: string) {
      return `store://projects/${this.projectId}/${path}`
    }
    async writeJsonFile(path: string, data: unknown) {
      files.set(path, data)
      return path
    }
  },
}))

import { prepareLongTakeStyleReference } from './long-take-style-reference.util'

const STYLE_ID = '0123456789abcdef01234567'

function prismaWith(style: null | { originalImageUri: null | string; styleInputMode: string }) {
  const findFirst = jest.fn(async () => style)
  return { findFirst, prisma: { userSavedStyle: { findFirst } } }
}

beforeEach(() => {
  files.clear()
  copyStoredFile.mockClear()
})

describe('prepareLongTakeStyleReference', () => {
  it("copies an image style's picture into the project and records it", async () => {
    const { findFirst, prisma } = prismaWith({
      originalImageUri: 'store://user-saved-styles/u1/originals/123.jpg',
      styleInputMode: 'image',
    })
    const uris = await prepareLongTakeStyleReference(
      { prisma: prisma as never },
      { projectId: 'p1', savedStyleId: STYLE_ID, userId: 'u1' },
    )
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: STYLE_ID, userId: 'u1' } }),
    )
    expect(uris).toEqual(['store://projects/p1/long_take/style_reference/original.jpg'])
    expect(copyStoredFile).toHaveBeenCalledWith(
      'store://user-saved-styles/u1/originals/123.jpg',
      'store://projects/p1/long_take/style_reference/original.jpg',
    )
    expect(files.get(LONG_TAKE_STYLE_REFERENCE_PATH)).toEqual({ imageUris: uris })
  })

  it('sets no reference for text styles, unknown ids or other users, and clears an old one', async () => {
    files.set(LONG_TAKE_STYLE_REFERENCE_PATH, { imageUris: ['store://old'] })
    const { prisma } = prismaWith({ originalImageUri: null, styleInputMode: 'text' })
    await expect(
      prepareLongTakeStyleReference(
        { prisma: prisma as never },
        { projectId: 'p1', savedStyleId: STYLE_ID, userId: 'u1' },
      ),
    ).resolves.toEqual([])
    expect(files.has(LONG_TAKE_STYLE_REFERENCE_PATH)).toBe(false)
    expect(copyStoredFile).not.toHaveBeenCalled()
  })

  it('never queries with a malformed id', async () => {
    const { findFirst, prisma } = prismaWith(null)
    await prepareLongTakeStyleReference(
      { prisma: prisma as never },
      { projectId: 'p1', savedStyleId: 'preset-anime', userId: 'u1' },
    )
    expect(findFirst).not.toHaveBeenCalled()
  })

  it('ignores a stored address that is not a store:// file', async () => {
    const { prisma } = prismaWith({
      originalImageUri: 'https://example.com/a.png',
      styleInputMode: 'image',
    })
    await expect(
      prepareLongTakeStyleReference(
        { prisma: prisma as never },
        { projectId: 'p1', savedStyleId: STYLE_ID, userId: 'u1' },
      ),
    ).resolves.toEqual([])
    expect(copyStoredFile).not.toHaveBeenCalled()
  })
})
