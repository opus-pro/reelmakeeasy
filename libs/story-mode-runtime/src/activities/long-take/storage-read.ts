import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { type ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import type { Content } from '@reelmakeeasy/common/llm'

import {
  buildLongTakeAssetManagerFallback,
  LONG_TAKE_ASSET_MANAGER_PATH,
  LONG_TAKE_ASSET_MANIFEST_PATH,
  LONG_TAKE_BEAT_SHEET_PATH,
  LONG_TAKE_WORLD_BIBLE_PATH,
  LongTakeAssetManagerModelOutputSchema,
  type LongTakeAssetManagerOutput,
  LongTakeAssetManifestModelOutputSchema,
  type LongTakeAssetManifestOutput,
  LongTakeBeatSheetModelOutputSchema,
  LongTakeWorldBibleModelOutputSchema,
  normalizeLongTakeAssetManagerOutput,
  normalizeLongTakeAssetManifestOutput,
  normalizeLongTakeBeatSheetOutput,
  normalizeLongTakeWorldBibleOutput,
} from '../long-take-experts-analysis'
import {
  LONG_TAKE_USER_ASSETS_ANALYSIS_PATH,
  type LongTakeUserAssetsAnalysisOutput,
} from '../long-take-user-assets-analysis'
import {
  LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH,
  type LongTakeUserAssetUnderstandingOutput,
} from '../long-take-user-assets-understanding'

export function buildUserAssetImageContents(
  files: Array<{ file_id: string; mime: string; shortname: string; storage_uri: string }>,
): Content[] {
  const contents: Content[] = []
  for (const file of files) {
    if (!file.storage_uri || !file.mime.startsWith('image/')) {
      continue
    }
    contents.push(
      { type: 'text', text: `[file_id: ${file.file_id}, filename: ${file.shortname}]` },
      { type: 'image_url', imageUrl: file.storage_uri },
    )
  }
  return contents
}

export async function readLongTakeAssetManagerOutput(
  storage: ProjectStore,
): Promise<LongTakeAssetManagerOutput> {
  try {
    const payload = await storage.readJsonFile<unknown>(LONG_TAKE_ASSET_MANAGER_PATH)
    const parsed = LongTakeAssetManagerModelOutputSchema.parse(payload)
    const manifest = await readLongTakeAssetManifestOutput(storage)
    return normalizeLongTakeAssetManagerOutput({
      manifest,
      modelOutput: parsed,
    })
  } catch {
    return buildLongTakeAssetManagerFallback()
  }
}

export async function readLongTakeAssetManifestOutput(
  storage: ProjectStore,
): Promise<LongTakeAssetManifestOutput> {
  const payload = await storage.readJsonFile<unknown>(LONG_TAKE_ASSET_MANIFEST_PATH)
  const parsed = LongTakeAssetManifestModelOutputSchema.parse(payload)
  return normalizeLongTakeAssetManifestOutput({ modelOutput: parsed })
}

// stored file reads throw an ApiError with code 404 ("No such object") for missing files.
function isStorageNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false
  }
  const { code, message } = error as { code?: unknown; message?: unknown }
  return code === 404 || (typeof message === 'string' && message.includes('No such object'))
}

// Tolerant variant for callers that can legitimately run with zero assets: on the UIP non-fast
// path the confirm-time handoff skips writing asset_manifest.json when the planner produced no
// anchor candidates (valid for e.g. abstract/instrumental music videos). Only an absent file is
// tolerated -- a malformed/unparseable manifest or a transient read failure still throws, so a
// corrupted artifact surfaces instead of silently degrading asset grounding. The strict reader
// above stays the default so experts-pipeline callers still fail loudly when their stage broke.
export async function readLongTakeAssetManifestOutputOrEmpty(
  storage: ProjectStore,
): Promise<LongTakeAssetManifestOutput> {
  try {
    return await readLongTakeAssetManifestOutput(storage)
  } catch (error) {
    if (isStorageNotFoundError(error)) {
      return { asset_manifest: [] }
    }
    throw error
  }
}

export async function readLongTakeBeatSheetOutput(
  storage: ProjectStore,
): Promise<ReturnType<typeof normalizeLongTakeBeatSheetOutput>> {
  const payload = await storage.readJsonFile<unknown>(LONG_TAKE_BEAT_SHEET_PATH)
  const parsed = LongTakeBeatSheetModelOutputSchema.parse(payload)
  const stored = payload as Record<string, unknown>
  const auditPassed = stored?.time_range_audited === true
  const textAudited = !auditPassed && stored?.text_audited === true
  // The music-video route writes a deterministic beat sheet with time_range_audited=true and
  // text_audited=false (the text route only ever sets time_range_audited together with text_audited).
  // Its instrumental beats carry an empty segment_text by design, so keep them rather than dropping
  // the song's instrumental sections (which would leave a gap before the first lyric shot).
  const isMusicBeatSheet = auditPassed && stored?.text_audited !== true
  return normalizeLongTakeBeatSheetOutput({
    auditPassed,
    keepEmptySegments: isMusicBeatSheet,
    modelOutput: parsed,
    textAudited,
  })
}

