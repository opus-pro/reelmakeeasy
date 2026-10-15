import type { LongTakeHumanPresence } from '@reelmakeeasy/common/long-take/types'

const CANONICAL_SINGER_ASSET_ID = 'char_singer'
const STRONG_LIP_SYNC_PERFORMANCE_CUE_PATTERNS = [
  /\b(?:sing|sings|singing|sung)\b/i,
  /\b(?:rap|raps|rapping|rapper)\b/i,
  /\bvocal\s+(?:performance|delivery|take|line|phrase)\b/i,
  /\b(?:mouth|lips?)\b.{0,80}\b(?:sing|rap|lyric|vocal|move|sync)\b/i,
  /\b(?:lyric|chorus|hook)\b.{0,80}\b(?:mouth|lip|sing|rap|perform)\b/i,
  /\b(?:singer|rapper|vocalist)\b.{0,80}\b(?:perform|performs|performing|performance)\b/i,
  /\b(?:perform|performs|performing|performance)\b.{0,80}\b(?:singer|rapper|vocalist)\b/i,
]
const LIP_SYNC_PERFORMANCE_CUE_PATTERNS = [
  ...STRONG_LIP_SYNC_PERFORMANCE_CUE_PATTERNS,
  /\b(?:perform|performs|performing|performance)\b.{0,80}\b(?:to|toward|into|at)\s+(?:the\s+)?camera\b/i,
  /\b(?:singer|rapper|vocalist)\b.{0,80}\b(?:look|looks|face|faces)\s+(?:directly\s+)?(?:into|at|toward)\s+(?:the\s+)?camera\b/i,
]
const CHARACTER_ASSET_ID_PATTERN = /^char(?:_|$)/i
const VOCAL_ROLE_ASSET_ID_PATTERN =
  /(?:^|[_-])(?:singer|rapper|vocalist|artist|mc|emcee)(?:$|[_-])/i

export function shouldApplyMusicLipSyncToShot(params: {
  audio?: string
  entryPrompt?: string
  exitPrompt?: string
  humanPresence?: LongTakeHumanPresence
  keyframePrompt?: string
  requiredByPrompt?: boolean
  usedAssetIds?: string[]
  videoPrompt?: string
}): boolean {
  if (params.requiredByPrompt !== true || !hasShotVoiceover(params.audio ?? '')) {
    return false
  }

  const visualText = [
    params.videoPrompt,
    params.keyframePrompt,
    params.entryPrompt,
    params.exitPrompt,
  ]
    .filter(Boolean)
    .join('\n')

  if (!hasLipSyncCandidateAsset(params.usedAssetIds, visualText, params.humanPresence)) {
    return false
  }

  const cuePatterns = hasBroadLipSyncCueCandidateAsset(params.usedAssetIds, params.humanPresence)
    ? LIP_SYNC_PERFORMANCE_CUE_PATTERNS
    : STRONG_LIP_SYNC_PERFORMANCE_CUE_PATTERNS

  return cuePatterns.some((pattern) => pattern.test(visualText))
}

function hasBroadLipSyncCueCandidateAsset(
  usedAssetIds: string[] | undefined,
  humanPresence: LongTakeHumanPresence | undefined,
): boolean {
  return (
    hasCanonicalOrVocalRoleAsset(usedAssetIds) ||
    (humanPresence === 'singer_performance' && hasCharacterAsset(usedAssetIds))
  )
}

function hasCanonicalOrVocalRoleAsset(usedAssetIds: string[] | undefined): boolean {
  return Boolean(
    usedAssetIds?.some((assetId) => {
      const normalized = assetId.trim().toLowerCase()
      return (
        CHARACTER_ASSET_ID_PATTERN.test(normalized) &&
        (normalized === CANONICAL_SINGER_ASSET_ID || VOCAL_ROLE_ASSET_ID_PATTERN.test(normalized))
      )
    }),
  )
}

function hasCharacterAsset(usedAssetIds: string[] | undefined): boolean {
  return Boolean(usedAssetIds?.some((assetId) => CHARACTER_ASSET_ID_PATTERN.test(assetId.trim())))
}

function hasLipSyncCandidateAsset(
  usedAssetIds: string[] | undefined,
  visualText: string,
  humanPresence: LongTakeHumanPresence | undefined,
): boolean {
  if (hasBroadLipSyncCueCandidateAsset(usedAssetIds, humanPresence)) {
    return true
  }

  return Boolean(
    hasCharacterAsset(usedAssetIds) &&
      STRONG_LIP_SYNC_PERFORMANCE_CUE_PATTERNS.some((pattern) => pattern.test(visualText)),
  )
}

function hasShotVoiceover(audio: string | undefined): boolean {
  const trimmed = audio?.trim()
  return Boolean(trimmed && trimmed !== '-')
}
