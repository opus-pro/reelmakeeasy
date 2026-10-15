import * as fs from 'node:fs'
import * as path from 'node:path'

import { JobContext } from '@reelmakeeasy/common/job-context'
import { logger } from '@reelmakeeasy/common/logger'
import { assertDeliveredVideoPlayable } from '@reelmakeeasy/common/long-take/validate-delivered-video'
import { runCommand } from '@reelmakeeasy/common/utils/cmdline'
import { isDev } from '@reelmakeeasy/common/utils/env'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  downloadStoredFile,
  workspaceUri,
  uploadToStore,
} from '@reelmakeeasy/common/storage/stored-files'
import type { TaskRequest } from '@reelmakeeasy/common/workflow/types'
import type {
  ConcatContext,
  ConcatVideoParams,
  ConcatVideoResult,
} from '@reelmakeeasy/common/workflow/workflow/render/types'
import { heartbeat } from '@reelmakeeasy/workflow-engine/activity'
import { VideoConcatService } from '@shared/render-services/render'

import { resolveConcatTmpDir } from './concat-tmp-dir'
import { normalizeVideoTimescale } from './normalize-video-timescale'
import { stripLeadingId3Tag } from './strip-id3-tag'

/**
 * VideoAssembly (Concat) activity implementations.
 *
 * Workflow group: VideoConcat
 * Activities: concatVideos
 */
