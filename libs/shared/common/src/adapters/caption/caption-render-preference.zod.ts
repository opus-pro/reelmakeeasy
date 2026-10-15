import { z } from 'zod'

import { RenderPreferenceSchema } from './render.zod'

// Caption render preference schema - picks relevant caption-related fields from RenderPreference
export const CaptionRenderReferenceSchema = RenderPreferenceSchema.pick({
  captionAnimation: true,
  captionCustomStyle: true,
  captionPosition: true,
  enableCaption: true,
  enableCaptionAnimation: true,
  enableHighlight: true,
  enableSpeakerDetection: true,
  enableUppercase: true,
  font: true,
  highlightColor: true,
  layoutAspectRatio: true,
  lineCount: true,
  speakersColor: true,
})

export type CaptionRenderReference = z.infer<typeof CaptionRenderReferenceSchema>
