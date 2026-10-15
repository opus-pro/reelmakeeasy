// Full-document navigation helpers, mockable in jsdom (window.location itself
// is non-configurable there).
//
// crossOriginIsolated is fixed by the COOP/COEP headers of the document load,
// and /projects is served without them. A router.push into an editor route
// therefore always lands non-isolated and the render engine hard-reloads to
// recover (cross-origin-isolation.ts), so the soft nav renders twice. Worse,
// a bfcache restore of the list document brings back a router whose canonical
// URL is still the project it left, making a same-project re-open a no-op.
// Navigating at the document level avoids both.
export function hardNavigate(url: string) {
  window.location.assign(url)
}

export function reloadPage() {
  window.location.reload()
}
