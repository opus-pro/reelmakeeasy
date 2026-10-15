import path from 'node:path'

import { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { TranscriptData } from '@shared/types/agent/transcript'
import { ViralHook } from '@shared/types/api/viral-hook'

import { Storyboard } from '../storyboard/types'

import { AvatarMetadataV2 } from './tools/avatar/types/avatar-metadata'
import { SUB_FOLDER } from './constant'
import { FileOrDirectoryEntry, FileType } from './file-with-type'

/**
 * file name inside subFolder
 * subFolder: { name: path }
 */
export const FILE_PATH = {
  storyLoader: {
    transformTranscript: 'transcript/transformed_transcript.json',
  },
}

type FileEntryWithStaticProperties<T> = {
  (projectId: string): FileOrDirectoryEntry<T>
  fileType: FileType
  path: string
}

function internalFileOrDirectoryEntryFn<T>({
  relativePath,
  fileType = 'json',
  isDirectory = false,
}: {
  fileType?: FileType
  isDirectory?: boolean
  relativePath: string
}): FileEntryWithStaticProperties<T> {
  // projectId can be optional
  const fn = (projectId: string) => {
    return new FileOrDirectoryEntry<T>(projectId, relativePath, fileType, isDirectory)
  }
  // add static properties
  fn.path = relativePath
  fn.fileType = fileType
  fn.isDirectory = isDirectory
  return fn
}

/** @deprecated Use `import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'` instead */
export const FileHub = {
  /** project */
  projectDir: internalFileOrDirectoryEntryFn<string>({ relativePath: '', isDirectory: true }),

  /** Hook */
  pickedHook: internalFileOrDirectoryEntryFn<ViralHook>({ relativePath: 'picked_hook.json' }),
  hookSummary: internalFileOrDirectoryEntryFn<ViralHook[]>({ relativePath: 'hook_summary.json' }),
  getSingleHookSummary: ({ hookId, projectId }: { hookId: string; projectId: string }) => {
    return internalFileOrDirectoryEntryFn<ViralHook[]>({
      relativePath: path.join(hookId, 'hook_summary.json'),
    })(projectId)
  },

  /** StoryLoader */
  storyLoaderDir: internalFileOrDirectoryEntryFn<string>({
    relativePath: SUB_FOLDER.STORY_LOADER,
    isDirectory: true,
  }),

  scriptText: internalFileOrDirectoryEntryFn<string>({
    relativePath: path.join(SUB_FOLDER.STORY_LOADER, 'script.txt'),
    fileType: 'text',
  }),

  transcriptJson: internalFileOrDirectoryEntryFn<TranscriptData>({
    relativePath: path.join(SUB_FOLDER.STORY_LOADER, FILE_PATH.storyLoader.transformTranscript),
  }),

  /** storyboard */
  storyboardDir: internalFileOrDirectoryEntryFn<string>({
    relativePath: SUB_FOLDER.STORYBOARD,
    isDirectory: true,
  }),
  storyboardJson: internalFileOrDirectoryEntryFn<Storyboard>({
    relativePath: 'storyboard/storyboard.json',
  }),
  avatarDir: internalFileOrDirectoryEntryFn<string>({
    relativePath: 'avatar',
    isDirectory: true,
  }),
  avatarMetadata: internalFileOrDirectoryEntryFn<AvatarMetadataV2>({
    relativePath: 'avatar/metadata.json',
  }),

  /** global */
  videoScript: internalFileOrDirectoryEntryFn<VideoScript>({ relativePath: 'video-script.json' }),
  finalVideo: internalFileOrDirectoryEntryFn<Buffer>({
    relativePath: 'final_video.mp4',
    fileType: 'binary',
  }),
  finalVideoThumbnail: internalFileOrDirectoryEntryFn<Buffer>({
    relativePath: '_thumbnail/final_video.mp4.jpg',
    fileType: 'binary',
  }),
  finalVideoMetadata: internalFileOrDirectoryEntryFn<{ mtimeMs: number }>({
    relativePath: 'final_video.json',
    fileType: 'json',
  }),
  watermarkVideo: internalFileOrDirectoryEntryFn<Buffer>({
    relativePath: 'watermark_video.mp4',
    fileType: 'binary',
  }),
  watermarkVideoMetadata: internalFileOrDirectoryEntryFn<{ mtimeMs: number }>({
    relativePath: 'watermark_video.json',
    fileType: 'json',
  }),

  /** user uploaded */
  userUploadedDir: internalFileOrDirectoryEntryFn<string>({
    relativePath: 'user_uploaded',
    isDirectory: true,
  }),
  preferredStyleFromLinkDir: internalFileOrDirectoryEntryFn<string>({
    relativePath: path.join('user_uploaded', 'preferred_style_from_link'),
    isDirectory: true,
  }),
} as const
