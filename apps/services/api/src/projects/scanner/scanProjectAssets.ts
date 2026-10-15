import type { Asset, AssetGroup } from '@agent-lib/types/storyloader'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

const logger = new Logger('scanProjectAssets')

export async function scanProjectAssets(projectId: string): Promise<Asset[]> {
  try {
    // Read via the storage abstraction (storage).
    const storage = await createStorage(projectId)
    const relativePath = 'story_loader/annotated_script.json'

    // Check if file exists before reading to avoid 404 errors
    if (!(await storage.exists(relativePath))) {
      logger.debug({ projectId }, 'Annotated script not found - project may not be ready yet')
      return []
    }

    const fileContent = await storage.readTextFile(relativePath)
    const assetGroups = JSON.parse(fileContent) as AssetGroup[]

    return assetGroups
      .filter((group) => group.intentId !== 'user_provided')
      .flatMap((group) => group.assets ?? [])
  } catch (error) {
    logger.warn({ err: ensureError(error), projectId }, 'Failed to scan project assets')
    return []
  }
}
