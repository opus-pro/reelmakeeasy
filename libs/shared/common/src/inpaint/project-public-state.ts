import type { JudgeEditAppliedResult } from './activity-types'
import { ALL_INPAINT_MODEL_FAMILIES } from './call-type'
import { planCaseSpread } from './edit-plan-case'
import { toPublicRunError } from './public-error'
import type {
  InpaintPublicBusiness,
  InpaintPublicState,
  InpaintPublicTasks,
  PublicEdit,
  PublicJudgeMismatch,
  PublicResultRun,
  PublicResultTaskEntry,
  PublicRun,
  PublicTaskEntry,
} from './public-state'
import { classifyRemovalEdit } from './removal-edit'
import { latestGenRun } from './selectors'
import type {
  EditData,
  InpaintGlobalState,
  InpaintTaskRecords,
  Normalized,
  TaskEntryMeta,
} from './state'
import type { TaskRunRecord } from './task-types'
import { MAX_PUBLIC_HISTORY_DIFFS, truncateInpaintPublicHistory } from './truncate-history'
import type { InpaintHistoryData } from './types'

// Runtime projection of the full inpaint workflow state to the client-facing
// InpaintPublicState (see public-state.ts). Nothing slim is stored; this is
// derived on demand both for the SSE state query and for the diff stream, so
// the shape can change by shipping code -- no data migration.

function indexJudgeRuns(
  bucket: InpaintTaskRecords['editApplyJudgeRecords'],
): Map<string, TaskRunRecord<JudgeEditAppliedResult>> {
  const index = new Map<string, TaskRunRecord<JudgeEditAppliedResult>>()
  for (const entry of Object.values(bucket)) {
    for (const run of entry.runs) {
      index.set(run.id, run)
    }
  }
  return index
}

function resolveJudgeMismatch(
  edit: EditData,
  tasks: InpaintTaskRecords,
  judgeRuns: Map<string, TaskRunRecord<JudgeEditAppliedResult>>,
): PublicJudgeMismatch | undefined {
  const genRun = latestGenRun(tasks, edit)
  if (!genRun || genRun.state !== 'resolved') {
    return undefined
  }
  for (const childId of tasks.depRecords[genRun.id] ?? []) {
    const judgeRun = judgeRuns.get(childId)
    if (!judgeRun || judgeRun.state !== 'resolved') {
      continue
    }
    const result = judgeRun.result
    if (result.applied !== false || result.settings?.enforce !== false) {
      continue
    }
    const rawKind = result.checks?.anchorFailureKind
    return {
      failedCheck: result.failedCheck ?? 'applied',
      reason: result.reason,
      ...(rawKind && rawKind !== 'none' ? { anchorFailureKind: rawKind } : {}),
    }
  }
  return undefined
}

// Topology-only run (tier B): id/state/timestamps + a business-safe error message.
// recordMessage states what task failed (per task record); a known cross-cutting
// error type can override it. Raw error fields are never exposed.
function toPublicRun(run: TaskRunRecord<unknown>, recordMessage: string): PublicRun {
  switch (run.state) {
    case 'cancelled': {
      return {
        finishedAt: run.finishedAt,
        id: run.id,
        startedAt: run.startedAt,
        state: 'cancelled',
      }
    }
    case 'pending': {
      return { id: run.id, startedAt: run.startedAt, state: 'pending' }
    }
    case 'rejected': {
      return {
        error: toPublicRunError(run.error, recordMessage),
        finishedAt: run.finishedAt,
        id: run.id,
        startedAt: run.startedAt,
        state: 'rejected',
      }
    }
    case 'resolved': {
      return {
        finishedAt: run.finishedAt,
        id: run.id,
        startedAt: run.startedAt,
        state: 'resolved',
      }
    }
  }
}

