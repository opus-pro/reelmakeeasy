import type { TranscriptWord } from '@shared/types/agent/transcript'

import { applyDeterministicDurations } from '../tool-internals/visual-script-timing'
import { GlobalConstraints, PlannerStructureEdit, Shot } from '../types'

const DEFAULT_WPM = 150
const MIN_SHOT_DURATION_SECONDS = 0.8

export interface StructureRuntimeResult {
  code?: StructureRuntimeErrorCode
  message: string
  ok: boolean
  shotIdMapping?: Map<string, string>
  shots?: Shot[]
}

type StructureEntriesResult =
  | { code?: StructureRuntimeErrorCode; message: string; ok: false }
  | { entries: StructureEntry[]; ok: true; targetShotIds: string[] }
interface StructureEntry {
  duration_s: number
  shot: Shot
}

type StructureRuntimeErrorCode = 'INVALID_INPUT' | 'OUT_OF_SCOPE_MUTATION'

export function applyStructureEditToVisualScript(params: {
  constraints: GlobalConstraints
  currentShots: Shot[]
  generatedShots: Shot[]
  structureEdit: PlannerStructureEdit
  /**
   * Optional word-level ASR transcript. When provided, the final shot
   * times are re-aligned by token-scanning each shot's `audio_vo` against
   * the transcript. Otherwise cumulative WPM cursors are used.
   */
  transcriptWords?: TranscriptWord[]
}): StructureRuntimeResult {
  const { currentShots, generatedShots, structureEdit, transcriptWords } = params

  if (structureEdit.op === 'DELETE') {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'DELETE structure_edit must be executed via PATCH_SPEC delete_shots.',
    }
  }

  if (currentShots.length === 0) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `${structureEdit.op} requires existing shots.`,
    }
  }

  // Pacing is now a visual beat-sheet hint, not a WPM source. Use a fixed
  // default for internal duration estimates when no transcript is available.
  const wpm = DEFAULT_WPM
  const entriesResult = buildStructureEntries({
    currentShots,
    generatedShots,
    structureEdit,
    wpm,
  })
  if (!entriesResult.ok) {
    return entriesResult
  }

  const immutableResult = ensureUnchangedShotsImmutable({
    currentShots,
    nextShots: entriesResult.entries.map((entry) => entry.shot),
    targetShotIds: entriesResult.targetShotIds,
  })
  if (!immutableResult.ok) {
    return immutableResult
  }

  const wpmCanonicalized = canonicalizeShots(entriesResult.entries)
  // In audio mode, override cumulative WPM times with transcript-aligned
  // times computed from each shot's audio_vo against the ASR transcript.
  const canonicalized =
    transcriptWords && transcriptWords.length > 0
      ? applyDeterministicDurations(wpmCanonicalized, { wpm, transcriptWords }, 0)
      : wpmCanonicalized
  const shotIdMapping = new Map<string, string>()
  entriesResult.entries.forEach((entry, index) => {
    const oldId = entry.shot.shot_id
    const newId = `shot_${index + 1}`
    if (oldId !== newId) {
      shotIdMapping.set(oldId, newId)
    }
  })

  return {
    ok: true,
    message: `${structureEdit.op} merged successfully.`,
    shots: canonicalized,
    shotIdMapping: shotIdMapping.size > 0 ? shotIdMapping : undefined,
  }
}

function buildInsertEntries(params: {
  currentShots: Shot[]
  generatedShots: Shot[]
  structureEdit: PlannerStructureEdit
  wpm: number
}): StructureEntriesResult {
  const { currentShots, generatedShots, structureEdit, wpm } = params
  const anchorShotId = structureEdit.anchor_shot_id?.trim()
  // The inserted shot's VO comes ONLY from the planner-side
  // `insert_audio_vo` payload -- never the LLM's generated audio_vo. The VS
  // tool must not author narration; the planner owns the inserted shot's VO
  // text (see the INSERT contract in visual-script-uip-prompts.ts). Dropping
  // the former `|| generatedShots[0].audio_vo` fallback closes the last path
  // by which the VS LLM could introduce VO text.
  const resolvedInsertAudio = structureEdit.insert_audio_vo?.trim()
  if (!anchorShotId || !structureEdit.position || !resolvedInsertAudio) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'INSERT requires anchor_shot_id, position, and insert_audio_vo.',
    }
  }

  const anchorIndex = currentShots.findIndex((shot) => shot.shot_id === anchorShotId)
  if (anchorIndex === -1) {
    return { ok: false, code: 'INVALID_INPUT', message: `Anchor shot '${anchorShotId}' not found.` }
  }
  if (generatedShots.length !== 1) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `INSERT expects exactly 1 generated shot, got ${generatedShots.length}.`,
    }
  }

  const existingEntries = toExistingEntries(currentShots)
  const inserted = toGeneratedEntry(
    generatedShots[0],
    resolvedInsertAudio,
    `__insert_${anchorShotId}`,
    wpm,
    cloneAssets(generatedShots[0].pre_selected_assets),
  )
  const insertIndex = structureEdit.position === 'BEFORE' ? anchorIndex : anchorIndex + 1
  existingEntries.splice(insertIndex, 0, inserted)
  return { ok: true, entries: existingEntries, targetShotIds: [] }
}

