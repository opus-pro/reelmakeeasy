import type { VideoModelSelectorConfig } from './video-model-selector-config.constants'

export type ReimagineModelSelectorTier = 'standard' | 'standard_plus'

export function getReimagineTierVideoModels(
  config: Pick<VideoModelSelectorConfig, 'newUi'>,
  tier: ReimagineModelSelectorTier,
): string[] | undefined {
  const catalog = config.newUi?.tiers?.[tier === 'standard' ? 'basic' : 'standard']
  // Browser config is cast, not schema-validated.
  if (
    !catalog ||
    typeof catalog.videoModelId !== 'string' ||
    !catalog.videoModelId ||
    !Array.isArray(catalog.customVideoModelIds) ||
    !catalog.customVideoModelIds.every((id) => typeof id === 'string' && id.length > 0)
  ) {
    return undefined
  }
  return [catalog.videoModelId, ...catalog.customVideoModelIds]
}

export function resolveReimagineSourceTier({
  config,
  sourceTier,
  sourceVideoModel,
}: {
  config: Pick<VideoModelSelectorConfig, 'newUi'>
  sourceTier?: null | string
  sourceVideoModel?: null | string
}): ReimagineModelSelectorTier | undefined {
  // A persisted paid tier is a floor, including when catalogs change or disappear.
  if (sourceTier === 'standard_plus') {
    return sourceTier
  }
  if (sourceTier !== 'standard') {
    return undefined
  }
  const standard = getReimagineTierVideoModels(config, 'standard')
  const standardPlus = getReimagineTierVideoModels(config, 'standard_plus')
  if (!standard || !standardPlus || !sourceVideoModel) {
    return undefined
  }
  const inStandard = standard.includes(sourceVideoModel)
  const inStandardPlus = standardPlus.includes(sourceVideoModel)
  // Standard wins for overlapping catalogs; recover only an unambiguous upgrade.
  if (inStandard) {
    return sourceTier
  }
  if (inStandardPlus) {
    return 'standard_plus'
  }
  return undefined
}
