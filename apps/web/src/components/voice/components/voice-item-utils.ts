import { formatVoiceSpeedLabel } from '@shared/types/api/voice-over-metadata'
import { cn } from '@shared/ui'

import { type VoiceOption } from './voice-over-selection'

interface VoiceRowClassNameParams {
  isInactive?: boolean
  isMenuHovered: boolean
  isSelected?: boolean
  showHover: boolean
}

export function getVoiceRowClassName({
  isInactive,
  isMenuHovered,
  isSelected,
  showHover,
}: VoiceRowClassNameParams): string {
  return cn(
    'flex items-center gap-3 p-3 md:py-2.5 rounded-xl self-stretch relative transition-colors',
    showHover && 'cursor-pointer',
    showHover && !isMenuHovered && 'md:hover:bg-fill-hover',
    isSelected && !isInactive && 'bg-fill-hover',
    isInactive && 'cursor-not-allowed',
    !showHover && !isInactive && 'cursor-default',
  )
}

function formatVoiceCloneDate(createdAt?: string): string {
  if (!createdAt) {
    return ''
  }
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) {
    return ''
  }
  return date.toLocaleDateString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

// Single right-aligned descriptor: tone for presets, creation date for the
// user's own voice clones, nothing for auto-select.
export function getVoiceSideLabel(voice: VoiceOption, isAutoSelect: boolean): string {
  if (isAutoSelect) {
    return ''
  }
  if (voice.voiceCloneId) {
    return formatVoiceCloneDate(voice.createdAt)
  }
  return voice.tone ?? ''
}

// Full descriptor built from the voice's labels (skipping the leading language
// label) plus the speed label, joined into a single line.
export function getVoiceDescription(voice: VoiceOption, isAutoSelect: boolean): string {
  const labels = isAutoSelect ? (voice.labels ?? []) : (voice.labels?.slice(1) ?? [])
  return [...labels, ...(voice.speed ? [formatVoiceSpeedLabel(voice.speed)] : [])].join(' · ')
}

// The label shown under the voice name in a list row. The transcript card opts
// into the single tone/date descriptor; every other surface shows the full
// description.
export function getVoiceRowLabel(
  voice: VoiceOption,
  isAutoSelect: boolean,
  showToneLabel: boolean,
): string {
  return showToneLabel
    ? getVoiceSideLabel(voice, isAutoSelect)
    : getVoiceDescription(voice, isAutoSelect)
}
