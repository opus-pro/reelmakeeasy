'use client'

import { DEFAULT_VOICE_ID } from '@reelmakeeasy/common/tts/preset-voices'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import { ProjectVoiceOverJson } from '@shared/types/api/project'
import { type VoiceOverOptionsResponse, type VoiceSpeed } from '@shared/types/api/voice-over'
import { useQuery } from '@tanstack/react-query'

import { useApi } from '@/hooks/useApi'

import { colorPool, defaultColor } from './color-pool'
import { isVoiceExpired } from './voice-clone-expiry'

const nsLogger = Logger.get('voice.voice-over-selection')

export interface UserVoiceClone {
  createdAt: string
  id: string
  name: string
  provider?: string // 'byteplus' | 'fal' | 'minimax' | 'elevenlabs'
  userId: string
  voiceId: string
}
export interface VoiceOption {
  color?: string
  createdAt?: string
  default?: boolean
  isExpired?: boolean
  labels?: string[]
  name: string
  needsPresignedUrl?: boolean
  previewAudioUrl?: string
  provider?: string
  speed?: VoiceSpeed
  tone?: string
  /** Why the API says this voice can't be picked now (a Gemini voice without GEMINI_API_KEY).
   *  Its stored preview still plays. */
  unavailableReason?: string
  value: string
  visible?: boolean
  voiceCloneId?: string
}

export const placeholderIcon = (
  <span
    className="size-4.5 rounded-full"
    style={{ background: 'linear-gradient(180deg,hsla(264, 100%, 80%, 1),hsla(10, 100%, 68%, 1))' }}
  />
)
export { colorPool, defaultColor }

interface VoiceOverApiResponse {
  default?: boolean
  description: string
  id: string
  labels: string[]
  name: string
  needsPresignedUrl?: boolean
  previewAudioUrl: string
  provider?: string
  speed?: VoiceSpeed
  tone: string
  unavailableReason?: string
  visible?: boolean
  voiceId: string
}

export function usePresetVoiceOptions() {
  const { fetchApiDomain: fetchWithProjectId } = useApi()
  const { data, error, isError, isLoading } = useQuery<VoiceOption[]>({
    queryFn: async () => {
      try {
        // Fetch all preset voices (no provider filter)
        const res = await fetchWithProjectId<VoiceOverOptionsResponse>('/api/voice-over', {
          method: 'GET',
        })

        if (res.ok && res.data) {
          return transformVoiceOverData(res.data.data)
        }

        // A non-ok response is a fetch failure, NOT an empty catalog. Throw so
        // React Query retries and surfaces `isError` -- swallowing it as `[]`
        // makes a transient failure look like an authoritative empty list,
        // which downstream voice auto-select then misreads as "voice no longer
        // exists" and silently demotes the user's selection.
        throw new Error('Failed to fetch voice over options')
      } catch (err) {
        nsLogger.error('Error fetching voice over options:', err)
        throw err instanceof Error ? err : new Error(String(err))
      }
    },
    queryKey: ['voice-over-options'],
    retry: 2,
    staleTime: 5 * 60 * 1000,
  })

  return {
    error: error?.message,
    // True only after retries are exhausted on a real fetch failure. Lets
    // callers distinguish "errored" from "loaded-and-empty".
    failed: isError,
    loading: isLoading,
    options: data ?? [],
  }
}
export function useUserVoiceClones() {
  const { fetchApiDomain: fetchWithProjectId } = useApi()

  const { data, error, isError, isLoading, refetch } = useQuery<VoiceOption[]>({
    queryFn: async () => {
      try {
        const res = await fetchWithProjectId('/api/voice-clones/user', {
          method: 'GET',
        })

        if (res.ok && res.data) {
          return transformUserVoiceCloneData(res.data as UserVoiceClone[])
        }

        // See usePresetVoiceOptions: a non-ok response must not be mistaken for
        // an authoritative empty clone list.
        throw new Error('Failed to fetch user voice clones')
      } catch (err) {
        nsLogger.error('Error fetching user voice clones:', err)
        throw err instanceof Error ? err : new Error(String(err))
      }
    },
    queryKey: ['user-voice-clones'],
    retry: 2,
    staleTime: 0,
  })

  return {
    refetch,
    error: error?.message,
    // True only after retries exhaust on a real fetch failure.
    failed: isError,
    loading: isLoading,
    userVoices: data ?? [],
  }
}

