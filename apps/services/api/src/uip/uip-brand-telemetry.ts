import type { TimelineFile, UipSessionState } from './uip-timeline-types'

export interface UipBrandTelemetry {
  brandExtractionFailureReason: null | string
  brandExtractionStatus: null | string
  isBrandVideo: boolean
  numBrandfilesUploaded: number
  uipUserBrandDescription: null | string
  uipUserWebsite: null | string
}

export function deriveBrandTelemetry(
  timeline: null | TimelineFile,
  sessionState?: null | Pick<UipSessionState, 'brand_telemetry'>,
): UipBrandTelemetry {
  const input = findBrandExtractionInput(timeline)
  const bankSource = findBrandBankSource(timeline)
  const extraction = findBrandExtractionOutcome(timeline)
  return {
    brandExtractionFailureReason: extraction.failureReason,
    brandExtractionStatus: extraction.status,
    isBrandVideo: input !== null || bankSource !== null,
    uipUserWebsite: input?.kind === 'url' ? input.url : null,
    uipUserBrandDescription: input?.kind === 'freeform' ? input.text : null,
    numBrandfilesUploaded: sessionState?.brand_telemetry?.files_uploaded_count ?? 0,
  }
}

function findBrandExtractionInput(
  timeline: null | TimelineFile,
): null | { kind: 'freeform'; text: string } | { kind: 'url'; url: string } {
  if (!timeline?.events) {
    return null
  }
  for (let i = timeline.events.length - 1; i >= 0; i--) {
    const event = timeline.events[i]
    if (event.type !== 'session_changed') {
      continue
    }
    const value = event.global_constraints?.brand_extraction_input
    if (value !== undefined) {
      return value
    }
  }
  return null
}

/**
 * Most-recent brand_bank_source from the timeline's session_changed deltas.
 * Non-null marks a saved brief applied from the brand library (explicit pick
 * or prompt auto-detect), which is a brand video even though
 * brand_extraction_input stays null for those sessions.
 */
function findBrandBankSource(
  timeline: null | TimelineFile,
): null | { brief_id: string; kind: 'brand_library' } {
  if (!timeline?.events) {
    return null
  }
  for (let i = timeline.events.length - 1; i >= 0; i--) {
    const event = timeline.events[i]
    if (event.type !== 'session_changed') {
      continue
    }
    const value = event.global_constraints?.brand_bank_source
    if (value !== undefined) {
      return value
    }
  }
  return null
}

/**
 * Most-recent brand_extraction_status / failure_reason from the timeline's
 * session_changed global_constraints deltas. Mirrors findBrandExtractionInput
 * so the extraction outcome rides existing events as a property rather than a
 * dedicated event.
 */
function findBrandExtractionOutcome(timeline: null | TimelineFile): {
  failureReason: null | string
  status: null | string
} {
  if (!timeline?.events) {
    return { failureReason: null, status: null }
  }
  for (let i = timeline.events.length - 1; i >= 0; i--) {
    const event = timeline.events[i]
    if (event.type !== 'session_changed') {
      continue
    }
    const status = event.global_constraints?.brand_extraction_status
    if (status !== undefined) {
      return {
        failureReason: event.global_constraints?.brand_extraction_failure_reason ?? null,
        status: status ?? null,
      }
    }
  }
  return { failureReason: null, status: null }
}