// Result-bearing run (tier A): topology + an allowlisted result on resolution.
function toPublicResultRun<T, R>(
  run: TaskRunRecord<T>,
  mapResult: (result: T) => R,
  recordMessage: string,
): PublicResultRun<R> {
  switch (run.state) {
    case 'cancelled': {
      return {
        finishedAt: run.finishedAt,
        id: run.id,
        startedAt: run.startedAt,
        state: 'cancelled',
      }
    }
    case 'pending': {
      return { id: run.id, startedAt: run.startedAt, state: 'pending' }
    }
    case 'rejected': {
      return {
        error: toPublicRunError(run.error, recordMessage),
        finishedAt: run.finishedAt,
        id: run.id,
        startedAt: run.startedAt,
        state: 'rejected',
      }
    }
    case 'resolved': {
      return {
        finishedAt: run.finishedAt,
        result: mapResult(run.result),
        id: run.id,
        startedAt: run.startedAt,
        state: 'resolved',
      }
    }
  }
}

// Tier B: drop result + args, keep only run topology. Edits anchored at a
// main-branch node the truncation dropped are re-anchored to the new base, so
// they stay at-or-before current (i.e. visible) for the client.
function toPublicEdits(
  edits: Record<string, EditData>,
  droppedMainBranchIds: ReadonlySet<string>,
  baseId: string,
  tasks: InpaintTaskRecords,
): Record<string, PublicEdit> {
  const judgeRuns = indexJudgeRuns(tasks.editApplyJudgeRecords)
  const out: Record<string, PublicEdit> = {}
  for (const [key, edit] of Object.entries(edits)) {
    const judgeMismatch = resolveJudgeMismatch(edit, tasks, judgeRuns)
    out[key] = {
      editPrompt: edit.editPrompt,
      genImageTaskIds: edit.genImageTaskIds,
      genVideoTaskIds: edit.genVideoTaskIds,
      historyId: droppedMainBranchIds.has(edit.historyId) ? baseId : edit.historyId,
      id: edit.id,
      ...(judgeMismatch ? { judgeMismatch } : {}),
      planTaskId: edit.planTaskId,
      references: edit.references,
      region: edit.region,
      selectedAnchorId: edit.selectedAnchorId,
      timestampSec: edit.timestampSec,
      transitionId: edit.transitionId,
    }
  }
  return out
}

function toPublicTasks(tasks: InpaintTaskRecords): InpaintPublicTasks {
  return {
    // Tier B -- topology only.
    alignAndConcatRecords: toTopologyEntries(tasks.alignAndConcatRecords, 'Video merge failed'),
    anchorRecords: toTopologyEntries(tasks.anchorRecords, 'Image generation failed'),
    // Tier A -- result.anchorUrl.
    anchorRunRecords: toResultEntries(
      tasks.anchorRunRecords,
      (r) => ({ anchorUrl: r.anchorUrl }),
      'Image generation failed',
    ),
    byteplusAssetGroupRecords: toTopologyEntries(
      tasks.byteplusAssetGroupRecords,
      'Preparing generation assets failed',
    ),
    concatRecords: toTopologyEntries(tasks.concatRecords, 'Video merge failed'),
    copyTransitionClipsRecords: toTopologyEntries(
      tasks.copyTransitionClipsRecords,
      'Saving clip failed',
    ),
    depRecords: tasks.depRecords,
    editApplyJudgeRecords: toTopologyEntries(
      tasks.editApplyJudgeRecords,
      'Edit verification failed',
    ),
    // Tier A -- result {finalUrl, positions}. Linked to its edit via PublicEdit.genVideoTaskIds.
    editGenTaskRecords: Object.fromEntries(
      Object.entries(tasks.editGenTaskRecords).map(([key, entry]) => [
        key,
        {
          runs: entry.runs.map((run) =>
            toPublicResultRun(
              run,
              (r) => ({ finalUrl: r.finalUrl, positions: r.positions }),
              'Video generation failed',
            ),
          ),
          modelFamily: entry.args[0].modelFamilyOverride ?? entry.args[0].modelFamily,
          planRunId: entry.args[0].planRunId,
          pureDeletion: classifyRemovalEdit(entry.args[0].editPrompt) === 'pure_deletion',
          userRetryCount: entry.userRetryCount,
        },
      ]),
    ),
    // Tier A -- {affectedRange, plans:[{modelFamily}]}. Linked via PublicEdit.planTaskId.
    // The SSE state carries structure only: which model families are offered plus the
    // affected range. Pricing is NOT projected here -- the frontend reads it from the
    // API (GET plan-pricing), the single source of truth shared with the charge path.
    // v1 derives affectedRange from the structural planCase; v0 (legacy) already has it.
    editPlanRecords: toResultEntries(
      tasks.editPlanRecords,
      (r) => {
        if (r.v === 1) {
          return {
            affectedRange: planCaseSpread(r.planCase),
            plans: ALL_INPAINT_MODEL_FAMILIES.map((modelFamily) => ({ modelFamily })),
          }
        }
        return {
          affectedRange: r.affectedRange,
          plans: r.plans.map((p) => ({ modelFamily: p.modelFamily })),
        }
      },
      'Edit planning failed',
    ),
    editScopeRecords: toTopologyEntries(tasks.editScopeRecords, 'Edit analysis failed'),
    endpointEditRecords: toTopologyEntries(tasks.endpointEditRecords, 'Frame editing failed'),
    extractFramesRecords: toTopologyEntries(tasks.extractFramesRecords, 'Frame extraction failed'),
    // Tier A -- result.frameUrl, keyed by (videoUrl, timestampSec).
    extractVideoFrameRecords: Object.fromEntries(
      Object.entries(tasks.extractVideoFrameRecords).map(([key, entry]) => [
        key,
        {
          runs: entry.runs.map((run) =>
            toPublicResultRun(run, (r) => ({ frameUrl: r.frameUrl }), 'Frame extraction failed'),
          ),
          timestampSec: entry.args[0].timestampSec,
          videoUrl: entry.args[0].videoUrl,
        },
      ]),
    ),
    postProcessRecords: toTopologyEntries(tasks.postProcessRecords, 'Video post-processing failed'),
    probeRecords: toTopologyEntries(tasks.probeRecords, 'Video probe failed'),
    segmentRecords: toTopologyEntries(tasks.segmentRecords, 'Video generation failed'),
    speedUpReferenceRecords: toTopologyEntries(
      tasks.speedUpReferenceRecords,
      'Reference clip speed-up failed',
    ),
    splitRecords: toTopologyEntries(tasks.splitRecords, 'Video split failed'),
    uploadByteplusAssetRecords: toTopologyEntries(
      tasks.uploadByteplusAssetRecords,
      'Preparing generation assets failed',
    ),
  }
}

