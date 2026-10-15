import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { imageModelForRole } from '@reelmakeeasy/common/llm/image-model-selection'
import type { AspectRatio } from '@reelmakeeasy/common/media/types'

import type {
  ExpandLongTakeKeyframeActivityParams,
  ExpandLongTakeKeyframeActivityResult,
} from '../../workflows/long-take/types'
import { runImageGenerationWithRecord } from '../long-take-generation-record'
import { runSelectedModelWithRecord } from '../long-take-selected-model-record'
import { buildLongTakeKeyframeExpansionPrompt } from '../prompts/long-take-keyframe-expansion-prompt'

import {
  DEFAULT_ASPECT_RATIO,
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { resolveGenerationResolution } from './generation-resolution'
import { createLongTakeStorage, LONG_TAKE_KEYFRAME_EXPANSIONS_DIR } from './storage'

export async function expandLongTakeKeyframe(
  params: ExpandLongTakeKeyframeActivityParams,
): Promise<ExpandLongTakeKeyframeActivityResult | null> {
  const { aspectRatio, panel1Uri, panel2Description, projectId, shotId, userId } = params

  return withLongTakeContext({ projectId, sceneId: 'long_take_scene', shotId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)
      const resolvedAspectRatio: AspectRatio = aspectRatio ?? DEFAULT_ASPECT_RATIO
      // Per-project image size tier: API value > default.
      const imageSize = resolveGenerationResolution({
        configured: params.generationResolution,
        projectId,
      }).imageSize

      const outputStoragePath = `${LONG_TAKE_KEYFRAME_EXPANSIONS_DIR}/${shotId}_p2.png`
      const outputUri = storage.getFullPath(outputStoragePath)

      try {
        await storage.ensureDir(LONG_TAKE_KEYFRAME_EXPANSIONS_DIR)

        const prompt = buildLongTakeKeyframeExpansionPrompt(panel2Description)

        const carriedModel = params.imageModel?.trim()
        let panel2Uri: string
        if (carriedModel) {
          // Gate-on: route through the selected-model orchestrator.
          // The orchestrator only writes the image to a local outputPath and
          // returns that path; it does NOT upload to cloud storage. So mirror
          // the proven anchors idiom (generateLongTakeSingleRawAnchorAsset):
          // generate to a local temp file, upload it to the storage path, then
          // return the storage URI so both branches yield the same shape.
          const localDir = await fs.promises.mkdtemp(
            path.join(os.tmpdir(), `long-take-keyframe-expansion-${projectId}-`),
          )
          const localOutputPath = path.join(localDir, `${shotId}_p2.png`)
          try {
            // The wrapper also writes the generation records the story-mode
            // report reads and emits the provider metrics.
            await runSelectedModelWithRecord({
              aspectRatio: resolvedAspectRatio,
              contents: [{ type: 'image_url', imageUrl: panel1Uri }],
              resolutionTier: imageSize,
              // Grounding intentionally omitted to match the legacy keyframe
              // expansion path (parity: only the model changes, not other
              // generation params).
              orgId: params.orgId ?? null,
              outputPath: localOutputPath,
              outputUri,
              projectId,
              prompt,
              selectedModel: carriedModel,
              shotId,
              stage: 'keyframe_expansion',
              task: 'long-take-keyframe-expansion',
              userId,
            })
            await storage.uploadFile(localOutputPath, outputStoragePath)
            panel2Uri = outputUri
          } finally {
            // Best-effort temp cleanup: a cleanup failure must not turn an
            // already-successful upload into a null result.
            await fs.promises
              .rm(localDir, { force: true, recursive: true })
              .catch((cleanupError) => {
                logger.warn(
                  `[long-take] Keyframe expansion temp cleanup failed ${formatLogFields({
                    err: formatError(cleanupError),
                    projectId,
                    shotId,
                  })}`,
                )
              })
          }
        } else {
          // Gate-off: the registry's image.generate model.
          panel2Uri = await runImageGenerationWithRecord({
            aspectRatio: resolvedAspectRatio,
            contents: [{ type: 'image_url', imageUrl: panel1Uri }],
            customModel: imageModelForRole('image.generate'),
            imageSize,
            outputPath: path.join('long_take', 'keyframe_expansions', `${shotId}_p2.png`),
            outputUri,
            projectId,
            prompt,
            shotId: `${shotId}_p2`,
            task: 'long-take-keyframe-expansion',
            userId,
          })
        }

        logger.info(
          `[long-take] Keyframe expansion completed ${formatLogFields({
            projectId,
            shotId,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return { panel2Uri, shotId }
      } catch (error) {
        logger.warn(
          `[long-take] Keyframe expansion failed ${formatLogFields({
            projectId,
            shotId,
            err: formatError(error),
          })}`,
        )
        return null
      }
    }),
  )
}
