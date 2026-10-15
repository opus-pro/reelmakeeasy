import type { NavigateOptions } from 'next/dist/shared/lib/app-router-context.shared-runtime'

export type GoBackSafeOptions = NavigateOptions & {
  action?: 'push' | 'replace'
}

type RouterLike = {
  back: () => void
  push: (href: string, options?: NavigateOptions) => void
  replace: (href: string, options?: NavigateOptions) => void
}

export function goBackSafe(
  router: RouterLike,
  fallbackHref: string,
  options: GoBackSafeOptions = {},
) {
  const { action = 'push', ...navigateOptions } = options
  // `history.length > 1` only means "there is something to go back to", not "it is in the app".
  // Gate `back()` with a same-origin referrer check to avoid exiting the app from deep links:
  // in a deep-link flow, closing the page could otherwise exit the app instead of returning to
  // an in-app route.
  const canGoBack =
    typeof window !== 'undefined' && window.history.length > 1 && hasSameOriginReferrer()

  if (canGoBack) {
    router.back()
    return
  }

  if (action === 'replace') {
    router.replace(fallbackHref, navigateOptions)
    return
  }

  router.push(fallbackHref, navigateOptions)
}

function hasSameOriginReferrer() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false
  }

  // Missing referrer is treated as unsafe and falls back to an in-app route.
  if (!document.referrer) {
    return false
  }

  try {
    return new URL(document.referrer).origin === window.location.origin
  } catch {
    return false
  }
}
