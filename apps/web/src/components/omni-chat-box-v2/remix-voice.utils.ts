import type { ProjectVoiceOverJson } from '@shared/types/api/project'

import type { VoiceOption } from '@/components/voice/components/voice-over-selection'

export type CarriedVoiceType = 'attachment' | 'clone-fallback' | 'clone-owned' | 'none' | 'preset'

export function resolveCarriedVoiceType(params: {
  ownsSourceClone?: boolean
  sourceVoice?: null | ProjectVoiceOverJson
}): CarriedVoiceType {
  const { ownsSourceClone = false, sourceVoice } = params

  switch (sourceVoice?.type) {
    case 'voice-cloned': {
      return ownsSourceClone ? 'clone-owned' : 'clone-fallback'
    }
    case 'voice-over': {
      return 'preset'
    }
    case 'voice-over-attachment': {
      return 'attachment'
    }
    default: {
      return 'none'
    }
  }
}

export function resolveRemixVoiceSelection(params: {
  presetVoiceOptions: VoiceOption[]
  sourceVoice?: null | ProjectVoiceOverJson
  voiceCloneOptions: VoiceOption[]
}): {
  carriedVoiceType: CarriedVoiceType
  selectedVoice?: null | VoiceOption
} {
  const { presetVoiceOptions, sourceVoice, voiceCloneOptions } = params

  switch (sourceVoice?.type) {
    case 'voice-cloned': {
      // Only carry the clone if the remixer owns it (appears in their clone
      // list). Otherwise omit `selectedVoice` so the consumer leaves the
      // user's pinned default (hydrated by useVoiceAutoSelect on mount)
      // intact; returning `null` here would wipe it.
      const match = voiceCloneOptions.find((voice) => voice.value === sourceVoice.voiceId)
      return match
        ? { carriedVoiceType: 'clone-owned', selectedVoice: match }
        : { carriedVoiceType: 'clone-fallback' }
    }
    case 'voice-over': {
      const match = presetVoiceOptions.find((voice) => voice.value === sourceVoice.voiceId)
      return match
        ? { carriedVoiceType: 'preset', selectedVoice: match }
        : { carriedVoiceType: 'none' }
    }
    case 'voice-over-attachment': {
      return { carriedVoiceType: 'attachment' }
    }
    default: {
      return { carriedVoiceType: 'none' }
    }
  }
}
