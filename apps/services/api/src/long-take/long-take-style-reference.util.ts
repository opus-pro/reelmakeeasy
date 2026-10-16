import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import {
  LONG_TAKE_STYLE_REFERENCE_DIR,
  LONG_TAKE_STYLE_REFERENCE_PATH,
  type LongTakeStyleReference,
} from '@reelmakeeasy/common/long-take/style-reference'
import { parseStoreUri } from '@reelmakeeasy/common/storage/address'
import { copyStoredFile } from '@reelmakeeasy/common/storage/stored-files'

type SavedStyleLookup = {
  userSavedStyle: {
    findFirst(args: {
      select: { originalImageUri: true; styleInputMode: true }
      where: { id: string; userId: string }
    }): Promise<null | { originalImageUri: null | string; styleInputMode: null | string }>
  }
}

const OBJECT_ID = /^[a-f0-9]{24}$/i

/**
 * Sets the project's style reference for a video start: the picture of the user's saved
 * image style, copied into the project, or none.
 *
 * The style is looked up for this user, so a client can't point the reference at another
 * user's file. A start without an image style removes any reference left by an earlier
 * start of the same project. Returns the project addresses to hand to the workflow.
 */
export async function prepareLongTakeStyleReference(
  deps: { prisma: SavedStyleLookup },
  params: { projectId: string; savedStyleId?: null | string; userId: string },
): Promise<string[]> {
  const storage = new ProjectStore(params.projectId)
  const sourceUri = await findSavedStyleImage(deps.prisma, params)
  if (!sourceUri) {
    if (await storage.exists(LONG_TAKE_STYLE_REFERENCE_PATH)) {
      await storage.deleteFile(LONG_TAKE_STYLE_REFERENCE_PATH)
    }
    return []
  }

  const sourceKey = storeKeyOrNull(sourceUri)
  const extension = sourceKey?.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase() || 'png'
  const projectUri = storage.getFullPath(`${LONG_TAKE_STYLE_REFERENCE_DIR}/original.${extension}`)
  await copyStoredFile(sourceUri, projectUri)

  const reference: LongTakeStyleReference = { imageUris: [projectUri] }
  await storage.writeJsonFile(LONG_TAKE_STYLE_REFERENCE_PATH, reference)
  return reference.imageUris
}

async function findSavedStyleImage(
  prisma: SavedStyleLookup,
  params: { savedStyleId?: null | string; userId: string },
): Promise<null | string> {
  const id = params.savedStyleId?.trim()
  if (!id || !OBJECT_ID.test(id) || !params.userId) {
    return null
  }
  const style = await prisma.userSavedStyle.findFirst({
    select: { originalImageUri: true, styleInputMode: true },
    where: { id, userId: params.userId },
  })
  const uri = style?.originalImageUri?.trim()
  if (style?.styleInputMode !== 'image' || !uri || !storeKeyOrNull(uri)) {
    return null
  }
  return uri
}

/** The stored file's key, or null when the value isn't a valid `store://` address. */
function storeKeyOrNull(uri: string): null | string {
  try {
    return parseStoreUri(uri)
  } catch {
    return null
  }
}