// Hook to get presigned URL for voice previews
export function useVoicePreviewUrl(voiceId: string, needsPresignedUrl?: boolean) {
  const { fetchApiDomain: fetchWithProjectId } = useApi()

  return useQuery({
    queryKey: ['voice-preview-url', voiceId],
    queryFn: async () => {
      if (!needsPresignedUrl) {
        return null // No presigned URL needed
      }

      const res = await fetchWithProjectId<{
        expiresAt: string
        signedUrl: string
      }>(`/api/voice-over/${voiceId}/preview`, {
        method: 'GET',
      })

      if (!res.ok) {
        throw new Error(res.error || 'Failed to get presigned URL')
      }

      return res.data
    },
    enabled: !!voiceId && !!needsPresignedUrl,
    staleTime: 9 * 60 * 1000, // Cache for 9 minutes (URL expires in 10 minutes)
  })
}

function getColorByIndex(idx: number): string {
  return colorPool[idx % colorPool.length]
}

function transformUserVoiceCloneData(apiData: UserVoiceClone[]): VoiceOption[] {
  return apiData.map((item, index) => {
    // Format the creation date
    const createdDate = new Date(item.createdAt)
    const formattedDate = createdDate.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })

    return {
      color: getColorByIndex(index),
      createdAt: item.createdAt,
      isExpired: isVoiceExpired(item.provider, item.createdAt, false),
      labels: ['Custom voice', formattedDate],
      name: item.name,
      provider: item.provider,
      value: item.voiceId,
      voiceCloneId: item.id,
    }
  })
}
function transformVoiceOverData(apiData: VoiceOverApiResponse[]): VoiceOption[] {
  return apiData.map((item, index) => ({
    color: getColorByIndex(index),
    default: item.default,
    // Keep all labels: first is accent (for flag badge), rest shown in description
    labels: item.labels,
    name: item.name,
    value: item.id,
    previewAudioUrl: item.previewAudioUrl,
    needsPresignedUrl: item.needsPresignedUrl,
    provider: item.provider,
    speed: item.speed,
    tone: item.tone,
    // Greys the row out as soon as the list shows, before the engines report loads.
    unavailableReason: item.unavailableReason,
    visible: item.visible,
  }))
}

// Default voice ID to use when user selects "Auto-select".
export const DEFAULT_AUTO_SELECT_VOICE_ID = DEFAULT_VOICE_ID

export type FileUploadTypeOption = 'audio' | 'file' | 'video'

/** The voice "Auto-select" speaks with: the one the API flags as default for the generation provider. */
export function defaultVoiceIdFrom(options: Pick<VoiceOption, 'default' | 'value'>[]): string {
  return options.find((option) => option.default)?.value ?? DEFAULT_AUTO_SELECT_VOICE_ID
}

// Hook to get the default voice ID
export function useDefaultVoiceId(): string {
  const { options } = usePresetVoiceOptions()
  return defaultVoiceIdFrom(options)
}

// Utility function to convert VoiceOption to API format
export function convertVoiceOptionToApiFormat(
  voiceOption: VoiceOption,
  defaultVoiceId?: string,
): ProjectVoiceOverJson {
  // Check if this is a user voice clone (custom voice)
  const isCustomVoice = voiceOption.labels?.includes('Custom voice') ?? true

  // If user selected "Auto-select", use the provided default or fallback
  const voiceId =
    voiceOption.value === 'auto-select'
      ? defaultVoiceId || DEFAULT_AUTO_SELECT_VOICE_ID
      : voiceOption.value

  return {
    labels: voiceOption.labels,
    name: voiceOption.name,
    previewAudioUrl: voiceOption.previewAudioUrl || undefined,
    provider: voiceOption.provider,
    type: isCustomVoice ? 'voice-cloned' : 'voice-over',
    voiceId,
    ...(voiceOption.voiceCloneId && { voiceCloneId: voiceOption.voiceCloneId }),
  }
}
