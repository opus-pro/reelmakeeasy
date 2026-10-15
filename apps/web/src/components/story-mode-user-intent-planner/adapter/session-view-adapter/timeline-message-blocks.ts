import type { AssetRef, MessageBlock, TimelineRenderBlock } from '../../state-types'
import type { MessageEventEvent, SessionState, UserMessageEvent } from '../api-types'

import { mediaIdentityOf, resolveSessionAudioUrl } from './audio-url'
import { buildUploadedAssetsPool } from './build-blocks'

export function appendUserMessageRelatedBlocks(params: {
  blocks: TimelineRenderBlock[]
  cdnOrigin: string
  event: UserMessageEvent
  sessionId: string
  state: SessionState
  userMessageIndex: number
}): number {
  const nextUserMessageIndex = params.userMessageIndex + 1

  if (nextUserMessageIndex === 0) {
    const audioBlock = buildFirstUserAudioAssetBlock({
      audioPath: params.state.audio_path,
      audioSource: params.state.audio_source,
      audioUrlFromApi: params.state.audio_url,
      cdnOrigin: params.cdnOrigin,
      firstUserMessage: params.event.message,
      sessionId: params.sessionId,
    })
    if (audioBlock) {
      params.blocks.push(audioBlock)
    }
  }

  params.blocks.push(
    ...buildMessageAssetBlocksFromUploadedAssets(params.event.id, params.event.uploaded_assets, {
      cdnOrigin: params.cdnOrigin,
      sessionId: params.sessionId,
    }),
  )

  return nextUserMessageIndex
}

export function buildMessageBlock(params: {
  anchorAssets: AssetRef[]
  event: MessageEventEvent
  uploadedAssets: AssetRef[]
}): MessageBlock {
  const { anchorAssets, event, uploadedAssets } = params
  return {
    anchorAssets,
    id: buildMessageBlockId(event.id),
    kind: 'message',
    role: event.type === 'assistant_message' ? 'assistant' : 'user',
    // Backend-echoed panel source; drives the AccentTag on the
    // user bubble (MessageBlockItem.tsx reads block.sentFrom).
    sentFrom: event.type === 'user_message' ? event.sent_from : undefined,
    text: event.type === 'assistant_message' ? event.content : event.message,
    uploadedAssets,
  }
}

export function buildMessageBlockId(eventId: number): string {
  return `block-message-event-${eventId}`
}

function buildAudioAssetListBlockForMessage(
  eventId: number,
  items: AssetRef[],
): TimelineRenderBlock {
  return {
    id: `block-audio-assets-event-${eventId}`,
    items,
    kind: 'audio_asset_list',
  }
}

function buildFirstUserAudioAssetBlock(params: {
  audioPath: null | string
  audioSource: SessionState['audio_source']
  audioUrlFromApi?: null | string
  cdnOrigin: string
  firstUserMessage: string
  sessionId: string
}): null | TimelineRenderBlock {
  const normalizedAudioPath = normalizeText(params.audioPath)
  const fromAudioPath = normalizedAudioPath
    ? resolveSessionAudioUrl(
        { audio_path: normalizedAudioPath, audio_url: params.audioUrlFromApi },
        params.sessionId,
        params.cdnOrigin,
      )
    : ''
  const parsedFromMessage = parseAudioTagFromMessage(params.firstUserMessage)
  const audioUrl = fromAudioPath || parsedFromMessage?.url || ''
  if (!audioUrl) {
    return null
  }
  const label =
    parsedFromMessage?.name ||
    (normalizedAudioPath ? extractFileName(normalizedAudioPath) : extractFileName(audioUrl))

  return {
    id: 'block-audio-first-user-message',
    items: [
      {
        // `id` doubles as the React key (`AudioAssetListBlockItem`),
        // so it must not be the raw URL -- its query string can change between
        // reads and would remount the card, and its player, on a poll. The
        // playable URL moves to `previewUrl`, which `resolvePlayableAudioUrl`
        // already prefers over `id`.
        id: mediaIdentityOf(audioUrl) || 'audio-first-user-message',
        label: label || 'Audio',
        previewUrl: audioUrl,
        type: 'audio',
      },
    ],
    kind: 'audio_asset_list',
  }
}

function buildMessageAssetBlocksFromUploadedAssets(
  eventId: number,
  uploadedAssets: UserMessageEvent['uploaded_assets'],
  options: { cdnOrigin: string; sessionId: string },
): TimelineRenderBlock[] {
  const refs = buildUploadedAssetsPool(uploadedAssets ?? [], options)
  if (refs.length === 0) {
    return []
  }

  const audioAssets = refs.filter((item) => item.type === 'audio')
  const nonAudioAssets = refs.filter((item) => item.type !== 'audio')
  const blocks: TimelineRenderBlock[] = []

  if (audioAssets.length > 0) {
    blocks.push(buildAudioAssetListBlockForMessage(eventId, audioAssets))
  }
  if (nonAudioAssets.length > 0) {
    blocks.push(buildMessageAssetListBlockForMessage(eventId, nonAudioAssets))
  }

  return blocks
}

function buildMessageAssetListBlockForMessage(
  eventId: number,
  items: AssetRef[],
): TimelineRenderBlock {
  return {
    id: `block-assets-event-${eventId}`,
    items,
    kind: 'message_asset_list',
  }
}

function extractFileName(value: string): string {
  try {
    const pathname = new URL(value).pathname
    return pathname.split('/').findLast(Boolean) ?? ''
  } catch {
    return value.split('/').findLast(Boolean) ?? ''
  }
}

function isAudioLink(value: string): boolean {
  const normalized = value.trim()
  if (!normalized) {
    return false
  }
  return /^(https?:\/\/|blob:|data:|\/|projects\/|store:\/\/)/i.test(normalized)
}

function normalizeText(value: null | string | undefined): string {
  return value?.trim() ?? ''
}

function parseAudioTagFromMessage(content: string): null | { name?: string; url?: string } {
  // Allow one level of balanced parens in the payload so CDN URLs with "(1)"
  // in the path (from video filenames like "My-Song (1).mp4") are captured
  // correctly instead of terminating the match at the inner ")".
  const match = content.match(/@audio\[([^\]]+)\]\(((?:[^()]|\([^)]*\))+)\)/)
  if (!match) {
    return null
  }

  const name = normalizeText(match[1])
  const payload = normalizeText(match[2])
  if (!payload) {
    return name ? { name } : null
  }

  const candidate = payload.split('|').at(-1)?.trim() ?? payload
  const url = isAudioLink(candidate) ? candidate : ''
  if (!name && !url) {
    return null
  }

  return {
    ...(name ? { name } : {}),
    ...(url ? { url } : {}),
  }
}
