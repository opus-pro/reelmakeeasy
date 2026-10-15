import { logger } from '@reelmakeeasy/common/logger'
import { serveWorkers } from '@reelmakeeasy/common/workflow/worker'
import { initLogConfig } from '@reelmakeeasy/story-mode-runtime'

import { getBrandExtractionWorkerConfig } from './workers/worker-brand-extraction'
import { getImageApiWorkerConfig } from './workers/worker-image-api'
import { getMainWorkerConfig } from './workers/worker-main'
import { getUipWorkerConfig } from './workers/worker-uip'
import { getVideoApiWorkerConfig } from './workers/worker-video-api'
import * as workflows from './workflows'

/**
 * Registers the story-mode workers (planning, image, video, UIP, brand
 * extraction) with the in-process workflow engine. Call after the KV store, SSE
 * and the LLM client are initialized.
 */
export async function startStoryModeWorkers(): Promise<void> {
  initLogConfig()

  await serveWorkers([
    { ...getMainWorkerConfig(), workflows },
    getImageApiWorkerConfig(),
    getVideoApiWorkerConfig(),
    getUipWorkerConfig(),
    getBrandExtractionWorkerConfig(),
  ])
  logger.info('[story-mode] workers registered')
}
