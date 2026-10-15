import type { InpaintGlobalState, InpaintGlobalStateInput } from './state'
import { brandNormalized } from './state'

export function fillState(input: InpaintGlobalStateInput): InpaintGlobalState {
  return brandNormalized({
    business: {
      edits: input.business?.edits ?? {},
      legacyDraftDropped: input.business?.legacyDraftDropped,
    },
    core: {
      deadlineAt: input.core?.deadlineAt ?? 0,
      defaultNonce: input.core?.defaultNonce ?? '',
      inFlight: input.core?.inFlight ?? 0,
      pendingDrain: null,
      seenClientIds: input.core?.seenClientIds ?? [],
    },
    history: input.history,
    sse: {
      diffs: input.sse?.diffs ?? [],
      version: input.sse?.version ?? 0,
    },
    tasks: {
      alignAndConcatRecords: input.tasks?.alignAndConcatRecords ?? {},
      anchorRecords: input.tasks?.anchorRecords ?? {},
      anchorRunRecords: input.tasks?.anchorRunRecords ?? {},
      copyTransitionClipsRecords: input.tasks?.copyTransitionClipsRecords ?? {},
      byteplusAssetGroupRecords: input.tasks?.byteplusAssetGroupRecords ?? {},
      concatRecords: input.tasks?.concatRecords ?? {},
      depRecords: input.tasks?.depRecords ?? {},
      editApplyJudgeRecords: input.tasks?.editApplyJudgeRecords ?? {},
      editGenTaskRecords: input.tasks?.editGenTaskRecords ?? {},
      editPlanRecords: input.tasks?.editPlanRecords ?? {},
      editScopeRecords: input.tasks?.editScopeRecords ?? {},
      endpointEditRecords: input.tasks?.endpointEditRecords ?? {},
      extractFramesRecords: input.tasks?.extractFramesRecords ?? {},
      extractVideoFrameRecords: input.tasks?.extractVideoFrameRecords ?? {},
      frameCompareRecords: input.tasks?.frameCompareRecords ?? {},
      postProcessRecords: input.tasks?.postProcessRecords ?? {},
      probeRecords: input.tasks?.probeRecords ?? {},
      segmentRecords: input.tasks?.segmentRecords ?? {},
      speedUpReferenceRecords: input.tasks?.speedUpReferenceRecords ?? {},
      splitRecords: input.tasks?.splitRecords ?? {},
      uploadByteplusAssetRecords: input.tasks?.uploadByteplusAssetRecords ?? {},
    },
  })
}
