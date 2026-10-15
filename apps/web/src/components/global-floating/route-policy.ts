export type RouteMatchRule = { path: string; type: 'exact' } | { pattern: string; type: 'pattern' }

export const ONGOING_NOTIFICATION_ROUTE_RULES: RouteMatchRule[] = [
  { path: '/', type: 'exact' },
  { path: '/home', type: 'exact' },
  { path: '/story-mode', type: 'exact' },
]

export const FLOATING_PROMO_BANNER_ROUTE_RULES: RouteMatchRule[] = [
  ...ONGOING_NOTIFICATION_ROUTE_RULES,
  { path: '/projects', type: 'exact' },
  { path: '/projects/story-mode', type: 'exact' },
  { path: '/projects/videos', type: 'exact' },
]

export function shouldShowFloatingPromoBannerByRoute(pathname: string): boolean {
  const normalizedPathname = normalizePathname(pathname)
  return FLOATING_PROMO_BANNER_ROUTE_RULES.some((rule) => isRuleMatch(normalizedPathname, rule))
}

export function shouldShowOngoingNotificationByRoute(pathname: string): boolean {
  const normalizedPathname = normalizePathname(pathname)
  return ONGOING_NOTIFICATION_ROUTE_RULES.some((rule) => isRuleMatch(normalizedPathname, rule))
}

function isPatternMatch(pathname: string, pattern: string): boolean {
  const pathSegments = pathname.split('/').filter(Boolean)
  const patternSegments = pattern.split('/').filter(Boolean)

  if (pathSegments.length !== patternSegments.length) {
    return false
  }

  return patternSegments.every((patternSegment, index) => {
    if (patternSegment.startsWith(':')) {
      return true
    }
    return patternSegment === pathSegments[index]
  })
}

function isRuleMatch(pathname: string, rule: RouteMatchRule): boolean {
  if (rule.type === 'exact') {
    return rule.path === pathname
  }
  return isPatternMatch(pathname, rule.pattern)
}

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) {
    return pathname.slice(0, -1)
  }
  return pathname
}
