import { STORYBOARD_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { logger } from '@reelmakeeasy/common/logger'
import { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { HttpException, Injectable } from '@nestjs/common'

@Injectable()
export class VideoScriptService {
  async getVideoScript(projectId: string): Promise<VideoScript> {
    // Read-only survivor of the AI UGC teardown: the legacy editor's
    // export/save methods are gone, but Story Mode inpaint still reads the video
    // script through this endpoint. 404s rather than returning an empty script so
    // a missing file is never mistaken for an empty timeline.
    const storage = await createStorage(projectId)
    logger.info({ projectId }, '[getVideoScript] checking if video script exists')
    if (await storage.exists(STORYBOARD_PATHS.videoScriptPath)) {
      return storage.readJsonFile<VideoScript>(STORYBOARD_PATHS.videoScriptPath)
    }

    throw new HttpException('Video script not found', 404)
  }
}
