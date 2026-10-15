import * as fs from 'node:fs'
import * as path from 'node:path'

import { logger } from '@reelmakeeasy/common/logger'
import { CODEGEN_LAYOUT_ID, remotionType } from '@reelmakeeasy/common/template/consts'
import { LottieSeg, RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import { isDev } from '@reelmakeeasy/common/utils/env'
import { getProjectPath, getProjectRoot } from '@reelmakeeasy/common/utils/getProjectRoot'
import { RenderVideoParams } from '@reelmakeeasy/common/workflow/workflow/render/types'

import { renderPlanFrameWithFfmpeg, renderPlanWithFfmpeg } from './render-plan-ffmpeg'
import { logRenderPlan } from './render-plan-log'

/** Render plans are drawn with local ffmpeg. */
interface RenderVideoOptions {
  config: RenderVideoParams
  projectId: string
  /** Time range for chunked rendering in milliseconds [start, end] */
  segmentTimeRange?: [number, number]
  videoId: string
}

async function readRenderPlan(renderPlanPath: string): Promise<RenderPlan> {
  return JSON.parse(await fs.promises.readFile(renderPlanPath, 'utf8')) as RenderPlan
}

/**
 * The absolute path of a project file, for the render plan's root directory
 * @param filePath The file path, absolute or relative to the project root
 * @returns The absolute path
 */
export function getRenderPlanAbsolutePath(filePath: string): string {
  return path.resolve(getProjectRoot(), filePath)
}
/** Writable render outputs. */
export const renderOutputPath = 'apps/services/api/dist/render'
export function getRenderOutputPath(videoId: string) {
  return getProjectPath(renderOutputPath, videoId)
}

export function getRenderPlanRelativePath(filePath: string, videoId: string) {
  return filePath.split(`${videoId}/`)[1] || path.basename(filePath)
}

/**
 * Renders one frame of a render plan.
 * @param options The render options
 * @returns The output path of the rendered image
 */
export async function renderPlanImage(
  options: RenderVideoOptions & { time: number },
): Promise<{ imageUri: string }> {
  const { outputDir, renderPlanPath, cleanupRenderPlan } = await prepareAvEnginePlan(options)
  const outputImagePath = getProjectPath(outputDir, `${options.videoId}.png`)
  try {
    logger.info('Using local ffmpeg for image rendering')
    await renderPlanFrameWithFfmpeg({
      mediaDir: outputDir,
      outputPath: outputImagePath,
      plan: await readRenderPlan(renderPlanPath),
      timeMs: options.time,
    })
    return { imageUri: outputImagePath }
  } finally {
    if (!isDev()) {
      cleanupRenderPlan()
    }
  }
}

/**
 * Renders a render plan to video.
 * @param options The render options
 * @returns The output path of the rendered video
 */
export async function renderPlanVideo(options: RenderVideoOptions): Promise<string> {
  const { outputDir, renderPlanPath, cleanupRenderPlan } = await prepareAvEnginePlan(options)

  const outputVideoPath = getProjectPath(outputDir, 'av-engine.mp4')

  // Determine build range: use segmentTimeRange if provided, otherwise render full video
  const buildRange = options.segmentTimeRange
    ? `${options.segmentTimeRange[0]}-${options.segmentTimeRange[1]}`
    : '0-0' // '0-0' means render full video

  const isChunkedRender = !!options.segmentTimeRange

  try {
    logger.info({ buildRange, isChunkedRender }, 'Using local ffmpeg for video rendering')
    return await renderPlanWithFfmpeg({
      mediaDir: outputDir,
      outputPath: outputVideoPath,
      plan: await readRenderPlan(renderPlanPath),
      timeRangeMs: options.segmentTimeRange,
    })
  } finally {
    if (!isDev()) {
      cleanupRenderPlan()
    }
  }
}

async function createTempConfigFile(
  config: unknown,
  videoId: string,
): Promise<{
  cleanup: () => void
  path: string
}> {
  const configPath = getProjectPath('dist/apps/public', `config-${videoId}.json`)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  await fs.promises.writeFile(configPath, JSON.stringify(config, null))
  return {
    cleanup: () => {
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath)
      }
    },
    path: configPath,
  }
}

/**
 * Writes the render plan the renderer reads. Template segments that needed the
 * retired Remotion or codegen pipelines (no live producer emits them) are
 * dropped rather than handed to a renderer that cannot draw them.
 */
async function prepareAvEnginePlan(options: RenderVideoOptions & { time?: number }): Promise<{
  cleanupRenderPlan: () => void
  outputDir: string
  renderPlanPath: string
}> {
  const { config, videoId } = options
  const renderPlan = config.renderPlan
  if (!renderPlan) {
    throw new Error('renderPlan is required on input config')
  }
  const unsupportedLayoutIds = [CODEGEN_LAYOUT_ID, ...remotionType]
  for (const track of renderPlan.tracks) {
    const kept = track.segs.filter(
      (seg) => !('layoutId' in seg && unsupportedLayoutIds.includes((seg as LottieSeg).layoutId)),
    )
    if (kept.length !== track.segs.length) {
      logger.warn(
        { dropped: track.segs.length - kept.length, trackId: track.id, videoId },
        '[render] Dropping Remotion/codegen template segments; they are no longer rendered',
      )
      track.segs = kept
    }
  }

  logRenderPlan('final RenderPlan', renderPlan)

  const { cleanup: cleanupRenderPlan, path: renderPlanPath } = await createTempConfigFile(
    renderPlan,
    `render-plan-${videoId}`,
  )
  return { cleanupRenderPlan, outputDir: getRenderOutputPath(videoId), renderPlanPath }
}
