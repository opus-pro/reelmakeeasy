/**
 * Which canvas artifact Edit modal was open when a user message was sent.
 * Single source of truth for both the frontend
 * (`ActiveModal['kind']` in `apps/web/.../state/atoms/planner.ts`) and the
 * backend (`Message.sent_from` in `libs/uip-planner-runtime/src/types.ts`,
 * validated via `@IsIn` in `uip.dto.ts`) -- moved here so drift
 * between the two is a type error instead of a convention.
 * Safe in workflow code: importable as a value from `@reelmakeeasy/common` without
 * pulling in `@reelmakeeasy/uip-planner-runtime`'s Node-only runtime.
 */
export const ACTIVE_MODAL_KIND_VALUES = [
  'assets',
  'brand-create',
  'script',
  'storyboard',
  'summary',
  'video',
  'voiceover',
] as const

export type ActiveModalKind = (typeof ACTIVE_MODAL_KIND_VALUES)[number]
