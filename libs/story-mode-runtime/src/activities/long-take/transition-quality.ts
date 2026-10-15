import * as fs from 'node:fs'
import * as path from 'node:path'

import { v4 as uuidV4 } from 'uuid'

import type {
  LongTakeTextSeverity,
  LongTakeTransitionAttemptRecord,
} from '../../workflows/long-take/transition-types'

import { formatError, formatLogFields, logger } from './common'
import { analyzeTextQuality, extractMiddleFrame, type TextQualityAnalysis } from './text-quality'

export const MAX_QUALITY_ATTEMPTS = 3

export function areAllAttemptsBlackScreen(attempts: LongTakeTransitionAttemptRecord[]): boolean {
  return attempts.length > 0 && attempts.every((attempt) => attempt.isBlackScreen)
}

export async function checkTransitionVideoTextQuality(
  videoPath: string,
  tempDir: string,
): Promise<TextQualityAnalysis> {
  const framePath = path.join(tempDir, `quality-check-${uuidV4()}.jpg`)
  try {
    await extractMiddleFrame(videoPath, framePath)
    const frameBuffer = await fs.promises.readFile(framePath)
    const imageUrl = `data:image/jpeg;base64,${frameBuffer.toString('base64')}`
    return await analyzeTextQuality(imageUrl)
  } finally {
    await fs.promises.rm(framePath, { force: true }).catch(() => undefined)
  }
}

export function evaluateQualityCheckResults(params: {
  attempt: number
  blackScreenResult: PromiseSettledResult<{
    bytesPerFrame: number | undefined
    isBlackScreen: boolean
  }>
  currentPrompt: string
  keepPromptUnchanged?: boolean
  projectId: string
  resolvedPrompt: string
  textResult: PromiseSettledResult<TextQualityAnalysis>
  transitionId: string
}) {
  const {
    attempt,
    blackScreenResult,
    currentPrompt,
    keepPromptUnchanged,
    projectId,
    resolvedPrompt,
    textResult,
    transitionId,
  } = params
  let qualityPassed = true
  let severity: LongTakeTextSeverity = 'none'
  let isBlackScreen = false
  let bytesPerFrame: number | undefined
  let updatedPrompt = currentPrompt

  if (blackScreenResult.status === 'fulfilled') {
    isBlackScreen = blackScreenResult.value.isBlackScreen
    bytesPerFrame = blackScreenResult.value.bytesPerFrame
    if (isBlackScreen) {
      qualityPassed = false
      logger.warn(
        `[long-take] Black screen detected in transition attempt ${attempt}/${MAX_QUALITY_ATTEMPTS} ${formatLogFields({ projectId, transitionId, bytesPerFrame })}`,
      )
    }
  } else {
    logger.warn(
      `[long-take] Black screen check failed, proceeding ${formatLogFields({ projectId, transitionId, attempt, err: formatError(blackScreenResult.reason) })}`,
    )
  }

  if (textResult.status === 'fulfilled') {
    if (textResult.value.hasGibberish) {
      qualityPassed = false
      severity = textResult.value.severity
      logger.warn(
        `[long-take] Gibberish text detected in transition attempt ${attempt}/${MAX_QUALITY_ATTEMPTS} ${formatLogFields({ projectId, transitionId, severity, distortionTypes: textResult.value.distortionTypes.join(',') })}`,
      )
      if (!keepPromptUnchanged) {
        updatedPrompt = buildRetryPromptWithQualityHint(resolvedPrompt, textResult.value)
      }
    }
  } else {
    logger.warn(
      `[long-take] Quality check failed, proceeding with result ${formatLogFields({ projectId, transitionId, attempt, err: formatError(textResult.reason) })}`,
    )
  }

  return { bytesPerFrame, currentPrompt: updatedPrompt, isBlackScreen, qualityPassed, severity }
}

function buildRetryPromptWithQualityHint(
  basePrompt: string,
  analysis: TextQualityAnalysis,
): string {
  const issues =
    analysis.distortionTypes.length > 0 ? analysis.distortionTypes.join(', ') : analysis.description
  return `${basePrompt}\n\nIMPORTANT: The previous attempt had text rendering issues (${issues}). Keep the camera continuously moving through any text regions — do NOT hold or zoom into text, as this causes characters to distort during AI interpolation.`
}