export class VideoConcatActivities extends VideoConcatService {
  override async concatVideos(
    params: TaskRequest<ConcatVideoParams, ConcatContext>,
  ): Promise<ConcatVideoResult> {
    const heartbeatInterval = setInterval(() => {
      try {
        logger.info('Sending heartbeat from concatVideos activity')
        heartbeat()
      } catch (error) {
        logger.error({ error }, 'Failed to send heartbeat from concatVideos activity')
      }
    }, 10_000)

    const { projectId, batchId } = params.context
    const { audioUri, videoUris, outputFileName } = params.payload

    if (!videoUris || videoUris.length === 0) {
      throw new Error('No video URIs provided for concatenation')
    }

    // Passthrough is only valid when there is NO audio to mux. Chunk renders
    // are video-only - the voiceover joins HERE - so returning the raw chunk
    // for a single-chunk batch shipped a silent delivery (every 4K export
    // short enough to fit one chunk). A single video with an
    // audioUri must run the same download -> mux -> upload path a multi-chunk
    // batch does.
    if (videoUris.length === 1 && !audioUri) {
      clearInterval(heartbeatInterval)
      return {
        videoUri: videoUris[0],
        message: 'Single video, no concatenation needed',
      }
    }

    const tmpDir = resolveConcatTmpDir()

    try {
      return await JobContext.run({ projectId }, async () => {
        logger.info(
          {
            projectId,
            batchId,
            videoCount: videoUris.length,
          },
          '[concatVideos] Starting video concatenation',
        )

        // Step 1: Download all videos to local tmp directory
        const localVideoPaths: string[] = []
        for (let i = 0; i < videoUris.length; i++) {
          const videoUri = videoUris[i]
          const localPath = path.join(tmpDir, `video_${i.toString().padStart(3, '0')}.mp4`)

          logger.info(
            { projectId, index: i, videoUri, localPath },
            '[concatVideos] Downloading video chunk',
          )

          await downloadStoredFile(videoUri, localPath)

          // Validate every chunk BEFORE it is concatenated. A chunk
          // whose pod died mid-write can surface here as a complete-looking
          // stored file with an unfinalized container or a garbage H.264
          // payload; the concat stream-copies those bytes into the delivery,
          // where only the far-away delivery gate (or the user) notices. A
          // corrupt chunk must fail THIS activity, loudly naming the chunk,
          // so the failure is attributable to the render (and retryable)
          // instead of surfacing as a corrupt final video. Chunks are ~30s,
          // so the per-chunk decode adds seconds, bounded by the validator.
          const chunkLogger = {
            error: (message: string) =>
              logger.error({ batchId, chunkIndex: i, projectId, videoUri }, message),
            info: (message: string) => logger.info({ batchId, chunkIndex: i, projectId }, message),
            warn: (message: string) => logger.warn({ batchId, chunkIndex: i, projectId }, message),
          }
          // Chunks are video-only (the voiceover joins at this concat), so no
          // requireAudioStream here.
          await assertDeliveredVideoPlayable(localPath, chunkLogger, projectId, {
            decodeScan: true,
          })

          // Flatten every chunk onto one video track timescale BEFORE the join
          // (see normalize-video-timescale.ts): chunks of a single batch can
          // carry different timescales, and the concat demuxer rescales
          // timestamps INCORRECTLY across a heterogeneous set - producing a join
          // with a timestamp gap or missing frames that still passes every
          // container check on the way out. Applied
          // unconditionally: a per-chunk probe to decide would cost an extra
          // ffprobe per chunk to skip a container-only stream copy, and a
          // single-chunk batch is normalized for free.
          const normalizedPath = path.join(
            tmpDir,
            `video_${i.toString().padStart(3, '0')}.norm.mp4`,
          )
          try {
            await normalizeVideoTimescale(localPath, normalizedPath)
          } catch (error) {
            // Name the chunk like every other per-chunk failure here does; the
            // outer catch only carries projectId/batchId, which would leave
            // on-call parsing the ffmpeg command string to find the file.
            chunkLogger.error(
              `[concatVideos] timescale normalization failed: ${ensureError(error).message}`,
            )
            throw error
          }
          // The remux, not the download, is what gets joined - so re-assert the
          // gate on the artifact that actually reaches the concat. Payload
          // integrity was already proven by the decode scan above (a stream
          // copy cannot corrupt it), so this is the cheap container-level pass:
          // sound container, a video stream, readable packets, positive
          // duration. Without it the guard would be validating a file
          // that no longer exists by the time the join runs.
          await assertDeliveredVideoPlayable(normalizedPath, chunkLogger, projectId)
          // The raw download is dead weight once normalized, and render pods
          // are scheduled tight on ephemeral-storage; dropping it keeps the
          // extra footprint at one chunk instead of doubling the batch. Dev
          // keeps both copies for the same reason it keeps the whole tmp dir:
          // comparing raw vs normalized is the first thing you want when a
          // join looks wrong locally.
          if (!isDev()) {
            fs.rmSync(localPath, { force: true })
          }

          localVideoPaths.push(normalizedPath)
        }

        const localAudioPath = path.join(tmpDir, 'audio.mp3')
        await downloadStoredFile(audioUri, localAudioPath)
        // Some voice pipelines embed ID3 cover art, which can make the mux
        // silently drop the WHOLE audio track.
        const strippedBytes = stripLeadingId3Tag(localAudioPath)
        if (strippedBytes > 0) {
          logger.info(
            { projectId, strippedBytes },
            '[concatVideos] Stripped ID3 tag from audio before mux',
          )
        }

        // Step 2: Concatenate videos with local ffmpeg. Mux the voiceover - chunk
        // renders are video-only, so a copy-only concat would ship silent.
        const finalFileName = outputFileName || 'concatenated.mp4'
        const outputPath = path.join(tmpDir, finalFileName)

        logger.info(
          {
            projectId,
            videoCount: localVideoPaths.length,
            outputPath,
          },
          '[concatVideos] Starting concatenation',
        )

        const fileListPath = path.join(tmpDir, 'concat_list.txt')
        const fileListContent = localVideoPaths.map((p) => `file '${p}'`).join('\n')
        fs.writeFileSync(fileListPath, fileListContent)

        await runCommand([
          'ffmpeg',
          '-y',
          '-f',
          'concat',
          '-safe',
          '0',
          '-i',
          fileListPath,
          '-i',
          localAudioPath,
          '-map',
          '0:v',
          '-map',
          '1:a',
          '-c:v',
          'copy',
          '-c:a',
          'aac',
          '-shortest',
          outputPath,
        ])

        // Validate the OUTPUT with the same gate as the inputs. A
        // concat killed mid-mux leaves a complete-looking but unfinalized MP4
        // that publishes cleanly and then deterministically fails every
        // downstream consumer (the paid 4K
        // upscale probes it and dies). The mux always maps the voiceover, so
        // a missing audio stream is equally a mux defect here.
        await assertDeliveredVideoPlayable(
          outputPath,
          {
            error: (message: string) => logger.error({ batchId, projectId, outputPath }, message),
            info: (message: string) => logger.info({ batchId, projectId }, message),
            warn: (message: string) => logger.warn({ batchId, projectId }, message),
          },
          projectId,
          { decodeScan: true, requireAudioStream: true },
        )

        // Step 3: Upload concatenated video to storage
        const fileUri = workspaceUri(projectId, 'render', `concat-${batchId}`, finalFileName)

        logger.info(
          { projectId, outputPath, fileUri },
          '[concatVideos] Uploading concatenated video',
        )

        // The concat output is copied to the delivery path by the same run's
        // finalize; stamp it transient so the lifecycle rule reclaims it.
        await uploadToStore(outputPath, fileUri)

        logger.info(
          { projectId, batchId, videoCount: videoUris.length, fileUri },
          '[concatVideos] Video concatenation completed successfully',
        )

        return {
          videoUri: fileUri,
          message: `Successfully concatenated ${videoUris.length} videos`,
        }
      })
    } catch (error) {
      logger.error({ error, projectId, batchId }, '[concatVideos] Video concatenation failed')
      throw error
    } finally {
      clearInterval(heartbeatInterval)

      // Cleanup temp directory
      if (!isDev() && fs.existsSync(tmpDir)) {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true })
        } catch (e) {
          logger.warn(`[concatVideos] Failed to cleanup temp directory ${tmpDir}`, e)
        }
      }
    }
  }
}
