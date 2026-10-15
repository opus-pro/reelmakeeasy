// TODO: z.ZodEnum<[EmbeddedBlockType]> ??
export const EMBEDDED_BLOCK = {
  ATTACHMENT: 'embedded-attachment',
  NEED_APPROVE: 'embedded-need-approve',
  SOURCE: 'embedded-source',
  STORYBOARD: 'embedded-storyboard',
  TRANSCRIPT: 'embedded-transcript',
  VIDEO: 'embedded-video',
  VIDEO_PLAN: 'embedded-video-plan',
  VIRAL_HOOK: 'embedded-viral-hook',
} as const
export type EMBEDDED_BLOCK_TYPE = typeof EMBEDDED_BLOCK
export type EmbeddedBlockType = (typeof EMBEDDED_BLOCK)[keyof typeof EMBEDDED_BLOCK]
