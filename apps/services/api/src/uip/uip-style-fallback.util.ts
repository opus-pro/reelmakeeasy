import { logger } from '@reelmakeeasy/common/logger'
import type { Spec } from '@reelmakeeasy/uip-planner-runtime'

import { buildConfirmedProjectStyleUpdate } from './uip-confirm-orchestration'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

export interface UipSpecStyle {
  styleName?: string
  styleText?: string
  styleThumbnailUrl?: string
}

type SpecJsonDownloader = (storeObjectKey: string) => Promise<null | string>

function hasText(value: null | string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * True when none of the persisted style columns carry a usable value. This is
 * the signal that a project never recorded its selected style on the row --
 * e.g. failed/canceled before UIP confirm wrote the columns
 * (see buildConfirmedProjectStyleUpdate) -- so a remix would otherwise carry
 * no style. Callers use it to gate the (storage-reading) spec fallback.
 */
export function projectHasNoSelectedStyle(project: {
  styleName?: null | string
  styleText?: null | string
  styleThumbnailUrl?: null | string
}): boolean {
  return (
    !hasText(project.styleName) &&
    !hasText(project.styleText) &&
    !hasText(project.styleThumbnailUrl)
  )
}

const downloadStoredSpecJson: SpecJsonDownloader = async (storeObjectKey) => {
  try {
    const buffer = await fileStore.file(storeObjectKey).read()
    return buffer.toString()
  } catch (error) {
    // A missing spec is an expected miss; auth/network failures are not and would
    // silently drop a recoverable style on remix, so surface them at warn.
    if ((error as { code?: number }).code === 404) {
      logger.debug(`[uip-style-fallback] no UIP spec at ${storeObjectKey}`)
    } else {
      logger.warn(
        `[uip-style-fallback] spec download failed for ${storeObjectKey}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
    return null
  }
}

/**
 * Recover the user's selected style for a project from the durable UIP spec on
 * storage (`global_constraints.style`), the same source UIP confirm persists to the
 * project row. Returns null when no spec / no style is available. Reuses
 * buildConfirmedProjectStyleUpdate so the recovered values stay byte-identical
 * to what a confirmed run would have written.
 */
export async function resolveProjectStyleFromUipSpec(
  projectId: string,
  downloadSpecJson: SpecJsonDownloader = downloadStoredSpecJson,
): Promise<null | UipSpecStyle> {
  const raw = await downloadSpecJson(
    `projects/${projectId}/user-intent-planner/spec/current/spec.json`,
  )
  if (!raw) {
    return null
  }

  let spec: Spec
  try {
    spec = JSON.parse(raw) as Spec
  } catch {
    return null
  }

  if (!spec?.global_constraints?.style) {
    return null
  }

  const style = buildConfirmedProjectStyleUpdate(spec)
  if (!style.styleName && !style.styleText && !style.styleThumbnailUrl) {
    return null
  }
  return style
}

/**
 * Backfill a project's selected style from the durable UIP spec when the row
 * carries none. Only touches UIP projects with no recorded style, so the common
 * case (style already set) and non-UIP projects -- which never write a UIP spec
 * -- skip the storage read entirely. This lets the remix carry-over recover style
 * for failed/canceled projects that never reached UIP confirm.
 */
export async function applyUipSpecStyleFallback<
  T extends {
    id: string
    isUip?: boolean | null
    styleName?: null | string
    styleText?: null | string
    styleThumbnailUrl?: null | string
  },
>(project: T, resolve = resolveProjectStyleFromUipSpec): Promise<T> {
  if (!project.isUip || !projectHasNoSelectedStyle(project)) {
    return project
  }
  const recovered = await resolve(project.id)
  if (!recovered) {
    return project
  }
  return { ...project, ...recovered }
}
