import type { StoryModeStyleOption } from '@/hooks/useStoryModeConfig'

import type { BrandBriefStyleSnapshot } from './brand-briefs-client'

// Map a brand brief's saved style to a StoryModeStyleOption the style picker can
// render AND apply through the normal path. The option id must be the live style
// id (preset slug / saved-style id) so selecting it resolves and applies exactly
// like picking from "All styles". A legacy snapshot with no ref can't be applied
// by id, so it's dropped (returns null).
export function brandSnapshotToOption(
  snapshot: BrandBriefStyleSnapshot,
): null | StoryModeStyleOption {
  const ref = snapshot.styleRef
  if (!ref) {
    return null
  }
  const id = ref.kind === 'preset' ? ref.presetId : ref.userSavedStyleId
  const preview = snapshot.brand_style_preview_url?.trim()
  return {
    id,
    label: snapshot.style_name ?? 'Brand style',
    scenePreviewUrls: preview ? [preview] : undefined,
    styleText: snapshot.style_text,
    thumbnailUrl: snapshot.style_thumbnail_url ?? '',
  }
}

// The selected brand's styles as applicable picker options (refless legacy
// entries dropped). A brief's style is a POINTER, so when the live style is
// known (`liveById`, keyed by preset slug / saved-style id) prefer it for the
// real name + scene previews -- the embedded snapshot is often sparse (no name
// or preview). Falls back to the snapshot when the live style isn't in the
// catalog (e.g. another user's saved style, or a preset absent from this config).
export function brandStylesToOptions(
  styles: BrandBriefStyleSnapshot[] | undefined,
  liveById?: Map<string, StoryModeStyleOption>,
): StoryModeStyleOption[] {
  if (!styles?.length) {
    return []
  }
  return styles
    .map((snapshot) => {
      const fromSnapshot = brandSnapshotToOption(snapshot)
      if (!fromSnapshot) {
        return null
      }
      return liveById?.get(fromSnapshot.id) ?? fromSnapshot
    })
    .filter((option): option is StoryModeStyleOption => option !== null)
}
