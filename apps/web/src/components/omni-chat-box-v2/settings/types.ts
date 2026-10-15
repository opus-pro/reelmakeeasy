import type { AspectRatio } from '@reelmakeeasy/common/media/types'

export type { SourceFilterSettings } from '../../source-filter/SourceFilterDialog'
import type { SourceFilterSettings } from '../../source-filter/SourceFilterDialog'
import type { VoiceOption } from '../../voice/components/voice-over-selection'

export type CaptionEntry = {
  disabled?: boolean
  enabled: boolean
  onChange: (enabled: boolean) => void
  type: 'caption'
}

export type DrawerView = 'caption' | 'main' | 'ratio' | 'source-filter' | 'voice'

export type RatioEntry = {
  /** When true, all aspect ratios (9:16, 16:9, 1:1) are enabled. When false, only 9:16 is enabled. */
  enableAllRatios?: boolean
  onChange: (value: AspectRatio) => void
  type: 'ratio'
  value: AspectRatio
}

export interface SettingsDropdownMenuProps {
  disabled?: boolean
  entries: SettingsEntry[]
  variant: 'drawer' | 'popover'
}

export type SettingsEntry = CaptionEntry | RatioEntry | SourceFilterEntry | VoiceEntry

export type SourceFilterEntry = {
  applied: boolean
  disabled?: boolean
  onSave: (settings: SourceFilterSettings) => void
  type: 'source-filter'
}

export type VoiceEntry = {
  disabled?: boolean
  displayName: string
  onApply: (voice: null | VoiceOption) => void
  selectedVoiceId: null | string
  type: 'voice'
}
