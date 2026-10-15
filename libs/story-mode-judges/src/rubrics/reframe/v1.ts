import { z } from 'zod'

import type { GeminiVisionParams, JudgeVersion } from '../../types'

const REFRAME_PROMPT = `\
Does this image show **mechanical reframing** - where a video/image originally composed at one \
aspect ratio has been forcefully adapted into a different aspect ratio by adding padding?

The ONLY things that count as reframing are **padding artifacts** added to fill space during \
aspect-ratio conversion:
- **Blurred/bokeh bars**: top & bottom (or left & right) filled with a heavily blurred, \
zoomed-in copy of the main content - this is the most common reframe artifact.
- **Solid color bars**: black, white, or single-color strips padding the frame.
- **Gradient bars**: smooth color gradients filling the padding area.

These padding bars are always **uniform, repetitive, and content-free** - they exist only to \
fill the gap between the original aspect ratio and the target frame.

Everything else is NOT reframing, including:
- Screens, monitors, tablets, phones, or picture frames **depicted within the scene** - these \
are narrative content, not aspect-ratio conversion.
- UI overlays, HUDs, data dashboards, or game interfaces - these are stylistic design.
- Decorative borders, illustration frames, or hand-drawn outlines - these are artistic choices.
- Editorial layouts, collages, infographics, or typographic designs.
- Multi-panel story compositions or storyboard-style frames.
- Natural depth-of-field blur, vignetting, or cinematic black bars.
- Dark/plain backgrounds or margins that are part of the original composition.

When in doubt, answer false. Only answer true if you see obvious blurred/solid/gradient \
padding bars that are clearly mechanical artifacts of aspect-ratio conversion.

Reply with ONLY a JSON object: {"reframe": true} or {"reframe": false}`

export const reframeV1: JudgeVersion<GeminiVisionParams> = {
  params: {
    mapResult: (raw) => ({ pass: raw['reframe'] !== true }),
    model: 'gemini-3-flash-preview',
    prompt: REFRAME_PROMPT,
    responseSchema: z.object({
      reframe: z.boolean(),
    }),
  },
  rubricId: 'reframe',
  runner: 'gemini-vision-v1',
  thresholds: { pass: 4 },
  version: 'v1',
}
