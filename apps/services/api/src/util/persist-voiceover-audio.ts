import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'

import { downloadStoredFile, uploadToStore } from '@reelmakeeasy/common/storage/stored-files'

import { deriveSafeSourceExtension, extractAudioTrackToMp3 } from './extract-audio-from-video'

/**
 * Download a video voice-over source from storage, extract its audio track to an
 * mp3, and upload that mp3 to `destMp3Uri`. Lets the caller persist a small
 * audio-only artifact instead of the (potentially large) source video, so the
 * raw upload can stay in temp-only storage. The temp working dir is always
 * cleaned up. Throws on any download / extract / upload failure so the caller
 * can fall back to keeping the source.
 */
export async function extractVideoAudioToMp3InStore(
  sourceStoreUri: string,
  destMp3Uri: string,
): Promise<void> {
  const { safeExt } = deriveSafeSourceExtension(sourceStoreUri)
  const tempDir = await mkdtemp(`${os.tmpdir()}/voice-over-mp3-`)
  try {
    const downloadedPath = `${tempDir}/source.${safeExt}`
    const mp3Path = `${tempDir}/voice_over.mp3`
    await downloadStoredFile(sourceStoreUri, downloadedPath)
    await extractAudioTrackToMp3(downloadedPath, mp3Path)
    await uploadToStore(mp3Path, destMp3Uri)
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}
