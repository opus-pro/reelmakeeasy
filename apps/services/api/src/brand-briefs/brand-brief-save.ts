/**
 * Outcome of a "Confirm + Save" request, surfaced to the UI for a toast or
 * disabled state. Saved brands are off, so a confirm never persists a brief and
 * always reports `skipped`; the other values remain part of the response
 * contract the web client understands.
 */
export type BriefSaveResult = 'failed' | 'saved' | 'skipped' | 'updated'

// Reference to the source style a brief entry points at: a preset (FE code
// constant, by slug) or a user custom style (UserSavedStyle ObjectId). The brief
// follows the library -- a deleted custom style drops out of the brief on read.
// Discriminated because the two id namespaces (preset slug vs ObjectId) differ.
export type BrandBriefStyleRef =
  | { kind: 'custom'; userSavedStyleId: string }
  | { kind: 'preset'; presetId: string }
