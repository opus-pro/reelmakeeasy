'use client'
import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'

export const S2V_ONBOARDING_POSTER_DISMISSED_KEY = 'ao_s2v_onboarding_poster_dismissed_v1'

// Dev/QA override: /home?create=song-to-video&s2vposter=1 force-shows the
// poster even after dismissal. It does NOT fire the shown-analytics, so
// metrics stay clean.
const FORCE_SHOW_PARAM = 's2vposter'

type Params = {
  // Visibility context owned by the caller: authenticated, desktop (web only,
  // the full-screen poster reads poorly on mobile) and the song-to-video view
  // is selected. The hook only adds gating + show-once persistence on top.
  enabled: boolean
}

export function useSongToVideoOnboardingPoster({ enabled }: Params): {
  dismiss: () => void
  isOpen: boolean
} {
  const searchParams = useSearchParams()
  const forceShow = searchParams?.get(FORCE_SHOW_PARAM) === '1'

  // Initialize dismissed=true (hidden) to avoid flash before hydration / SSR.
  // A useEffect corrects this to the real localStorage value after mount.
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const stored = localStorage.getItem(S2V_ONBOARDING_POSTER_DISMISSED_KEY)
    setDismissed(stored === '1')
  }, [])

  // Genuine eligibility: caller context satisfied AND not yet dismissed on
  // this browser.
  const realOpen = enabled && !dismissed
  const isOpen = realOpen || (enabled && forceShow)

  // Fire the shown event once when the real (non-override) poster opens, so
  // the QA override never skews the metric.
  useEffect(() => {
    if (!realOpen) {
      return
    }
  }, [realOpen])

  function dismiss() {
    if (typeof window !== 'undefined') {
      localStorage.setItem(S2V_ONBOARDING_POSTER_DISMISSED_KEY, '1')
    }
    setDismissed(true)
  }

  return { dismiss, isOpen }
}
