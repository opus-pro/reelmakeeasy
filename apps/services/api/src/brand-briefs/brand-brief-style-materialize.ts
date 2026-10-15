import { storedFileKey } from '@reelmakeeasy/common/storage/stored-files'
import { ConflictException } from '@nestjs/common'

import type { PrismaService } from '../prisma/prisma.service'
import type {
  ScenePreviewInputDto,
  SnapshotInputDto,
} from '../user-saved-styles/user-saved-styles.dto'
import type { UserSavedStylesService } from '../user-saved-styles/user-saved-styles.service'

import type { BrandBriefStyleRef } from './brand-brief-save'

// Bound the unique-name search so a pathological library (50 same-named styles)
// surfaces an error instead of looping. Far above any realistic count.
const MAX_NAME_ATTEMPTS = 50

// The service rejects thumbnails that are not files this app stores; pre-filter
// so a non-conforming preview URL just drops the thumbnail rather than failing
// the whole save.
function allowedThumbnail(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) {
    return undefined
  }
  try {
    const url = new URL(rawUrl).toString()
    return storedFileKey(url) ? url : undefined
  } catch {
    return undefined
  }
}

// Deterministic name so re-saving the same brand+style refreshes one row instead
// of spawning a new "(brand colors)" entry each time. Brand-prefixed so two
// brands sharing a base style don't collide onto one library row.
function brandStyleName(brandName: string, baseStyleName: string | undefined): string {
  const brand = brandName.trim()
  const base = baseStyleName?.trim()
  return base ? `${brand} ${base}` : `${brand} brand style`
}

/**
 * Create a fresh library style, disambiguating its name against the user's
 * existing styles. `UserSavedStyle` has `@@unique([userId, name])`, so two
 * brands that share a base name (e.g. two "Good Good Golf" briefs) would
 * otherwise collide; the first free `name`, `name 2`, `name 3`, ... is used.
 * The pre-check is best-effort -- a row created between check and insert trips
 * the service's P2002 -> ConflictException, which just bumps the suffix.
 */
async function createBrandStyleWithUniqueName(
  prisma: PrismaService,
  userSavedStyles: UserSavedStylesService,
  input: {
    baseName: string
    snapshots?: SnapshotInputDto[]
    styleMetadata?: Record<string, unknown>
    styleText: string
    thumbnailUrl?: string
    userId: string
  },
): Promise<{ id: string }> {
  for (let attempt = 1; attempt <= MAX_NAME_ATTEMPTS; attempt++) {
    const name = attempt === 1 ? input.baseName : `${input.baseName} ${attempt}`
    const taken = await prisma.userSavedStyle.findFirst({
      select: { id: true },
      where: { name, userId: input.userId },
    })
    if (taken) {
      continue
    }
    try {
      return await userSavedStyles.create({
        name,
        styleInputMode: 'text',
        styleText: input.styleText,
        ...(input.thumbnailUrl ? { thumbnailUrl: input.thumbnailUrl } : {}),
        ...(input.styleMetadata ? { styleMetadata: input.styleMetadata } : {}),
        ...(input.snapshots?.length ? { snapshots: input.snapshots } : {}),
      })
    } catch (error) {
      // Lost the race for this name between the check and the insert; bump the
      // suffix and retry. Any other failure is real -- rethrow.
      if (error instanceof ConflictException) {
        continue
      }
      throw error
    }
  }
  throw new Error(`could not allocate a unique style name for "${input.baseName}"`)
}

/**
 * Materialize the brand-colored style variant (the "with brand colors" two-up
 * tile) as a real UserSavedStyle in the user's library and return a reference to
 * it, so the saved brief points at a library style like any other.
 *
 * Default: find-or-create-or-update keyed on the deterministic name keeps
 * re-saves idempotent (the brief-deduped confirm-brand-review save path -- one
 * brand maps to one brief, so one style row).
 *
 * `alwaysCreate`: skip the find-or-update and always mint a new row (with a
 * unique name). The create-in-library flow creates a distinct brief per run, so
 * each brand must get its own style -- keying idempotency on the brand name
 * would let a second same-named brand silently overwrite and share the first's
 * single library row.
 *
 * Returns undefined when there's no style text to persist.
 */
export async function materializeBrandStyleRef(
  prisma: PrismaService,
  userSavedStyles: UserSavedStylesService,
  input: {
    alwaysCreate?: boolean
    baseStyleName?: string
    brandName: string
    // Rendered scene samples from the generate step. Persisted as
    // the style's initial snapshot so the editor rehydrates the 3 previews
    // instead of re-rendering (and replacing the thumbnail) on first open.
    scenePreviews?: ScenePreviewInputDto[]
    // Analyzer extras ({ summary, analysis, colorPalette, faceDepiction }),
    // mirroring the custom-style studio's save payload. Enables the
    // generationStyleText composition for brand styles.
    styleMetadata?: Record<string, unknown>
    styleText: string
    thumbnailUrl?: string
    userId: string
  },
): Promise<BrandBriefStyleRef | undefined> {
  const styleText = input.styleText.trim()
  if (!styleText) {
    return undefined
  }
  const name = brandStyleName(input.brandName, input.baseStyleName)
  const thumbnailUrl = allowedThumbnail(input.thumbnailUrl)

  if (!input.alwaysCreate) {
    const existing = await prisma.userSavedStyle.findFirst({
      select: { id: true },
      where: { name, userId: input.userId },
    })
    if (existing) {
      await userSavedStyles.update(existing.id, { styleText })
      if (thumbnailUrl) {
        await userSavedStyles.updateThumbnailFromUrl(existing.id, thumbnailUrl)
      }
      return { kind: 'custom', userSavedStyleId: existing.id }
    }
  }

  const meta = input.styleMetadata
  const snapshots: SnapshotInputDto[] = input.scenePreviews?.length
    ? [
        {
          analysis: asRecord(meta?.['analysis']),
          colorPalette: asRecord(meta?.['colorPalette']),
          reusableStylePrompt: styleText,
          scenePreviews: input.scenePreviews,
          summary: typeof meta?.['summary'] === 'string' ? meta['summary'] : undefined,
        },
      ]
    : []

  const created = await createBrandStyleWithUniqueName(prisma, userSavedStyles, {
    baseName: name,
    snapshots,
    styleMetadata: meta,
    styleText,
    thumbnailUrl,
    userId: input.userId,
  })
  return { kind: 'custom', userSavedStyleId: created.id }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}
