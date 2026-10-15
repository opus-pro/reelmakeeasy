export type GenerationRecordSummary = {
  anchorId: null | string
  attempt: number
  inputText: null | string
  meta: unknown
  model: null | string
  outputUris: string[]
}

export type TransitionDebugFields = {
  finalVideoModel?: null | string
  // The full prompt sent to the model for the successful attempt, read from the generation
  // record. The prompt persisted in transition_videos.json is truncated for the render
  // payload, so prefer this for display/debugging (mirrors latestImagePrompt for keyframes).
  finalVideoPrompt?: null | string
  finalVideoPromptAttempt?: number
  usedAssetLibrary?: boolean
}

export function resolveSuccessfulTransitionFields(
  transition: { transitionId: string; videoUri: string },
  records: GenerationRecordSummary[],
): TransitionDebugFields {
  const recordsForTransition = records.filter(
    (record) => record.anchorId === transition.transitionId,
  )
  const matchingOutputRecord = recordsForTransition.find((record) =>
    record.outputUris.includes(transition.videoUri),
  )
  const selectedRecord = matchingOutputRecord ?? recordsForTransition[0]
  if (!selectedRecord) {
    return {}
  }

  return {
    finalVideoModel: selectedRecord.model ?? null,
    finalVideoPrompt: selectedRecord.inputText ?? null,
    finalVideoPromptAttempt: selectedRecord.attempt,
    usedAssetLibrary: isAssetLibraryRecord(selectedRecord.meta),
  }
}

function isAssetLibraryRecord(meta: unknown): boolean {
  return (
    typeof meta === 'object' &&
    meta !== null &&
    (meta as { assetLibrary?: unknown }).assetLibrary === true
  )
}