function buildMergeEntries(params: {
  currentShots: Shot[]
  generatedShots: Shot[]
  structureEdit: PlannerStructureEdit
  wpm: number
}): StructureEntriesResult {
  const { currentShots, generatedShots, structureEdit, wpm } = params
  const mergeShotIds = structureEdit.shot_ids ?? []
  if (mergeShotIds.length < 2) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'MERGE requires shot_ids with length >= 2.',
    }
  }
  const indexes = mergeShotIds.map((shotId) =>
    currentShots.findIndex((shot) => shot.shot_id === shotId),
  )
  if (indexes.some((index) => index < 0)) {
    return { ok: false, code: 'INVALID_INPUT', message: 'MERGE shot_ids contain unknown shot_id.' }
  }
  const sorted = [...indexes].sort((a, b) => a - b)
  for (let index = 1; index < sorted.length; index += 1) {
    if (sorted[index] - sorted[index - 1] !== 1) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'MERGE shot_ids must be continuous in current order.',
      }
    }
  }
  if (generatedShots.length !== 1) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `MERGE expects exactly 1 generated shot, got ${generatedShots.length}.`,
    }
  }

  const start = sorted[0]
  const end = sorted[sorted.length - 1]
  const targetShots = currentShots.slice(start, end + 1)
  const mergedAudio = normalizeSpacing(targetShots.map((shot) => shot.audio_vo).join(' '))
  const anchorAssets = mergeAssets(
    generatedShots[0].pre_selected_assets,
    ...targetShots.map((shot) => shot.pre_selected_assets),
  )
  const mergedEntry = toGeneratedEntry(generatedShots[0], mergedAudio, '__merge', wpm, anchorAssets)

  const entries = toExistingEntries(currentShots)
  entries.splice(start, end - start + 1, mergedEntry)
  return { ok: true, entries, targetShotIds: mergeShotIds }
}

function buildSplitEntries(params: {
  currentShots: Shot[]
  generatedShots: Shot[]
  structureEdit: PlannerStructureEdit
  wpm: number
}): StructureEntriesResult {
  const { currentShots, generatedShots, structureEdit, wpm } = params
  const targetShotId = structureEdit.shot_ids?.[0]
  const segments = (structureEdit.split_audio_segments ?? []).map((segment) => segment.trim())

  if (!targetShotId || (structureEdit.shot_ids ?? []).length !== 1) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'SPLIT requires exactly one shot_id.',
    }
  }
  if (segments.length < 2 || segments.some((segment) => !segment)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'SPLIT requires split_audio_segments with at least two non-empty segments.',
    }
  }

  const targetIndex = currentShots.findIndex((shot) => shot.shot_id === targetShotId)
  if (targetIndex === -1) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `SPLIT target shot '${targetShotId}' not found.`,
    }
  }
  if (generatedShots.length !== segments.length) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: `SPLIT expects ${segments.length} generated shots, got ${generatedShots.length}.`,
    }
  }

  const sourceShot = currentShots[targetIndex]
  if (normalizeSpacing(segments.join(' ')) !== normalizeSpacing(sourceShot.audio_vo)) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      message: 'SPLIT segments must preserve original shot audio_vo text.',
    }
  }

  const generatedAssets = generatedShots.map((shot) => cloneAssets(shot.pre_selected_assets))
  const carriedAssets = mergeAssets(sourceShot.pre_selected_assets).filter(
    (asset) =>
      !generatedAssets.some((assets) =>
        assets.some(
          (candidate) => candidate.asset_id === asset.asset_id && candidate.source === asset.source,
        ),
      ),
  )
  const replacements = generatedShots.map((shot, index) =>
    toGeneratedEntry(
      shot,
      segments[index],
      `__split_${targetShotId}_${index + 1}`,
      wpm,
      index === 0 ? mergeAssets(generatedAssets[index], carriedAssets) : generatedAssets[index],
    ),
  )
  const entries = toExistingEntries(currentShots)
  entries.splice(targetIndex, 1, ...replacements)
  return { ok: true, entries, targetShotIds: [targetShotId] }
}

