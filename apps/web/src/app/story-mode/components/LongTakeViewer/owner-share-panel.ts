import type { StoryModeShareActionSource } from '@/hooks/useStoryModeShareActions'

/**
 * Whether the owner share panel -- which mints a SharedProject row, copies
 * `/share/<sharedProjectId>` and exposes the public/private toggle -- may stand
 * in for the plain copy-this-URL button.
 *
 * Never on a demo page. A demo is shared by the gallery URL it is open at, and
 * that is exactly what `handleShare` copies for `demo_page`; the owner panel
 * would hand out a link to the underlying project instead and let the viewer
 * flip its access level. `isOwner` on a demo resolves from the demo's own
 * projectId, so without this the internal account that owns the row is the one
 * account that gets the wrong panel.
 *
 * Type-only import on purpose: this module has no runtime dependency on the
 * share-actions hook, so surfaces that mock that hook still get the real gate.
 */
export function canUseOwnerSharePanel(
  isOwner: boolean,
  source: StoryModeShareActionSource,
): boolean {
  return isOwner && source !== 'demo_page'
}
