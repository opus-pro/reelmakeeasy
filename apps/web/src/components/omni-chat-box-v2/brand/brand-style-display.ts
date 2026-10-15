import type { BrandBriefStyleSnapshot } from './brand-briefs-client'

export interface BrandStyleDisplay {
  styleName?: string
  styleText?: string
  thumbnailUrl?: string
}

// The fields the resolver needs off the live style a ref points at -- a custom
// UserSavedStyle or a preset catalog entry. The hook supplies whichever applies;
// this stays kind-agnostic so the lookup source lives in one place (the hook).
export interface ResolvedRefStyle {
  styleName?: string
  styleText?: string
  thumbnailUrl?: null | string
}

/**
 * What a brand's style should render/seed as. A brief's style is a pointer, so
 * prefer the resolved live style (custom or preset) for name/text/thumbnail so a
 * later edit, rename, or delete propagates. The embedded snapshot is only a
 * fallback -- while a custom ref is still loading, or for a legacy brief that
 * has no ref. Returns null when there is no style at all.
 */
export function resolveBrandStyleDisplay(
  styleCarry: BrandBriefStyleSnapshot | null,
  resolvedRefStyle?: null | ResolvedRefStyle,
): BrandStyleDisplay | null {
  if (!styleCarry) {
    return null
  }
  const snapshot: BrandStyleDisplay = {
    styleName: styleCarry.style_name,
    styleText: styleCarry.style_text,
    thumbnailUrl: styleCarry.style_thumbnail_url,
  }
  if (styleCarry.styleRef && resolvedRefStyle) {
    return {
      styleName: resolvedRefStyle.styleName ?? snapshot.styleName,
      styleText: resolvedRefStyle.styleText ?? snapshot.styleText,
      thumbnailUrl: resolvedRefStyle.thumbnailUrl ?? snapshot.thumbnailUrl,
    }
  }
  return snapshot
}

/**
 * The values the Style tile should render: the user's committed style if they
 * have one, otherwise the selected brand's default style as a fallback. An
 * explicit pick always wins (and the brand look still seeds the session via
 * styleCarry regardless of what the tile shows). Kept pure so the component
 * stays simple and this stays unit-tested.
 */
export function buildStyleTileDisplay(
  committedStyle: null | { styleName?: string; styleText?: string },
  committedThumbnailUrl: string | undefined,
  brandFallback: BrandStyleDisplay | null,
): BrandStyleDisplay {
  if (committedStyle) {
    return { styleText: committedStyle.styleText, thumbnailUrl: committedThumbnailUrl }
  }
  return {
    styleName: brandFallback?.styleName,
    styleText: brandFallback?.styleText,
    thumbnailUrl: committedThumbnailUrl ?? brandFallback?.thumbnailUrl,
  }
}