function buildStructureEntries(params: {
  currentShots: Shot[]
  generatedShots: Shot[]
  structureEdit: PlannerStructureEdit
  wpm: number
}): StructureEntriesResult {
  const { structureEdit } = params
  switch (structureEdit.op) {
    case 'INSERT': {
      return buildInsertEntries(params)
    }
    case 'MERGE': {
      return buildMergeEntries(params)
    }
    case 'SPLIT': {
      return buildSplitEntries(params)
    }
    default: {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: `Unsupported structure_edit op: ${structureEdit.op}`,
      }
    }
  }
}

function canonicalizeShots(entries: StructureEntry[]): Shot[] {
  let cursor = 0
  return entries.map((entry, index) => {
    const duration = Math.max(MIN_SHOT_DURATION_SECONDS, entry.duration_s)
    const start_s = Number(cursor.toFixed(2))
    const end_s = Number((cursor + duration).toFixed(2))
    cursor = end_s
    return {
      ...entry.shot,
      shot_id: `shot_${index + 1}`,
      order: index + 1,
      time: { start_s, end_s },
    }
  })
}

function cloneAssets(assets: Shot['pre_selected_assets']): Shot['pre_selected_assets'] {
  return assets.map((asset) => ({ ...asset }))
}

function ensureUnchangedShotsImmutable(params: {
  currentShots: Shot[]
  nextShots: Shot[]
  targetShotIds: string[]
}): StructureRuntimeResult {
  const { currentShots, nextShots, targetShotIds } = params
  const targetSet = new Set(targetShotIds)

  for (const shot of currentShots) {
    if (targetSet.has(shot.shot_id)) {
      continue
    }
    const candidate = nextShots.find((nextShot) => nextShot.shot_id === shot.shot_id)
    if (!candidate) {
      return {
        ok: false,
        code: 'OUT_OF_SCOPE_MUTATION',
        message: 'Structure edit mutated non-target shot content.',
      }
    }
    if (
      shot.audio_vo !== candidate.audio_vo ||
      JSON.stringify(shot.visual_primary) !== JSON.stringify(candidate.visual_primary) ||
      JSON.stringify(shot.pre_selected_assets) !== JSON.stringify(candidate.pre_selected_assets)
    ) {
      return {
        ok: false,
        code: 'OUT_OF_SCOPE_MUTATION',
        message: 'Structure edit mutated non-target shot content.',
      }
    }
  }

  return { ok: true, message: 'Unchanged shot immutability check passed.' }
}

function mergeAssets(...groups: Array<Shot['pre_selected_assets']>): Shot['pre_selected_assets'] {
  const byKey = new Map<string, Shot['pre_selected_assets'][number]>()
  for (const asset of groups.flat()) {
    const key = `${asset.source}:${asset.asset_id}`
    if (!byKey.has(key)) {
      byKey.set(key, { ...asset })
    }
  }
  return [...byKey.values()]
}

function normalizeSpacing(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function toExistingEntries(currentShots: Shot[]): StructureEntry[] {
  return currentShots.map((shot) => {
    const duration = Math.max(
      MIN_SHOT_DURATION_SECONDS,
      Number.isFinite(shot.time.end_s - shot.time.start_s)
        ? shot.time.end_s - shot.time.start_s
        : MIN_SHOT_DURATION_SECONDS,
    )
    return {
      shot: JSON.parse(JSON.stringify(shot)) as Shot,
      duration_s: duration,
    }
  })
}

function toGeneratedEntry(
  generated: Shot,
  audioVo: string,
  tempShotId: string,
  wpm: number,
  preSelectedAssets: Shot['pre_selected_assets'],
): StructureEntry {
  const cleanAudio = normalizeSpacing(audioVo)
  const duration_s = Math.max(
    MIN_SHOT_DURATION_SECONDS,
    Number(((Math.max(1, wordCount(cleanAudio)) / wpm) * 60).toFixed(2)),
  )
  return {
    duration_s,
    shot: {
      shot_id: tempShotId,
      order: 1,
      time: { start_s: 0, end_s: duration_s },
      audio_vo: cleanAudio,
      visual_primary: {
        expression_type: generated.visual_primary.expression_type,
        aesthetic_mode: generated.visual_primary.aesthetic_mode,
        core_description: generated.visual_primary.core_description.trim(),
        entry_action: generated.visual_primary.entry_action?.trim() || null,
        exit_action: generated.visual_primary.exit_action?.trim() || null,
        availability: generated.visual_primary.availability,
        // Carry the V3 hand-off through the structure edit. Rebuilding
        // visual_primary field-by-field silently drops anything not listed, and
        // an INSERT/SPLIT/MERGE shot that lost its transition_to_next would fall
        // back to the null default -- reading as "last shot" mid-sequence.
        transition_to_next: generated.visual_primary.transition_to_next,
        notes: [...generated.visual_primary.notes],
      },
      pre_selected_assets: cloneAssets(preSelectedAssets),
    },
  }
}

function wordCount(value: string): number {
  return value
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0).length
}
