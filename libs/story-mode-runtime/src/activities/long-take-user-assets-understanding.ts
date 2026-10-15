import { z } from 'zod'

import type { LongTakeUserAssetCatalogItem } from '../workflows/long-take/types'

export const LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH = 'long_take/user_asset_understanding.json'

const LongTakeUserAssetUnderstandingQualitySchema = z.object({
  low_quality: z.boolean().default(false),
  text_heavy_infographic: z.boolean().default(false),
  watermark: z.enum(['none', 'few', 'many']).default('none'),
})

const LongTakeUserAssetUnderstandingEntitiesSchema = z.object({
  brands_or_text: z.array(z.string()).default([]),
  characters: z.array(z.string()).default([]),
  objects: z.array(z.string()).default([]),
})

export const LongTakeUserAssetUnderstandingModelOutputSchema = z.object({
  description: z.string().nullable().optional(),
  entities: LongTakeUserAssetUnderstandingEntitiesSchema.default({
    brands_or_text: [],
    characters: [],
    objects: [],
  }),
  likely_role: z
    .enum(['must_appear', 'conditional_visual_asset', 'style_reference_only'])
    .nullable()
    .optional(),
  quality: LongTakeUserAssetUnderstandingQualitySchema.default({
    low_quality: false,
    text_heavy_infographic: false,
    watermark: 'none',
  }),
  // `setting` is on THIS schema for the UIP seed bridge, which parses
  // a hand-built partial that may carry a `setting` object -- a required field
  // there would throw and user-assets.ts would turn that into status:'failed'
  // with a null description, wiping the caption for every seeded asset. This
  // schema is NOT what the classic long-take vision call sends as its
  // `responseFormat`; that call uses
  // `LongTakeUserAssetUnderstandingModelResponseSchema` below, which omits
  // `setting` entirely so the model is never asked for a field its prompt
  // (long-take-user-asset-understanding-prompt.ts) never mentions.
  setting: z
    .object({
      description: z.string().default(''),
      tags: z.array(z.string()).default([]),
      text: z.array(z.string()).default([]),
    })
    .nullable()
    .optional(),
  tags: z.array(z.string()).default([]),
  usage_guidance: z.string().nullable().optional(),
})

export type LongTakeUserAssetUnderstandingModelOutput = z.infer<
  typeof LongTakeUserAssetUnderstandingModelOutputSchema
>

// The model-facing variant of the schema above, sent as the live
// `responseFormat` for the classic long-take vision call (user-assets.ts).
// OpenAI strict mode hoists every key into the wire schema's `required` list
// regardless of `.nullable().optional()`, so leaving `setting` on the schema
// sent to the model would silently require it to emit a field the prompt
// never asks for -- on the ungated, 100%-of-traffic path shared by every
// upload bucket (logo / object / unhinted Assets included). Omitting it here
// keeps that call's wire schema identical to what it was before `setting` was added.
// The seed bridge keeps using the wider schema above, since it needs `setting`
// to survive a parse of UIP's own output.
export const LongTakeUserAssetUnderstandingModelResponseSchema =
  LongTakeUserAssetUnderstandingModelOutputSchema.omit({ setting: true })

export type LongTakeUserAssetUnderstandingModelResponse = z.infer<
  typeof LongTakeUserAssetUnderstandingModelResponseSchema
>

export type LongTakeUserAssetUnderstandingOutput = {
  files: Array<{
    asset_id: string
    description: null | string
    entities: {
      brands_or_text: string[]
      characters: string[]
      objects: string[]
    }
    file_id: string
    likely_role: 'conditional_visual_asset' | 'must_appear' | 'style_reference_only'
    mime: string
    quality: {
      low_quality: boolean
      text_heavy_infographic: boolean
      watermark: 'few' | 'many' | 'none'
    }
    // No `null` arm here: the conditional spread in
    // normalizeLongTakeUserAssetUnderstandingModelOutput() below only ever
    // omits this key or sets it to an object -- never `null` -- so a `null`
    // arm here would just invite dead `=== null` branches downstream.
    setting?: { description: string; tags: string[]; text: string[] }
    shortname: string
    source_type: 'user_uploaded'
    status: 'failed' | 'success'
    storage_uri: string
    tags: string[]
    usage_guidance: null | string
  }>
  generated_at: string
  summary: {
    analyzed: number
    failed: number
  }
  version: number
}

