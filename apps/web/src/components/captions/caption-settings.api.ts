import type { CaptionStyleSettings } from '@shared/types/api/caption-style'
import type {
  LongTakeCaptionSettingsRequest,
  LongTakeCaptionSettingsResponse,
  LongTakeStatusResponse,
} from '@shared/types/api/long-take'

import type { FetchApiDomain } from '@/hooks/useApi'

import type { CaptionKind } from './caption-settings'

/** What the caption controls need from a video's status. */
export type CaptionStatus = {
  /** A highlight colour the agent suggested (a loop's storyboard accent), offered as a swatch. */
  accentSuggestion: null | string
  /** Which default look applies when nothing is saved: loops start in Punch. */
  kind: CaptionKind
  /** The look the delivered video was rendered with; null when it predates saved looks. */
  rendered: CaptionStyleSettings | null
  /** The look saved on the project; null when nobody chose one. */
  saved: CaptionStyleSettings | null
}

/** The caption fields of a video's status (GET /long-take-videos/:id). */
export async function getCaptionStatus(
  fetchApiDomain: FetchApiDomain,
  projectId: string,
): Promise<CaptionStatus> {
  const res = await fetchApiDomain<LongTakeStatusResponse>(`/api/long-take-videos/${projectId}`, {
    method: 'GET',
    noThrowError: true,
  })
  if (!res.ok) {
    throw new Error(res.error || "Couldn't read the video's captions")
  }
  const status = res.data?.data
  return {
    accentSuggestion: status?.captionAccentSuggestion ?? null,
    kind: status?.captionKind ?? 'video',
    rendered: status?.renderedCaptionStyle ?? null,
    saved: status?.captionStyle ?? null,
  }
}

/**
 * Saves caption fields (PUT /long-take-videos/:id/caption-settings): the fields sent replace
 * the saved ones, null puts one back to its default. Resolves with the whole saved look.
 */
export async function putCaptionSettings(
  fetchApiDomain: FetchApiDomain,
  projectId: string,
  body: LongTakeCaptionSettingsRequest,
): Promise<CaptionStyleSettings> {
  const res = await fetchApiDomain<LongTakeCaptionSettingsResponse>(
    `/api/long-take-videos/${projectId}/caption-settings`,
    { data: body, method: 'PUT', noThrowError: true },
  )
  if (!res.ok || !res.data?.data) {
    throw new Error(res.error || "Couldn't save the caption style")
  }
  return res.data.data.captionStyle
}
