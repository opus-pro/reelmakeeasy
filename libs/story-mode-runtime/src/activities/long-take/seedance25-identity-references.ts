import type { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'

import { getLongTakeAnchorMetaLookup } from './anchor-meta'
import { enforceTransitionPromptCharacterLimit } from './common'
import {
  prepareSeedance25ReferenceImageSet,
  type Seedance25ReferenceImageParams,
  type Seedance25ReferenceImageSet,
} from './seedance25-reference-images'
import {
  appendSeedance25IdentityBindings,
  appendTransitionIdentityBindings,
  type Seedance25IdentityBinding,
} from './transition-asset-library'

export interface Seedance25IdentityReferenceContext {
  bindPrompt: (prompt: string) => string
  identityBindings: Seedance25IdentityBinding[]
  referenceImageUrls?: string[]
}

export async function prepareSeedance25IdentityReferenceContext(
  params: Seedance25ReferenceImageParams & {
    fallbackAnchorStartImageIndex: number
    storage: ProjectStore
  },
): Promise<Seedance25IdentityReferenceContext> {
  // The URL-array branch keeps mixed-version tests and rolling deploys safe
  // while the metadata-bearing result becomes the only production shape.
  const prepared = (await prepareSeedance25ReferenceImageSet(params)) as
    | Seedance25ReferenceImageSet
    | string[]
    | undefined
  const referenceImageUrls = Array.isArray(prepared) ? prepared : prepared?.urls
  const identityBindings =
    prepared && !Array.isArray(prepared)
      ? await resolveIdentityBindings(params.storage, params.projectId, prepared.anchorAssetIds)
      : prepared
        ? []
        : await resolveIdentityBindings(
            params.storage,
            params.projectId,
            params.referenceAssetIds ?? [],
          )
  const anchorStartImageIndex =
    prepared && !Array.isArray(prepared)
      ? prepared.anchorStartImageIndex
      : params.fallbackAnchorStartImageIndex

  return {
    bindPrompt: (prompt) =>
      prepared
        ? appendSeedance25IdentityBindings({
            bindings: identityBindings,
            prompt,
            startImageIndex: anchorStartImageIndex,
          })
        : enforceTransitionPromptCharacterLimit(
            appendTransitionIdentityBindings({ bindings: identityBindings, prompt }),
          ),
    identityBindings,
    referenceImageUrls,
  }
}

async function resolveIdentityBindings(
  storage: ProjectStore,
  projectId: string,
  anchorAssetIds: string[],
): Promise<Seedance25IdentityBinding[]> {
  if (anchorAssetIds.length === 0) {
    return []
  }
  const anchorMetaLookup = await getLongTakeAnchorMetaLookup(storage, projectId)
  return anchorAssetIds.map((assetId) => {
    const meta = anchorMetaLookup.get(assetId)
    return {
      appearance:
        meta?.visualReference?.trim() || `the exact visual appearance shown by asset_id ${assetId}`,
      assetId,
      role: meta?.role?.trim() || meta?.properName?.trim() || meta?.keyword?.trim() || assetId,
    }
  })
}
