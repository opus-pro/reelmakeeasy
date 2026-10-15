import type { AspectRatio } from '@reelmakeeasy/common/media/types'

import type { ApplyLongTakeTemplatePayload, ApplyQuickStartTemplatePayload } from '@/atom/home'
import type { CreateUseCaseKey } from '@/constants/create-use-cases'
import type { UserSavedStyleInputMode } from '@/hooks/useUserSavedStyles'

import type { ChatBoxState } from './state/chatbox-state'
import type { AnchorAssetCategory } from './anchor-assets'
import type { SettingsEntry } from './settings'

export type { AspectRatio }

export type AsyncStatus = 'error' | 'idle' | 'pending' | 'ready'

export type CommittedCustomStoryStyle = {
  imageDataUrl?: string
  isSavedStyle?: boolean
  previewUrl?: null | string
  styleInputMode: UserSavedStyleInputMode
  styleName?: string
  styleText: string
}

export type OmniBoxSettings = {
  aspectRatio: AspectRatio
  // Whether the box is in the Story Mode (long-take) layout. The mobile create
  // sheet renders its own chrome outside the box and has to know which controls
  // apply. Only long-take
  // creations carry a background-music choice.
  isStoryModeLayout?: boolean
  selectedVoiceId?: null | string
  showCaptions: boolean
  storyModeStyleId: string
}

export interface OmniChatBoxProps {
  autoFocus?: boolean
  className?: string
  defaultMessage?: string
  disabled?: boolean
  onBeforeSubmit?: () => void
  onClick?: (e: React.MouseEvent) => void
  onSettingsChange?: (settings: OmniBoxSettings) => void
  /** Page-specific placeholder text */
  pageType?: 'story-mode'
  placeholder?: string
  textareaClassName?: string
  /** Currently selected create use case; drives use-case-specific omnibox states (e.g. song upload). */
  useCaseKey?: CreateUseCaseKey
}

export interface OmniChatBoxRef {
  applyLongTakeTemplate: (payload: ApplyLongTakeTemplatePayload) => void
  applyQuickStartTemplate: (payload: ApplyQuickStartTemplatePayload) => void
  focusEditor: () => void
  getState: () => ChatBoxState
  /**
   * Opens a settings entry programmatically. Only wired for the drawer
   * (mobile) variant; on the popover (desktop) variant this is a no-op, since
   * the popover has no programmatic open. See settings/index.tsx.
   */
  openSettingsEntry: (type: SettingsEntry['type']) => void
  setAspectRatio: (ratio: AspectRatio) => void
  setShowCaptions: (value: boolean) => void
  submit: () => void
}

export type ProcessFilesOptions = {
  /**
   * The files came through the Assets surface (AddAssetsDialog / anchor-asset
   * slots), which takes images only. Generic inputs and drag-drop leave this
   * unset, keeping their video-as-audio confirm flow.
   */
  fromAssetsSurface?: boolean
  imageCategory?: AnchorAssetCategory
  /**
   * Insert the editor meta-tag programmatically (no caret move / focus), so an
   * upload triggered by tapping a card (e.g. the mobile Song card) doesn't focus
   * the textarea or enter compose mode. Defaults to a user-initiated insert.
   */
  programmaticEditorInsert?: boolean
}

export type ScriptPreviewSource = 'audio_transcript' | 'prompt_generated'
