// Leaf module holding only the meta-tag regex, with no React/Lexical imports.
// Extracted from MetaTagNode.tsx so non-UI code (and unit tests) can reuse the
// canonical pattern without pulling in the editor's heavy dependency graph.
// MetaTagNode.tsx re-exports this so every existing importer keeps working.
//
// format: @vo[$title]($resourceId) or @vo[$title]($resourceId|metadata)
// resourceId can be one of three formats:
// 1. pasted://[uuid] - for pasted files (36-char UUID with dashes)
// 2. https?://... - for URL resources (stops at ) or |)
// 3. {fileName}-{md5hash} - for uploaded files (32-char hex MD5 suffix)
// Capture groups: [1]=resourceType, [2]=title, [3]=resourceId, [4]=metadata (optional)
//
// The metadata (previewUrl) group uses (?:[^()]|\([^)]*\))* instead of [^)]* so
// that CDN URLs containing literal "(1)" in the path (e.g. from video filenames
// like "My-Song (1).mp4") don't terminate the match prematurely and cause the
// whole tag to render as raw text or bypass the brand-URL strip in auto-brand-extraction.
export const META_TAG_REGEX =
  /@(vo|img|video|audio|txt|pdf|file|shot)\[((?:\[[^[\]\n]*\]|[^\]\n])*)\]\((pasted:\/\/[a-f0-9-]{36}|https?:\/\/[^)|]+|.+?-[a-f0-9]{32}|[^)|]+)(?:\|((?:[^()]|\([^)]*\))*))?\)/
