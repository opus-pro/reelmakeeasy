/**
 * Asset-mention counting for the UIP -> story-mode confirm orchestration.
 *
 * The anchor-manifest / user-upload-index / user-asset-catalog /
 * generated-anchor-category builders are re-exported from
 * @reelmakeeasy/uip-planner-runtime (story-mode-handoff), the single implementation
 * shared with the worker fast path.
 */

export {
  buildAssetManifestEntry,
  buildUserAssetCatalogForTracking,
  buildUserUploadAnchorEntries,
  countGeneratedAnchorsByCategoryForTracking,
  type GeneratedAnchorCountsForTracking,
  type UserAssetCatalogItemForTracking,
} from '@reelmakeeasy/uip-planner-runtime'

// Mirrors classic's `countAssetMentionsInPrompt(userPrompt)` but sums across
// UIP's multi-turn chat instead of a single prompt.
// `timeline` is Json on `UipSession`; permissive walk to tolerate malformed data.
export function countAssetMentionsAcrossUserMessages(timeline: unknown): number {
  if (!timeline || typeof timeline !== 'object') {
    return 0
  }
  const events = (timeline as { events?: unknown }).events
  if (!Array.isArray(events)) {
    return 0
  }
  let count = 0
  for (const raw of events) {
    if (!raw || typeof raw !== 'object') {
      continue
    }
    const event = raw as { message?: unknown; type?: unknown }
    if (event.type !== 'user_message' || typeof event.message !== 'string') {
      continue
    }
    const matches = event.message.match(/@img\[/g)
    if (matches) {
      count += matches.length
    }
  }
  return count
}
