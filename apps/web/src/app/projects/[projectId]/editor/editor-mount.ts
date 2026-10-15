interface ShouldMountEditorEngineArgs {
  hasEnteredEditMode: boolean
  isEditMode: boolean
}

/**
 * Whether the heavyweight WASM editor engine (EditorCanvas) should be mounted.
 *
 * The engine is created with `audioDriver: true` and used to be mounted
 * during preview, hidden only with CSS. `display:none` does NOT silence a media
 * source, so the hidden engine's audio overlapped the result-video player and
 * produced the reported duplicate audio stream. Mount the engine only once the
 * user is (or has been) in edit mode, so watch-only sessions never instantiate a
 * second audio source. `hasEnteredEditMode` latches true so the engine stays
 * warm after the first edit, preserving fast re-entry and avoiding repeated WASM
 * create/destroy cycles.
 *
 * Only the engine is gated; the surrounding Editor (and its data initialization,
 * which loads the persisted edit history the preview banner reads) stays mounted.
 */
export function shouldMountEditorEngine({
  hasEnteredEditMode,
  isEditMode,
}: ShouldMountEditorEngineArgs): boolean {
  return isEditMode || hasEnteredEditMode
}