function toResultEntries<T, R>(
  bucket: Record<string, TaskEntryMeta<T>>,
  mapResult: (result: T) => R,
  recordMessage: string,
): Record<string, PublicResultTaskEntry<R>> {
  const out: Record<string, PublicResultTaskEntry<R>> = {}
  for (const [key, entry] of Object.entries(bucket)) {
    out[key] = { runs: entry.runs.map((run) => toPublicResultRun(run, mapResult, recordMessage)) }
  }
  return out
}

function toTopologyEntries(
  bucket: Record<string, TaskEntryMeta<unknown>>,
  recordMessage: string,
): Record<string, PublicTaskEntry> {
  const out: Record<string, PublicTaskEntry> = {}
  for (const [key, entry] of Object.entries(bucket)) {
    out[key] = { runs: entry.runs.map((run) => toPublicRun(run, recordMessage)) }
  }
  return out
}

// Diffable public core: business + history + tasks, WITHOUT version. The flush
// stream diffs two of these; version travels separately as (v1, v2).
export function projectInpaintPublicCore(
  state: Normalized<Pick<InpaintGlobalState, 'business' | 'history' | 'tasks'>>,
): {
  business: InpaintPublicBusiness
  history: InpaintHistoryData
  historyTruncated: boolean
  tasks: InpaintPublicTasks
} {
  const { droppedMainBranchIds, history, historyTruncated } = truncateInpaintPublicHistory(
    state.history,
    MAX_PUBLIC_HISTORY_DIFFS,
  )
  return {
    business: {
      edits: toPublicEdits(
        state.business.edits,
        droppedMainBranchIds,
        history?.base.id ?? '',
        state.tasks,
      ),
      legacyDraftDropped: state.business.legacyDraftDropped,
    },
    history,
    historyTruncated,
    tasks: toPublicTasks(state.tasks),
  }
}

// Full public state for the SSE state query (core + current version).
export function toInpaintPublicState(
  state: Normalized<Pick<InpaintGlobalState, 'business' | 'history' | 'sse' | 'tasks'>>,
): InpaintPublicState {
  return { ...projectInpaintPublicCore(state), version: state.sse?.version ?? 0 }
}
