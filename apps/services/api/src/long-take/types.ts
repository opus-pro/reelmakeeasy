import type { KvStore } from '@reelmakeeasy/common/kv/store'
import type { Logger } from '@reelmakeeasy/common/logger'
import type { AspectRatio } from '@reelmakeeasy/common/media/types'

export type LongTakeStartWorkflowContext = {
  longTakeMetadata: {
    isLongTake: true
    longTakeInput: 'audio' | 'transcript'
    longTakeRatio?: AspectRatio
  }
  normalizedAudioPath?: string
  normalizedCustomStyle: boolean
  normalizedInitPrompt?: string
  normalizedProjectId?: string
  normalizedRatio?: AspectRatio
  normalizedScript: string
  normalizedStyleText?: string
  normalizedUserPrompt: string
  normalizedVisualScriptTemperature?: number
  normalizedVoiceId?: string
  projectInitialText: string
}

export type LongTakeUserAssetCatalogItem = {
  aliases: string[]
  fileId: string
  mime: string
  shortname: string
  storageUri: string
}

export interface WorkflowDeps {
  kv: KvStore
  logger: Logger
  mediaService: {
    getAttachments: (projectId: string) => Promise<
      Array<{
        id: string
        mime: string
        name?: null | string
        uri: string
      }>
    >
  }
}
