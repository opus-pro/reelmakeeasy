'use client'

import { useEffect } from 'react'

import { reloadPage } from '@/util/hard-navigation'

// A document restored from bfcache can carry a Next app router that was
// suspended mid mpaNavigation (see util/hard-navigation.ts). Next's own
// pageshow recovery resets the router, but it early-returns when
// history.state lacks its internals tree -- which our same-pathname query
// writes cause via history.pushState(null, ...) -- leaving the router
// permanently deaf to navigation. Reload exactly those restores; restores
// Next can recover keep their bfcache snapshot.
export function BfcacheReloadGuard() {
  useEffect(() => {
    const handler = (event: PageTransitionEvent) => {
      const nextRouterCanRecover = Boolean(
        (window.history.state as null | { __PRIVATE_NEXTJS_INTERNALS_TREE?: unknown })
          ?.__PRIVATE_NEXTJS_INTERNALS_TREE,
      )
      if (event.persisted && !nextRouterCanRecover) {
        reloadPage()
      }
    }
    window.addEventListener('pageshow', handler)
    return () => window.removeEventListener('pageshow', handler)
  }, [])

  return null
}
