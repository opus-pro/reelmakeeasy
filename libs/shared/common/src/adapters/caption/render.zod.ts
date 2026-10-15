import { z } from 'zod'

// create a schema of RenderPreference
export const AudioMaskStyleSchema = z.enum(['Bleep', 'Mute', 'NotProcessing'])

export const BrollSourceSchema = z.enum(['genAI', 'stock'])

export const BrollConfigSchema = z.object({
  enabled: z.boolean(),
  types: z.array(BrollSourceSchema),
})

export const CanvasStyleSchema = z.object({
  height: z.number(),
  left: z.number(),
  scaleX: z.number(),
  scaleY: z.number(),
  top: z.number(),
  width: z.number(),
})

export const CaptionAnimationNameSchema = z.enum([
  '',
  'baby-earthquake',
  'blur-in',
  'blur-switch',
  'breathe-scale-wiggle',
  'deep-diver',
  'fade',
  'glitch-infinite-zoom',
  'hover',
  'individual-focus',
  'pop',
  'scale',
  'scale-in',
  'seamless-bounce',
  'simple-words-pop',
  'slide-in-from-top',
  'slide-left',
  'slide-up',
  'word-level_highlight_color',
  'word-level_karaoke_bg-highlight',
  'word-level_karaoke_fill-pop',
  'word-level_simple_bg-highlight',
])
export type CaptionAnimationName = z.infer<typeof CaptionAnimationNameSchema>

export const PositionTypeSchema = z.enum(['CPct', 'CPx', 'LTPct', 'LTPx'])

export const DefaultRatioTypeSchema = z.enum([
  '1:1',
  '4:3',
  '4:5',
  '9:8',
  '9:16',
  '16:9',
  'Custom',
  'Original',
])

export const AreaPositionBaseSchema = z.object({
  type: PositionTypeSchema,
})

export const CenterPercentageAreaPositionSchema = AreaPositionBaseSchema.extend({
  defaultRatioType: DefaultRatioTypeSchema.optional(),
  hPct: z.number(),
  wPct: z.number(),
  xPct: z.number(),
  yPct: z.number(),
})

export const CaptionCustomStyleSchema = z.object({
  rect: CenterPercentageAreaPositionSchema.omit({ defaultRatioType: true }).optional(),
  scale: z.number().optional(),
})

export const CaptionMaskStyleSchema = z.enum(['Asterisks', 'Dashes'])

export const CaptionPositionSchema = z.enum(['auto', 'bottom', 'custom', 'middle', 'top'])

export const CurseWordsConfigSchema = z
  .object({
    audioMaskStyle: AudioMaskStyleSchema.optional(),
    captionMaskStyle: CaptionMaskStyleSchema.optional(),
    enabled: z.boolean().optional(),
    libId: z.string().optional(),
  })
  .partial()

export const LayoutAspectRatioTypeSchema = z.enum(['four_five', 'landscape', 'portrait', 'square'])

export const MediaResourceTypeSchema = z.enum(['CustomizedFont', 'UploadMedia'])

export const BrandKitResourceSchema = z.object({
  createdAt: z.string(),
  name: z.string(),
  orgId: z.string(),
  resourceId: z.string(),
  status: z.string(),
  storagePath: z.string(),
  storageSize: z.string(),
  type: MediaResourceTypeSchema,
  updatedAt: z.string(),
  userId: z.string(),
})

export const MediaResourceSchema = BrandKitResourceSchema.extend({
  extra: z.any().optional(),
})

export const MediaTrackResourceSchema = MediaResourceSchema.extend({
  extra: z
    .object({
      duration: z.number().optional(),
      previewPath: z.string(),
      resourceType: z.enum(['audio', 'image', 'video']),
      thumbnailHeight: z.number(),
      thumbnailPath: z.string(),
      thumbnailWidth: z.number(),
      waveformPublicUrl: z.string().optional(),
    })
    .optional(),
})

export const IntroOutroMediaResourceSchema = MediaTrackResourceSchema

export const OverlayFrameBasePositionSchema = z.string() // Simplified, would need actual OverlayFrameBase type

export const QuickStartConfigSchema = z.object({
  bRollParams: z
    .object({
      maxNumber: z.number().optional(),
      type: BrollSourceSchema,
    })
    .optional(),
  enableBonusClip: z.boolean().optional(),
  enableBRoll: z.boolean(),
  enableRemoveFillerWords: z.boolean(),
  enableRemovePauses: z.boolean(),
  enableVoiceEnhancement: z.boolean(),
  enableVoiceover: z.boolean(),
  skipReframe: z.boolean().optional(),
  voiceoverParams: z
    .object({
      narrativeTone: z.string(),
      speaker: z.string(),
      userInput: z.string().optional(),
      volume: z.number(),
      voType: z.enum(['1', '3']),
    })
    .optional(),
})

export const RemoveFillerWordConfigSchema = z.object({
  enabled: z.boolean(),
})

export const RemovePauseConfigSchema = z.object({
  enabled: z.boolean(),
  pauseDuration: z.number().optional(),
})

export const SoundApplyModeSchema = z.enum(['TILE', 'TRUNCATE'])

export const SoundSegmentSchema = z.object({
  durationMs: z.number(),
  storeUrl: z.string().optional(),
  sourceId: z.string(),
  sourceName: z.string(),
  sourcePlatform: z.enum(['MUSIC_LIB', 'UPLOADED']),
  sourceUrl: z.string(),
  speed: z.number(),
  trimmedDurationMs: z.object({
    end: z.number(),
    start: z.number(),
  }),
  volume: z.number(),
  waveformUrl: z.string().optional(),
})

