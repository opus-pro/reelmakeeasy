// Chat composites: their own entry (`@shared/ui/chat`), NOT re-exported from the package
// barrel, so the default entry stays lean and this surface is tree-shakeable. Presentational only:
// normalized props in, rendered output out. Each product adapts its own protocol to these props.

export { AgentStatusLine } from './AgentStatusLine'
export { AgentThinkingIcon } from './AgentThinkingIcon'
export { AttachButton, ATTACHMENT_ACCEPT } from './AttachButton'
export { type AttachmentChip, AttachmentChips } from './AttachmentChips'
export { AttachmentFileIcon, mimeTypeLabel } from './AttachmentFileIcon'
export { Composer, ComposerOptionsHint } from './Composer'
export { MESSAGE_BUBBLE_TONE_CLASS, MessageBubble, type MessageBubbleTone } from './MessageBubble'
export { QaRecap } from './QaRecap'
export { QuestionCard, type QuestionCardProps } from './QuestionCard'
export { useElapsedSec } from './useElapsedSec'
