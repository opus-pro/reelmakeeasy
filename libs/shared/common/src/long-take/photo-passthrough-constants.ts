// Tag on a keyframe that IS the raw source photo composited verbatim (no
// image-model generation). Lives in its own dependency-free module (rather
// than only in photo-passthrough.ts) so the api scope, which may not import
// @reelmakeeasy/story-mode-runtime, can filter these slots out of its own preflight
// without re-declaring the string literal.
export const PHOTO_PASSTHROUGH_IMAGE_MODEL = 'photo-passthrough'
