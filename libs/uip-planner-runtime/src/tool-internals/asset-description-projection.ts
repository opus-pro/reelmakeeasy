/**
 * The single point where an asset description's split `setting`
 * (an actor upload's photographic backdrop) is folded back into the blended
 * caption the planning prompts read.
 *
 * This runs inside `getAssetDescriptionsJson`, the accessor every prompt-facing
 * serialisation already funnels through, rather than at each prompt site, so
 * every planning prompt sees the same shape.
 */

import type { AssetDescriptionItem, AssetDescriptionsArtifact } from '../anchor-types'

// No empty-artifact branch here on purpose. `AssetDescriptionsArtifact`
// requires `generated_at`, but today's null branch in getAssetDescriptionsJson
// serialises a bare `{ items: [] }` with no such key -- so manufacturing one
// here would either add a `"generated_at": ""` line to every prompt or need an
// `as` cast to lie about the type.
// Task 5 keeps its own null branch instead, and this function only ever sees a
// real artifact.

/**
 * @param artifact the loaded `assets/image_description.json`. Callers handle
 *   the absent case themselves -- see the note above.
 */
export function projectAssetDescriptionsForPlanning(
  artifact: AssetDescriptionsArtifact,
): AssetDescriptionsArtifact {
  return {
    ...artifact,
    items: artifact.items.map(projectItem),
  }
}

function projectItem(item: AssetDescriptionItem): AssetDescriptionItem {
  const { setting } = item
  if (!setting) {
    // Legacy blended caption, or a bucket that was never split. Untouched by
    // design: there is no backfill, so this population is permanent.
    return item
  }
  const { setting: _dropped, ...rest } = item
  return reconstitute(rest, setting)
}

/**
 * Recombine a split item into the blended caption. NOT pass-through (which would
 * hand the shot writer the backdrop in a dedicated labelled field) and NOT strip
 * (which leaves the item permanently subject-only).
 *
 * Approximate by construction: `summary` was written subject-only and has no
 * `setting` counterpart, so it stays narrowed.
 */
function reconstitute(
  item: Omit<AssetDescriptionItem, 'setting'>,
  setting: NonNullable<AssetDescriptionItem['setting']>,
): AssetDescriptionItem {
  const tags = [...item.tags, ...setting.tags.filter((tag) => !item.tags.includes(tag))]
  // `item.description` may be null (anchor-types.ts). Joining
  // [null, setting.description] would promote the backdrop ALONE into
  // `description` -- worse than reconstitution's intent, which is to
  // recombine subject + setting, not to hand the reader the setting on its
  // own. When there is no subject description to recombine onto, leave the
  // field exactly as it was.
  if (item.description === null) {
    return { ...item, tags }
  }
  const description = [item.description, setting.description]
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' ')
  return {
    ...item,
    description: description.length > 0 ? description : item.description,
    tags,
  }
}