export const SoundConfigSchema = z.object({
  mode: SoundApplyModeSchema,
  segments: z.array(SoundSegmentSchema),
})

export const SpeakerColorSchema = z.object({
  color: z.string(),
  id: z.string(),
  name: z.string(),
})

export const WatermarkTypeSchema = z.enum(['competition'])

export const StoredObjectMetaSchema = z.object({
  displayName: z.string(),
  name: z.string(),
})

export const BrollTriggerSchema = z.any() // Would need actual BrollTrigger type definition

export const RenderPreferenceSchema = z.object({
  broll: BrollConfigSchema.optional(),
  brollTrigger: BrollTriggerSchema.optional(),
  captionAnimation: z
    .object({
      bgColor: z.string().optional(),
      highlightColor: z.string().optional(),
      name: CaptionAnimationNameSchema,
    })
    .optional(),
  captionCustomStyle: CaptionCustomStyleSchema.optional(),
  captionPosition: CaptionPositionSchema.optional(),
  lineCount: z.number().optional(),
  curseWordsConfig: CurseWordsConfigSchema.optional(),
  disableAsd: z.boolean().optional(),
  disableFillLayout: z.boolean().optional(),
  disableFitLayout: z.boolean().optional(),
  disableScreenOverlay: z.boolean().optional(),
  emojiStyle: z
    .object({
      pos: OverlayFrameBasePositionSchema.optional(),
      rect: CenterPercentageAreaPositionSchema.optional(),
      scaleX: z.number().optional(),
      scaleY: z.number().optional(),
    })
    .optional(),

  // Required fields (not marked as optional in the type)
  enableAutoLayout: z.boolean(),
  enableCaption: z.boolean(),
  enableCrop: z.boolean(),
  enableEmoji: z.boolean(),
  enableFillLayout: z.boolean(),
  enableFitLayout: z.boolean(),
  enableFourLayout: z.boolean(),
  enableHighlight: z.boolean(),
  enableScreenLayout: z.boolean(),
  enableSplitLayout: z.boolean(),
  enableThreeLayout: z.boolean(),
  enableUppercase: z.boolean(),
  enableVisualHook: z.boolean(),
  enableWatermark: z.boolean(),
  fitLayoutCropRatio: z.enum(['1:1', '4:3', '']),

  font: z.object({
    color: z.string(),
    family: z.string(),
    id: z.string().optional(),
    name: z.string().optional(),
    numericalSize: z.number().optional(),
    path: z.string().optional(),
    shadow: z.object({
      blur: z.number(),
      color: z.string(),
      enabled: z.boolean(),
      useWordHighlightColor: z.boolean().optional(),
      x: z.number(),
      y: z.number(),
    }),
    size: z.enum(['Large', 'Middle', 'Small']).optional(),
    stroke: z.object({
      color: z.string(),
      enabled: z.boolean(),
      width: z.number(),
    }),
    style: z.array(z.string()),
    textDecoration: z.enum(['', 'line-through', 'underline']),
    type: z.enum(['CustomizedFont', 'System']).optional(),
  }),

  highlightColor: z.object({
    primary: z.string(),
    secondary: z.string(),
  }),

  // Optional fields
  enableAutoTransition: z.boolean().optional(),
  enableBroll: z.boolean().optional(),
  enableCaptionAnimation: z.boolean().optional(),
  enableGameLayout: z.boolean().optional(),
  enableScreenOverlay: z.boolean().optional(),
  enableSpeakerDetection: z.boolean().optional(),
  enableVoiceEnhancement: z.boolean().optional(),
  faceDetectFps: z.number().optional(),
  intro: IntroOutroMediaResourceSchema.optional(),
  layoutAspectRatio: LayoutAspectRatioTypeSchema.optional(),
  outro: IntroOutroMediaResourceSchema.optional(),
  quickstartConfig: QuickStartConfigSchema.optional(),
  reduceFakeFace: z.boolean().optional(),
  refineTurboMode: z.boolean().optional(),
  removeFillerWord: RemoveFillerWordConfigSchema.optional(),
  removePause: RemovePauseConfigSchema.optional(),
  renderSkipAdobe: z.boolean().optional(),
  sceneDetThresh: z.number().optional(),
  screenOverlay: StoredObjectMetaSchema.nullable().optional(),
  screenOverlayFileId: z.string().nullable().optional(),
  screenOverlays: z
    .array(
      z.object({
        object: StoredObjectMetaSchema,
        rect: CenterPercentageAreaPositionSchema.optional(),
        style: CanvasStyleSchema.optional(),
        timelines: z
          .tuple([
            z.object({
              in: z.number(),
              out: z.number(),
            }),
          ])
          .optional(),
      }),
    )
    .optional(),
  selectedTransitions: z.array(z.string()).optional(),
  skipReframe: z.boolean().optional(),
  skipRender: z.boolean().optional(),
  sound: SoundConfigSchema.optional(),
  speakersColor: z.array(SpeakerColorSchema).optional(),
  trackingParams: z
    .object({
      expGroup: z.string().optional(),
      ref: z
        .object({
          bbox: CenterPercentageAreaPositionSchema,
          refOffsetMs: z.number(),
        })
        .optional(),
    })
    .optional(),
  useEditingScriptCache: z.boolean().optional(),
  watermarkType: WatermarkTypeSchema.optional(),
})

export type RenderPreference = z.infer<typeof RenderPreferenceSchema>
