import type {
  WriteV3PlaygroundManifestActivityParams,
  WriteV3PlaygroundManifestActivityResult,
} from '../../workflows/long-take/types'
import { formatLogFields, logger, withActivityHeartbeat } from '../long-take/common'
import { createLongTakeStorage } from '../long-take/storage'

export const V3_PLAYGROUND_MANIFEST_PATH = 'story_mode_3_playground/manifest.json'

/**
 * The run's own record: what it compared, what it produced, and where every
 * intermediate artifact landed.
 *
 * Written into the SHADOW project's prefix rather than a synthetic
 * `projects/story-mode-3-playground/<baseline>/<run>/` one, for two reasons. `ProjectStore`
 * hard-codes its root to `projects/<projectId>`, and passing a slashed composite id to
 * get a nested prefix would make that string the pipeline's projectId everywhere
 * -- Mongo lookups, tracking, accounting. And the shadow project id already IS
 * the run id, so one id resolves the storage, the project row and the manifest.
 */
export async function writeV3PlaygroundManifest(
  params: WriteV3PlaygroundManifestActivityParams,
): Promise<WriteV3PlaygroundManifestActivityResult> {
  const { baselineProjectId, baselineShotCount, error, shadowProjectId, startedAt, status } = params
  return withActivityHeartbeat(async () => {
    const storage = createLongTakeStorage(shadowProjectId)
    const manifest = {
      // Only the ids and counts live here. Both delivered videos are addressed
      // by `Project.resultVideo` on their own rows, so the API resolves them at
      // read time rather than the manifest pinning a path that may not be where
      // the render actually landed (upscale and watermark paths differ).
      baseline: {
        projectId: baselineProjectId,
        shotCount: baselineShotCount,
      },
      ...(error ? { error } : {}),
      finishedAt: new Date().toISOString(),
      run: {
        artifacts: {
          clipPrompts: 'long_take_v3/clip_prompts.json',
          keyframePrompts: 'long_take/keyframe_prompts.json',
          shotTimes: 'long_take_v3/shot_times.json',
          visualScript: 'long_take/visual_script.json',
        },
        projectId: shadowProjectId,
        shotCount: params.shotCount,
        ...(params.videoUri ? { videoUri: params.videoUri } : {}),
      },
      startedAt,
      status,
      version: 1,
    }

    await storage.ensureDir('story_mode_3_playground')
    await storage.writeJsonFile(V3_PLAYGROUND_MANIFEST_PATH, manifest)
    logger.info(
      `[sm3-playground] Manifest written ${formatLogFields({
        baselineProjectId,
        shadowProjectId,
        status,
      })}`,
    )
    return { manifestPath: V3_PLAYGROUND_MANIFEST_PATH }
  })
}
