import { z } from 'zod'

import type { LongTakeUserAssetCatalogItem } from '../workflows/long-take/types'

export const LONG_TAKE_USER_ASSETS_ANALYSIS_PATH = 'long_take/user_assets_analysis.json'

export const LongTakeUserAssetsAnalysisModelOutputSchema = z.object({
  files: z
    .array(
      z.object({
        file_id: z.string().nullable().optional(),
        file_name: z.string().nullable().optional(),
        match_reason: z.string().nullable().optional(),
      }),
    )
    .default([]),
  characters: z
    .array(
      z.object({
        age: z.string().nullable().optional(),
        appearance: z.string().nullable().optional(),
        ethnicity: z.string().nullable().optional(),
        file_refs: z.array(z.string()).default([]),
        name: z.string(),
      }),
    )
    .default([]),
  objects: z
    .array(
      z.object({
        appearance: z.string().nullable().optional(),
        brand_or_style: z.string().nullable().optional(),
        distinctive_features: z.string().nullable().optional(),
        file_refs: z.array(z.string()).default([]),
        name: z.string(),
      }),
    )
    .default([]),
  summary: z
    .object({
      matched: z.coerce.number().int().nonnegative().default(0),
      unresolved: z.coerce.number().int().nonnegative().default(0),
    })
    .default({
      matched: 0,
      unresolved: 0,
    }),
})

export type LongTakeUserAssetsAnalysisModelOutput = z.infer<
  typeof LongTakeUserAssetsAnalysisModelOutputSchema
>

export type LongTakeUserAssetsAnalysisOutput = {
  characters: Array<{
    age: null | string
    appearance: null | string
    ethnicity: null | string
    file_refs: string[]
    name: string
  }>
  files: Array<{
    file_id: string
    mime: string
    shortname: string
    storage_uri: string
  }>
  objects: Array<{
    appearance: null | string
    brand_or_style: null | string
    distinctive_features: null | string
    file_refs: string[]
    name: string
  }>
  summary: {
    matched: number
    unresolved: number
  }
}

export function buildLongTakeUserAssetsAnalysisFallback(): LongTakeUserAssetsAnalysisOutput {
  return {
    characters: [],
    files: [],
    objects: [],
    summary: {
      matched: 0,
      unresolved: 0,
    },
  }
}

export function normalizeLongTakeUserAssetsAnalysisOutput(params: {
  catalog: LongTakeUserAssetCatalogItem[]
  modelOutput: LongTakeUserAssetsAnalysisModelOutput
}): LongTakeUserAssetsAnalysisOutput {
  const { modelOutput, catalog } = params
  const catalogById = new Map(catalog.map((item) => [item.fileId, item]))
  const catalogByName = buildCatalogNameLookup(catalog)
  const referencedFileIds = collectReferencedFileIds({
    catalogById,
    catalogByName,
    modelOutput,
  })
  const files = buildNormalizedFiles(referencedFileIds, catalogById)
  const validFileIdSet = new Set(files.map((item) => item.file_id))
  const characters = normalizeCharacters(modelOutput.characters, validFileIdSet)
  const objects = normalizeObjects(modelOutput.objects, validFileIdSet)

  return {
    characters,
    files,
    objects,
    summary: {
      matched: files.length,
      unresolved: Math.max(0, modelOutput.summary.unresolved),
    },
  }
}

function buildCatalogNameLookup(catalog: LongTakeUserAssetCatalogItem[]): Map<string, string[]> {
  const lookup = new Map<string, string[]>()
  for (const item of catalog) {
    const keys = new Set<string>([
      item.shortname.toLowerCase(),
      ...item.aliases.map((alias) => alias.toLowerCase()),
    ])
    for (const key of keys) {
      if (!key) {
        continue
      }
      const existing = lookup.get(key) || []
      existing.push(item.fileId)
      lookup.set(key, existing)
    }
  }
  return lookup
}

function buildEntityFileRefs(fileRefs: string[], validFileIdSet: Set<string>): string[] {
  return Array.from(new Set(fileRefs.filter((fileRef) => validFileIdSet.has(fileRef))))
}

function buildNormalizedFiles(
  referencedFileIds: Set<string>,
  catalogById: Map<string, LongTakeUserAssetCatalogItem>,
): LongTakeUserAssetsAnalysisOutput['files'] {
  return Array.from(referencedFileIds)
    .map((fileId) => {
      const file = catalogById.get(fileId)
      if (!file) {
        return null
      }
      return {
        file_id: fileId,
        mime: file.mime,
        shortname: file.shortname,
        storage_uri: file.storageUri,
      }
    })
    .filter(
      (
        file,
      ): file is {
        file_id: string
        mime: string
        shortname: string
        storage_uri: string
      } => Boolean(file),
    )
}

function collectReferencedFileIds(params: {
  catalogById: Map<string, LongTakeUserAssetCatalogItem>
  catalogByName: Map<string, string[]>
  modelOutput: LongTakeUserAssetsAnalysisModelOutput
}): Set<string> {
  const { catalogById, catalogByName, modelOutput } = params
  const referencedFileIds = new Set<string>()

  for (const file of modelOutput.files) {
    const explicitFileId = file.file_id?.trim()
    if (explicitFileId && catalogById.has(explicitFileId)) {
      referencedFileIds.add(explicitFileId)
      continue
    }

    const fileName = file.file_name?.trim().toLowerCase()
    if (!fileName) {
      continue
    }
    const matchedIds = catalogByName.get(fileName) || []
    for (const fileId of matchedIds) {
      referencedFileIds.add(fileId)
    }
  }

  for (const group of [modelOutput.characters, modelOutput.objects]) {
    for (const item of group) {
      for (const fileRef of item.file_refs) {
        if (catalogById.has(fileRef)) {
          referencedFileIds.add(fileRef)
        }
      }
    }
  }

  return referencedFileIds
}

function normalizeCharacters(
  entities: LongTakeUserAssetsAnalysisModelOutput['characters'],
  validFileIdSet: Set<string>,
): LongTakeUserAssetsAnalysisOutput['characters'] {
  const characters: LongTakeUserAssetsAnalysisOutput['characters'] = []
  for (const entity of entities) {
    const name = entity.name.trim()
    if (!name) {
      continue
    }
    characters.push({
      age: normalizeText(entity.age),
      appearance: normalizeText(entity.appearance),
      ethnicity: normalizeText(entity.ethnicity),
      file_refs: buildEntityFileRefs(entity.file_refs, validFileIdSet),
      name,
    })
  }
  return characters
}

function normalizeObjects(
  entities: LongTakeUserAssetsAnalysisModelOutput['objects'],
  validFileIdSet: Set<string>,
): LongTakeUserAssetsAnalysisOutput['objects'] {
  const objects: LongTakeUserAssetsAnalysisOutput['objects'] = []
  for (const entity of entities) {
    const name = entity.name.trim()
    if (!name) {
      continue
    }
    objects.push({
      appearance: normalizeText(entity.appearance),
      brand_or_style: normalizeText(entity.brand_or_style),
      distinctive_features: normalizeText(entity.distinctive_features),
      file_refs: buildEntityFileRefs(entity.file_refs, validFileIdSet),
      name,
    })
  }
  return objects
}

function normalizeText(value: null | string | undefined): null | string {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}
