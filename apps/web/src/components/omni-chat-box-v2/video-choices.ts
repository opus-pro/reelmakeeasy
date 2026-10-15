import type { ModelRole, ModelsResponse, VideoModelCapabilities } from '@shared/types/api/models'

import { DEFAULT_VIDEO_QUALITY, type VideoQuality } from '@/atom/home'

/** The role transitions run on (DEFAULT_VIDEO_ROLE in useModels). */
const TRANSITION_ROLE: ModelRole = 'video.firstLast'
const QUALITY_ORDER: VideoQuality[] = ['480p', '720p', '768p', '1080p']

export interface VideoModelChoice {
  key: string
  label: string
  price: null | string
  /** The provider's default clip model (Omni Flash on Gemini). */
  recommended: boolean
}

const capsOf = (registry: ModelsResponse | undefined, key: null | string) =>
  (key ? registry?.models[key]?.capabilities : undefined) as undefined | VideoModelCapabilities

/** The stored quality when offered; else 768p when offered; else the lowest offered. */
export function effectiveQuality(offered: VideoQuality[], stored: VideoQuality): VideoQuality {
  if (offered.includes(stored)) return stored
  if (offered.includes(DEFAULT_VIDEO_QUALITY)) return DEFAULT_VIDEO_QUALITY
  return offered[0] ?? stored
}

/** The clip model to use: the stored pick when the provider offers it, else the provider's default. */
export function effectiveVideoModel(
  registry: ModelsResponse | undefined,
  stored: null | string,
): null | string {
  if (stored && registry?.videoChoices.includes(stored)) return stored
  return registry?.roles[TRANSITION_ROLE]?.key ?? null
}

/** The resolutions a clip model offers, lowest first. */
export function offeredQualities(
  registry: ModelsResponse | undefined,
  modelKey: null | string,
): VideoQuality[] {
  const resolutions = capsOf(registry, modelKey)?.resolutions ?? []
  return QUALITY_ORDER.filter((quality) => resolutions.includes(quality))
}

/** The note beside a quality: the recommended one, the sharpest, the cheapest. */
export function qualityNote(option: VideoQuality, offered: VideoQuality[]): string {
  const recommended = offered.includes(DEFAULT_VIDEO_QUALITY) ? DEFAULT_VIDEO_QUALITY : offered[0]
  if (option === recommended) return 'Recommended'
  if (option === offered[offered.length - 1]) return 'Sharpest'
  return option === offered[0] ? 'Cheapest' : ''
}

/** What the start request sends: the resolution, and the clip model when the provider offers a choice. */
export function videoGenerationParams(
  registry: ModelsResponse | undefined,
  storedModel: null | string,
  storedQuality: VideoQuality,
): { generationResolution: { videoResolution: VideoQuality }; transitionVideoModel?: string } {
  const model = effectiveVideoModel(registry, storedModel)
  const offered = offeredQualities(registry, model)
  const videoResolution = offered.length ? effectiveQuality(offered, storedQuality) : storedQuality
  const picked =
    model && registry?.videoChoices.includes(model) ? { transitionVideoModel: model } : {}
  return { generationResolution: { videoResolution }, ...picked }
}

/**
 * The clip models the composer offers (Gemini only; fal keeps its one model), the
 * default first and marked recommended, each with a starting price.
 */
export function videoModelChoices(registry: ModelsResponse | undefined): VideoModelChoice[] {
  const defaultKey = registry?.roles[TRANSITION_ROLE]?.key
  return (registry?.videoChoices ?? []).flatMap((key) => {
    const model = registry?.models[key]
    if (!model) return []
    const cheapest = Math.min(...Object.values(capsOf(registry, key)?.usdPerSecond ?? {}))
    return [
      {
        key,
        label: model.label,
        price: Number.isFinite(cheapest) ? `from $${cheapest}/s` : null,
        recommended: key === defaultKey,
      },
    ]
  })
}
