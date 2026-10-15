import type { ActiveModalKind } from '@reelmakeeasy/common/uip/active-modal-kind'

import type { RenderState } from './state-types'

export const DEFAULT_COMPOSER_PLACEHOLDER = 'Chat with ReelMakeEasy'

// Placeholder while a canvas artifact modal is open: the message is an edit to that
// artifact, so the composer asks for edits instead of open-ended chat.
export const EDIT_ARTIFACT_COMPOSER_PLACEHOLDER = 'Describe edits'

// The canvas panes that open an EditArtifactModal, so the composer is editing that
// artifact. 'brand-create' is excluded: it owns its own input (StageTwoBrandDialog) and
// also opens from the legacy planner. 'video' has no edit pane.
const ARTIFACT_EDIT_MODAL_KINDS = new Set<ActiveModalKind>([
  'assets',
  'script',
  'storyboard',
  'summary',
  'voiceover',
])

export function isArtifactEditModalKind(kind: ActiveModalKind): boolean {
  return ARTIFACT_EDIT_MODAL_KINDS.has(kind)
}

// Labels for the AccentTag keyed by canvas panel -- rendered on user
// bubbles (block.sentFrom) and in the composer while that panel's modal is open.
export const MODAL_TAG_LABEL: Record<ActiveModalKind, string> = {
  assets: 'Assets',
  'brand-create': 'Brand',
  script: 'Script',
  storyboard: 'Storyboard',
  summary: 'Summary',
  video: 'Video',
  voiceover: 'Voiceover',
}

export const FONT_FEATURE_SETTINGS = {
  fontFeatureSettings: "'ss01' 1, 'ss03' 1, 'ss04' 1, 'ss06' 1, 'ss08' 1",
} as const

// Confirm gates render in two surfaces: the legacy planner (BottomPanel, must
// stay byte-identical) and canvas mode (ConfirmGateSlot, redesigned).
export type GateVariant = 'canvas' | 'legacy'

export function createEmptyPlannerRenderState(): RenderState {
  return {
    anchorAssetsPool: [],
    assetsPool: [],
    blocks: [],
    expectAssets: false,
    isIdle: false,
    isLocked: false,
    isProcessing: false,
    latest: {},
    phase: 'mode_confirmation',
    queuedMessages: [],
    quickOptions: [],
    staleArtifacts: [],
    status: 'active',
    toolCallStates: [],
    uploadedAssetsPool: [],
  }
}
