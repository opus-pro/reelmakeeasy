'use client'

import { useCallback, useEffect, useRef } from 'react'

import type { VoiceOption } from '@/components/voice/components/voice-over-selection'

const autoSelectVoiceOption: VoiceOption = {
  value: 'auto-select',
  name: 'Auto-select',
  labels: ['A preset voice will be chosen automatically'],
  color: 'radial-gradient(circle at 30% 30%, #E8E8E8, #C0C0C0, #A8A8A8)',
}

export { autoSelectVoiceOption }

/**
 * The voice catalog is "ready" only when every source has settled
 * successfully: presets loaded and clones loaded.
 * Until then the aggregate voice options may be empty or partial and must not
 * drive the "selected voice no longer exists" reset.
 */
export const isVoiceCatalogReady = ({
  isLoadingPresetVoices,
  isLoadingUserVoices,
  presetVoicesFailed,
  userVoicesFailed,
}: {
  isLoadingPresetVoices: boolean
  isLoadingUserVoices: boolean
  presetVoicesFailed: boolean
  userVoicesFailed: boolean
}): boolean =>
  !isLoadingPresetVoices && !presetVoicesFailed && !isLoadingUserVoices && !userVoicesFailed

/**
 * Manages automatic voice selection on mount and resets a selection that disappears.
 *
 * Responsibilities:
 * - Resolves the initial voice from localStorage (pinned or last-used).
 * - Auto-loads the resolved voice once when the component mounts.
 * - Resets the voice to "Auto-select" when the current selection no longer
 *   exists in the catalog.
 *
 * `catalogReady` must be true only once every voice source has settled
 * successfully (presets loaded, clones loaded or intentionally disabled). The reset effect is gated on it so a transient empty /
 * partial / errored options list is never misread as "voice no longer exists"
 * (which would silently demote a committed selection to Auto-select).
 */
export function useVoiceAutoSelect({
  catalogReady,
  selectedVoice,
  setSelectedVoice,
  voiceOptions,
}: {
  catalogReady: boolean
  selectedVoice: null | VoiceOption
  setSelectedVoice: (voice: null | VoiceOption) => void
  voiceOptions: VoiceOption[]
}) {
  const hasAutoLoadedVoiceRef = useRef(false)

  // Resolve the initial voice from a stored pin (defaultVoiceId / lastUsedVoiceId).
  //
  // `pinPending` is true when a pin IS stored but is not (yet) present in
  // `options` -- i.e. the catalog is still partial. Callers should wait rather
  // than latch onto Auto-select, which would silently demote a stored
  // preference once the rest of the catalog arrives. A pin that is
  // present, or no pin at all, is a settled answer
  // (`pinPending: false`).
  const resolveInitialVoice = useCallback(
    (options: VoiceOption[]): { pinPending: boolean; voice: VoiceOption } => {
      if (typeof window === 'undefined') {
        return { pinPending: false, voice: autoSelectVoiceOption }
      }

      const defaultVoiceId = localStorage.getItem('defaultVoiceId')
      if (defaultVoiceId) {
        const defaultVoice = options.find((v) => v.value === defaultVoiceId)
        if (!defaultVoice) {
          return { pinPending: true, voice: autoSelectVoiceOption }
        }
        return {
          pinPending: false,
          voice: defaultVoice,
        }
      }

      // No explicit pin set - fall back to last used voice if available
      const lastUsedVoiceId = localStorage.getItem('lastUsedVoiceId')
      if (lastUsedVoiceId) {
        const lastUsedVoice = options.find((v) => v.value === lastUsedVoiceId)
        if (!lastUsedVoice) {
          return { pinPending: true, voice: autoSelectVoiceOption }
        }
        return {
          pinPending: false,
          voice: lastUsedVoice,
        }
      }

      return { pinPending: false, voice: autoSelectVoiceOption }
    },
    [],
  )

  // Auto-load default voice on component mount.
  //
  // When a stored pin isn't in the (still-partial) catalog yet, wait for the
  // catalog to settle instead of latching onto Auto-select -- otherwise a
  // legitimately stored preference is silently demoted once the remaining
  // options (e.g. clones after presets) arrive.
  useEffect(() => {
    if (selectedVoice || voiceOptions.length === 0 || hasAutoLoadedVoiceRef.current) {
      return
    }

    const { pinPending, voice } = resolveInitialVoice(voiceOptions)
    if (pinPending && !catalogReady) {
      return
    }

    setSelectedVoice(voice)
    hasAutoLoadedVoiceRef.current = true
  }, [catalogReady, resolveInitialVoice, selectedVoice, setSelectedVoice, voiceOptions])

  // Reset voice when it no longer exists in the catalog.
  //
  // Gated on `catalogReady`: until every voice source has settled, the
  // aggregate `voiceOptions` can be empty or partial, and treating a missing
  // entry as "voice no longer exists" would silently demote a committed
  // selection to Auto-select.
  useEffect(() => {
    if (!selectedVoice) {
      return
    }

    if (selectedVoice.value === 'auto-select') {
      return
    }

    if (!catalogReady) {
      return
    }

    const latestSelectedVoice = voiceOptions.find((voice) => voice.value === selectedVoice.value)
    if (!latestSelectedVoice) {
      setSelectedVoice(autoSelectVoiceOption)
    }
  }, [catalogReady, selectedVoice, setSelectedVoice, voiceOptions])

  return { autoSelectVoiceOption }
}
