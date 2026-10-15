// Brand brief-edit detection used by foldSession's brief-edit counter.
//
// During the fold we count how many spec_patched events genuinely edited the
// brand brief (brand_bank), as opposed to the extraction/lifecycle ops that seed
// or reset the bank automatically. Split out of session-state.ts to keep that
// file within the strict max-lines cap; the logic is self-contained (depends
// only on the event shape).

import type { AgentEvent } from '../../workflows/uip-v2/types'

// Ops that populate or reset the brand_bank as part of extraction/lifecycle
// (not a user edit). A spec_patched carrying any of these seeds the bank, so its
// brand_bank change must not be counted as a brief edit.
const BRAND_EXTRACTION_OPS = new Set([
  'apply_brand_carry',
  'fail_brand_extraction',
  'mark_brand_reextraction_started',
  'retry_brand_extraction',
  'seed_brand_synthesis',
  'set_brand_extraction_input',
  'start_brand_extraction',
])

export function isBrandExtractionPatch(event: AgentEvent): boolean {
  return event.type === 'spec_patched' && event.ops.some((op) => BRAND_EXTRACTION_OPS.has(op.op))
}

// Order-independent stringify (recursively sorts object keys) so a brand_bank
// comparison is not fooled by key ordering -- only genuine value changes differ.
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) =>
    val && typeof val === 'object' && !Array.isArray(val)
      ? Object.keys(val as Record<string, unknown>)
          .sort()
          .reduce<Record<string, unknown>>((acc, k) => {
            acc[k] = (val as Record<string, unknown>)[k]
            return acc
          }, {})
      : val,
  )
}
