import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'

import { getStoryModeUserLimits } from '@reelmakeeasy/common/story-mode/user-limits'
import { UserInfo } from '@reelmakeeasy/common/types/user'
import { isStoreUri, keyIsUnder, parseStoreUri } from '@reelmakeeasy/common/storage/stored-files'
import { BadRequestException } from '@nestjs/common'

import { getAudioDurationSecondsFromStore } from '../util/audio-duration'
import { generateStoryModeAudioScript } from '../util/extract-audio-from-video'

// The tmp scope upload_project_asset mints for audio (createProjectAssetUploadUrl).
const MCP_AUDIO_SCOPE = 'mcp-create-video'

// Match createTmpUploadUrl / MediaService.copyTempFileToProject sanitization
// exactly so the per-user prefix check lines up with the minted tmp path.
function sanitizeUserId(userId: string): string {
  return String(userId).replace(/[^a-zA-Z0-9._-]/g, '_')
}

// Shared per-user tmp-audio ownership guard for both the web preview
// (story-mode-audio scope) and MCP voiceover (mcp-create-video scope): the audio
// must be a stored file under tmp/{sanitizedUserId}/{scope}/. Returns the checked key
// as `object` so callers can reuse it. Throws BadRequestException with caller-supplied
// messages on any mismatch.
export function validateUserTmpAudioPath(
  audioUri: string,
  userId: string,
  scope: string,
  messages: { invalidUser: string; notOwned: string; notWorkspace: string },
): { object: string } {
  const normalized = audioUri?.trim() || ''
  if (!isStoreUri(normalized)) {
    throw new BadRequestException(messages.notWorkspace)
  }
  let object = ''
  try {
    object = parseStoreUri(normalized)
  } catch {
    throw new BadRequestException('Invalid audio path')
  }
  const sanitized = sanitizeUserId(userId)
  if (!sanitized) {
    throw new BadRequestException(messages.invalidUser)
  }
  if (!keyIsUnder(object, `tmp/${sanitized}/${scope}`)) {
    throw new BadRequestException(messages.notOwned)
  }
  return { object }
}

// MCP voiceover path guard: caller's own upload_project_asset tmp object
// (store://tmp/{sanitizedUserId}/mcp-create-video/...). Throws
// BadRequestException (mapped to McpHandlerError by the caller) on any mismatch.
export function validateMcpAudioPath(audioUri: string, userId: string): void {
  validateUserTmpAudioPath(audioUri, userId, MCP_AUDIO_SCOPE, {
    invalidUser: 'Invalid user context',
    notOwned: 'Audio file must be uploaded by current user via upload_project_asset',
    notWorkspace: 'Audio file must be uploaded to workspace storage',
  })
}

// MCP voiceover ingest orchestration: validate the caller's upload_project_asset
// audio, enforce the duration cap + transcribe via ASR (the empty-transcript =
// pure-music decision is made by the MCP guard, not here), and probe duration. Pure glue over already-tested I/O fns; no `this` dependency,
// so it lives here (off the oversized LongTakeService) and is exposed as a thin
// LongTakeService.prepareMcpVoiceover delegate. StoryModeAudioDurationExceededError
// from generateStoryModeAudioScript propagates to the caller.
export interface PrepareMcpVoiceoverParams {
  audioUri: string
  user: UserInfo
}

export interface PrepareMcpVoiceoverResult {
  detectedTranscript: string
  durationSeconds: null | number
}

export async function prepareMcpVoiceover(
  params: PrepareMcpVoiceoverParams,
): Promise<PrepareMcpVoiceoverResult> {
  const normalized = params.audioUri?.trim() || ''
  validateMcpAudioPath(normalized, params.user.userId || params.user.sub || '')
  const object = parseStoreUri(normalized)
  const limits = getStoryModeUserLimits()
  const tempDir = await mkdtemp(`${os.tmpdir()}/mcp-voiceover-`)
  try {
    const detectedTranscript = await generateStoryModeAudioScript({
      fileUri: normalized,
      objectKey: object,
      tempDir,
      limits,
    })
    let durationSeconds: null | number = null
    try {
      durationSeconds = await getAudioDurationSecondsFromStore(normalized)
    } catch {
      durationSeconds = null
    }
    return { detectedTranscript, durationSeconds }
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}
