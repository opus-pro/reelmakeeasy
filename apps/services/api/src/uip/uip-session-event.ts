const UIP_SESSION_BUS_PREFIX = 'uip-session:'
const BRAND_STYLE_PREVIEW_BUS_PREFIX = 'uip-brand-style-preview:'

/** Build the SSE bus key for a UIP session. */
export function uipSessionBusKey(projectId: string): string {
  return UIP_SESSION_BUS_PREFIX + projectId
}

/** Build the SSE bus key for a brand-card style-preview stream. */
export function brandStylePreviewBusKey(projectId: string): string {
  return BRAND_STYLE_PREVIEW_BUS_PREFIX + projectId
}
