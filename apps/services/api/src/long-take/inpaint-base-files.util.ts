import type { Storage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { normalizeTransitionRenderUris } from '@reelmakeeasy/common/long-take/render-transition-video-uri'
import { ConflictException } from '@nestjs/common'
import type { LongTakeKeyframe, LongTakeTransition } from '@shared/types/api/long-take'

export const INPAINT_BASE_FILES_MISSING_CODE = 'INPAINT_BASE_FILES_MISSING'
export const INPAINT_TRANSITIONS_PATH = 'long_take/transition_videos.json'
export const INPAINT_KEYFRAMES_PATH = 'long_take/keyframes.json'

// Only a confirmed-missing object may be classified as "nothing to edit": exists()
// swallows transient storage/IAM failures into false, so a presence probe cannot tell a
// genuine 404 apart from a blip. Classify from the read failure itself instead.
export async function readInpaintBaseFiles(
  storage: Storage,
): Promise<{ keyframes: LongTakeKeyframe[]; transitions: LongTakeTransition[] }> {
  try {
    const [transitions, keyframes] = await Promise.all([
      storage.readJsonFile<LongTakeTransition[]>(INPAINT_TRANSITIONS_PATH),
      storage.readJsonFile<LongTakeKeyframe[]>(INPAINT_KEYFRAMES_PATH),
    ])
    // Boundary where manifest data enters persisted inpaint state, so canonicalize here
    // rather than leaving every downstream reader to mask a cdn-form uri.
    return { keyframes, transitions: transitions.map(normalizeTransitionRenderUris) }
  } catch (error) {
    if (!isConfirmedMissingError(error)) {
      throw error
    }
    throw new ConflictException({
      code: INPAINT_BASE_FILES_MISSING_CODE,
      message: 'This video has no rendered output to edit.',
    })
  }
}

// Duplicated from isConfirmedMissingError in
// libs/shared/common/src/template/manager-tool/get-templates-spec.ts rather than exported,
// per that file's precedent for this exact classification.
function isConfirmedMissingError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code
    return code === 404 || code === 'ENOENT'
  }
  return false
}
