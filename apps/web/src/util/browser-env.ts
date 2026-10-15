let cachedIsIOS: boolean | null = null
let cachedIsTouchPrimaryInput: boolean | null = null

export function isIOS(): boolean {
  if (cachedIsIOS === null) {
    cachedIsIOS = detectIOS()
  }
  return cachedIsIOS
}

export function isTouchPrimaryInput(): boolean {
  if (cachedIsTouchPrimaryInput === null) {
    cachedIsTouchPrimaryInput = detectTouchPrimaryInput()
  }
  return cachedIsTouchPrimaryInput
}

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const ua = navigator.userAgent || ''
  const platform = navigator.platform || ''
  const maxTouchPoints = navigator.maxTouchPoints || 0

  const isIOSUserAgent = /iPad|iPhone|iPod/.test(ua)
  const isIPadOSDesktopMode = platform === 'MacIntel' && maxTouchPoints > 1

  return isIOSUserAgent || isIPadOSDesktopMode
}

function detectTouchPrimaryInput(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false
  }

  const hasMatchMedia = typeof window.matchMedia === 'function'
  if (!hasMatchMedia) {
    return (navigator.maxTouchPoints || 0) > 0
  }

  const coarsePointer = window.matchMedia('(pointer: coarse)').matches
  const noHover = window.matchMedia('(hover: none)').matches

  return coarsePointer || noHover
}
