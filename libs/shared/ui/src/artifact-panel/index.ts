// Artifact panel chrome: its own entry (`@shared/ui/artifact-panel`), separate from
// `chat` (conversational-turn primitives -- messages, composer, status). This folder is for the
// side panel that displays generated output (video, script, voiceover) next to a chat, not the
// chat itself.

export { MediaCard, MediaGrid } from './MediaGrid'
export { MediaPreviewTooltip } from './MediaPreviewTooltip'
export { OutdatedCollapsedHeader } from './OutdatedCollapsedHeader'
export { OutdatedCollapseToggle } from './OutdatedCollapseToggle'
export { UpdatedStatusBadge } from './UpdatedStatusBadge'