export function buildLongTakeUserAssetUnderstandingFallback(
  catalog: LongTakeUserAssetCatalogItem[],
): LongTakeUserAssetUnderstandingOutput {
  return {
    files: catalog.map((item) => ({
      asset_id: toAssetId(item.shortname),
      description: null,
      entities: {
        brands_or_text: [],
        characters: [],
        objects: [],
      },
      file_id: item.fileId,
      likely_role: 'conditional_visual_asset' as const,
      mime: item.mime,
      quality: {
        low_quality: false,
        text_heavy_infographic: false,
        watermark: 'none',
      },
      shortname: item.shortname,
      source_type: 'user_uploaded' as const,
      status: 'failed',
      storage_uri: item.storageUri,
      tags: [],
      usage_guidance: null,
    })),
    generated_at: new Date().toISOString(),
    summary: {
      analyzed: 0,
      failed: catalog.length,
    },
    version: 1,
  }
}

export function normalizeLongTakeUserAssetUnderstandingModelOutput(params: {
  catalogItem: LongTakeUserAssetCatalogItem
  modelOutput: LongTakeUserAssetUnderstandingModelOutput
}): LongTakeUserAssetUnderstandingOutput['files'][number] {
  const { catalogItem, modelOutput } = params
  return {
    asset_id: toAssetId(catalogItem.shortname),
    description: normalizeText(modelOutput.description),
    entities: {
      brands_or_text: normalizeStringList(modelOutput.entities.brands_or_text),
      characters: normalizeStringList(modelOutput.entities.characters),
      objects: normalizeStringList(modelOutput.entities.objects),
    },
    file_id: catalogItem.fileId,
    likely_role: resolveLikelyRole(catalogItem.shortname, modelOutput),
    mime: catalogItem.mime,
    quality: {
      low_quality: Boolean(modelOutput.quality.low_quality),
      text_heavy_infographic: Boolean(modelOutput.quality.text_heavy_infographic),
      watermark: modelOutput.quality.watermark,
    },
    ...(modelOutput.setting
      ? {
          setting: {
            description: normalizeText(modelOutput.setting.description) ?? '',
            tags: normalizeStringList(modelOutput.setting.tags),
            text: normalizeStringList(modelOutput.setting.text),
          },
        }
      : {}),
    shortname: catalogItem.shortname,
    source_type: 'user_uploaded' as const,
    status: 'success',
    storage_uri: catalogItem.storageUri,
    tags: normalizeStringList(modelOutput.tags),
    usage_guidance: normalizeText(modelOutput.usage_guidance),
  }
}

function normalizeStringList(values: string[] | undefined): string[] {
  if (!Array.isArray(values)) {
    return []
  }
  return Array.from(
    new Set(
      values
        .map((item) => item?.trim())
        .filter((item): item is string => Boolean(item))
        .map((item) => item.toLowerCase()),
    ),
  )
}

function normalizeText(value: null | string | undefined): null | string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function resolveLikelyRole(
  shortname: string,
  modelOutput: LongTakeUserAssetUnderstandingModelOutput,
): 'conditional_visual_asset' | 'must_appear' | 'style_reference_only' {
  if (modelOutput.likely_role) {
    return modelOutput.likely_role
  }
  if (modelOutput.entities.characters.length > 0) {
    return 'must_appear'
  }
  if (/style/i.test(shortname)) {
    return 'style_reference_only'
  }
  return 'conditional_visual_asset'
}

function toAssetId(shortname: string): string {
  return shortname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}
