import { z } from 'zod'

import type { GeminiVisionParams, JudgeVersion } from '../../types'

export const orientationV1: JudgeVersion<GeminiVisionParams> = {
  params: {
    mapResult: (raw) => ({ pass: raw['upside_down'] !== true }),
    model: 'gemini-3-flash-preview',
    prompt:
      'Analyze this image orientation. Is the image upside down (rotated 180 degrees)? ' +
      'Look at text, faces, objects, horizon lines, and gravity cues.',
    responseSchema: z.object({
      upside_down: z.boolean(),
    }),
  },
  rubricId: 'orientation',
  runner: 'gemini-vision-v1',
  thresholds: { pass: 4 },
  version: 'v1',
}