export async function readLongTakeExpertsScript(
  storage: ProjectStore,
  fallbackScript: string,
): Promise<string> {
  try {
    const scriptFromStorage = await storage.readTextFile(STORY_LOADER_PATHS.scriptTxtPath)
    const normalizedScript = scriptFromStorage?.trim()
    if (normalizedScript) {
      return normalizedScript
    }
  } catch {
    // ignore and use fallback script
  }
  return fallbackScript?.trim() || ''
}

export async function readLongTakeExpertsUserAssetContext(storage: ProjectStore): Promise<{
  characters: LongTakeUserAssetsAnalysisOutput['characters']
  file_understanding: Array<{
    description: null | string
    entities: {
      brands_or_text: string[]
      characters: string[]
      objects: string[]
    }
    file_id: string
    shortname: string
    tags: string[]
  }>
  files: LongTakeUserAssetsAnalysisOutput['files']
  objects: LongTakeUserAssetsAnalysisOutput['objects']
}> {
  const fileUnderstanding = await readLongTakeUserAssetUnderstandingCatalogForAnalysis(storage)
  try {
    const parsed = await storage.readJsonFile<LongTakeUserAssetsAnalysisOutput>(
      LONG_TAKE_USER_ASSETS_ANALYSIS_PATH,
    )
    if (!parsed || typeof parsed !== 'object') {
      return { characters: [], file_understanding: fileUnderstanding, files: [], objects: [] }
    }
    return {
      characters: Array.isArray(parsed.characters) ? parsed.characters : [],
      file_understanding: fileUnderstanding,
      files: Array.isArray(parsed.files) ? parsed.files : [],
      objects: Array.isArray(parsed.objects) ? parsed.objects : [],
    }
  } catch {
    return { characters: [], file_understanding: fileUnderstanding, files: [], objects: [] }
  }
}

export async function readLongTakeUserAssetContent(
  storage: ProjectStore,
): Promise<Pick<LongTakeUserAssetsAnalysisOutput, 'characters' | 'files' | 'objects'>> {
  try {
    const payload = await storage.readJsonFile<LongTakeUserAssetsAnalysisOutput>(
      LONG_TAKE_USER_ASSETS_ANALYSIS_PATH,
    )
    return {
      characters: Array.isArray(payload?.characters) ? payload.characters : [],
      files: Array.isArray(payload?.files) ? payload.files : [],
      objects: Array.isArray(payload?.objects) ? payload.objects : [],
    }
  } catch {
    return { characters: [], files: [], objects: [] }
  }
}

export async function readLongTakeUserAssetUnderstandingCatalogForAnalysis(
  storage: ProjectStore,
): Promise<
  Array<{
    description: null | string
    entities: {
      brands_or_text: string[]
      characters: string[]
      objects: string[]
    }
    file_id: string
    shortname: string
    tags: string[]
  }>
> {
  try {
    const payload = await storage.readJsonFile<LongTakeUserAssetUnderstandingOutput>(
      LONG_TAKE_USER_ASSET_UNDERSTANDING_PATH,
    )
    const files = Array.isArray(payload?.files) ? payload.files : []
    return files
      .filter((item) => item?.status === 'success')
      .map((item) => ({
        description: item.description || null,
        entities: {
          brands_or_text: Array.isArray(item.entities?.brands_or_text)
            ? item.entities.brands_or_text
            : [],
          characters: Array.isArray(item.entities?.characters) ? item.entities.characters : [],
          objects: Array.isArray(item.entities?.objects) ? item.entities.objects : [],
        },
        file_id: item.file_id,
        shortname: item.shortname,
        tags: Array.isArray(item.tags) ? item.tags : [],
      }))
  } catch {
    return []
  }
}

export async function readLongTakeWorldBibleOutput(
  storage: ProjectStore,
): Promise<ReturnType<typeof normalizeLongTakeWorldBibleOutput>> {
  const payload = await storage.readJsonFile<unknown>(LONG_TAKE_WORLD_BIBLE_PATH)
  const parsed = LongTakeWorldBibleModelOutputSchema.parse(payload)
  return normalizeLongTakeWorldBibleOutput({ modelOutput: parsed })
}
