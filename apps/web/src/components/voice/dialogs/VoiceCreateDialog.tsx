'use client'

import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import { cn, toast } from '@shared/ui'
import { useMutation } from '@tanstack/react-query'
import { AxiosError } from 'axios'
import { useCallback, useEffect, useState } from 'react'

import { useApi } from '@/hooks/useApi'
import { ApiError } from '@/lib/api-error'

import { standardCloneOption } from '../components/tts-engine-copy'
import { useTtsEnginesResponse } from '../components/tts-engines'
import { type VoiceOption } from '../components/voice-over-selection'
import { defaultColor, UserVoiceClone } from '../components/voice-over-selection'

import { type CloneEngine, pickCloneEngine, qwen3CloneDisabledReason } from './clone-engines'
import { VoiceAddDialog } from './VoiceAddDialog'
import { VoiceCloneErrorDialog } from './VoiceCloneErrorDialog'
import { VoicePreviewDialog } from './VoicePreviewDialog'

const nsLogger = Logger.get('voice.voice-create-dialog')

interface VoiceCloneFile {
  fileId: string
  fileUri: string
  message: string
  previewPath: null | string
  provider?: string
  requestedProvider?: string
  signedPreviewUrl?: string
  voiceId: string
}

interface VoiceCreateDialogProps {
  isVoicePlaying?: (voiceId: string) => boolean
  onBack?: () => void
  onClose: () => void
  onPlayVoice?: (voice: VoiceOption) => Promise<void>
  onVoiceCreated: (voice: VoiceOption) => void
  open: boolean
  pause?: () => void
  playingId?: null | string
  toggle?: (id: string, url: string) => void
}

// API error `code` for an unsupported-language clone. Must stay in sync with the
// backend in apps/services/api/src/voice-clones/voice-clones.service.ts.
const VOICE_CLONE_LANGUAGE_UNSUPPORTED_CODE = 'VOICE_CLONE_LANGUAGE_UNSUPPORTED'

// Thrown when the uploaded sample is in a language MiniMax cannot clone (API 422).
class VoiceCloneLanguageUnsupportedError extends Error {}

const CLONE_ENGINE_ROUTE: Record<CloneEngine, string> = {
  qwen3: '/api/voice-clones/qwen3/temporary',
  standard: '/api/voice-clones/elevenlabs/temporary',
}

const CLONE_ENGINES: Array<{ label: string; value: CloneEngine }> = [
  { label: 'Standard', value: 'standard' },
  { label: 'Qwen3', value: 'qwen3' },
]

/**
 * Shortest recording each engine accepts. Qwen3 clones from as little as 3 s, but
 * 10 s of clean speech is where the likeness holds; the API enforces the same floor.
 */
const MIN_RECORDING_SECONDS: Record<CloneEngine, number> = { qwen3: 10, standard: 15 }

export function VoiceCreateDialog({
  isVoicePlaying,
  onBack,
  onClose,
  onPlayVoice,
  onVoiceCreated,
  open,
  pause,
  playingId,
  toggle,
}: VoiceCreateDialogProps) {
  // Step management: 'upload' | 'voicePreview'
  const [currentStep, setCurrentStep] = useState<'languageError' | 'upload' | 'voicePreview'>(
    'upload',
  )

  // Voice data
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [voiceCloneFile, setVoiceCloneFile] = useState<null | VoiceCloneFile>(null)
  const [selectedVoiceOption, setSelectedVoiceOption] = useState<null | VoiceOption>(null)
  const [voiceCloneError, setVoiceCloneError] = useState<null | string>(null)
  const [isCloning, setIsCloning] = useState(false)
  const [engine, setEngine] = useState<CloneEngine>('standard')

  // The ['tts-engines'] query CloneEngineToggle also reads; react-query sends one request.
  const enginesResponse = useTtsEnginesResponse()
  // Start on an engine that can clone: Qwen3 when Standard can't (on Gemini without an
  // ElevenLabs key), Standard when Qwen3 can't; stay put when neither can (the rows say why).
  // `engine` is a dependency so the reset to 'standard' when the dialog closes is corrected
  // the next time it opens.
  const standardWorks = !standardCloneOption(enginesResponse).disabledReason
  const qwen3Works = !qwen3CloneDisabledReason(enginesResponse)
  useEffect(() => {
    const picked = pickCloneEngine({ qwen3: qwen3Works, standard: standardWorks }, engine)
    if (picked !== engine) setEngine(picked)
  }, [engine, qwen3Works, standardWorks])

  const { fetchApiDomain: fetchWithProjectId } = useApi()

  // ==================== Voice Upload/Record (Step 1) ====================

  const extractErrorMessage = (error: unknown): string => {
    if (error instanceof AxiosError && error.response?.data) {
      const responseData = error.response.data
      let message = 'Failed to upload file'

      if (typeof responseData === 'string') {
        message = responseData
      } else if (responseData.message) {
        message = responseData.message
      } else if (responseData.error) {
        message = responseData.error
      }

      try {
        const jsonMatch = message.match(/\{.*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          if (parsed.detail?.message) {
            return parsed.detail.message
          }
        }
      } catch {
        // Keep the message as is
      }

      return message
    }

    const err = ensureError(error)
    return err.message.split('\n')[0]
  }

  const processVoiceFile = async (
    base64Content: string,
    fileName: string,
  ): Promise<VoiceCloneFile> => {
    // Step 1: Upload the voice file
    const uploadRes = await fetchWithProjectId<{
      fileId: string
      fileUri: string
      message: string
    }>('/api/voice-clones/elevenlabs/upload', {
      data: { file: base64Content, fileName },
      method: 'POST',
    })

    if (!uploadRes.ok) {
      throw new Error(uploadRes.error || 'Failed to upload voice sample')
    }

    // Step 2: Validate audio file
    const validationResponse = await fetchWithProjectId<{
      duration: number
      isValid: boolean
      message: string
    }>('/api/voice-clones/validate-audio', {
      method: 'POST',
      data: { file: base64Content, fileName },
    })

    if (!validationResponse.ok) {
      throw new Error(validationResponse.error || 'Failed to validate audio file')
    }

    if (!validationResponse.data.isValid) {
      throw new Error(validationResponse.data.message)
    }

    // Step 3: Create temporary voice clone.
    // fetchApiDomain throws an ApiError on non-2xx, so the unsupported-language 422
    // surfaces here as a throw, not as previewRes.status. Map it to the typed
    // error so onError can show the dedicated dialog instead of the generic banner.
    const previewRes = await fetchWithProjectId<{
      previewPath: null | string
      provider?: string
      requestedProvider?: string
      voiceId: string
    }>(CLONE_ENGINE_ROUTE[engine], {
      data: { fileId: uploadRes.data.fileId },
      method: 'POST',
    }).catch((error: unknown) => {
      if (
        error instanceof ApiError &&
        (error.code === VOICE_CLONE_LANGUAGE_UNSUPPORTED_CODE || error.status === 422)
      ) {
        throw new VoiceCloneLanguageUnsupportedError()
      }
      throw error
    })

    if (!previewRes.ok) {
      throw new Error(previewRes.error || 'Failed to create voice preview')
    }

    return {
      ...uploadRes.data,
      provider: previewRes.data.provider,
      requestedProvider: previewRes.data.requestedProvider,
      voiceId: previewRes.data.voiceId,
      previewPath: previewRes.data.previewPath,
    }
  }

  const uploadFile = async (file: File): Promise<VoiceCloneFile> => {
    return new Promise((resolve, reject) => {
      if (!file) {
        reject(new Error('No file selected'))
        return
      }

      const reader = new FileReader()
      reader.readAsDataURL(file)

      reader.onload = async () => {
        try {
          const base64Data = reader.result as string
          const base64Content = base64Data.split(',')[1]
          const result = await processVoiceFile(base64Content, file.name)
          resolve(result)
        } catch (error) {
          if (error instanceof VoiceCloneLanguageUnsupportedError) {
            reject(error)
            return
          }
          nsLogger.error('Failed to upload file:', error)
          const userFriendlyMessage = extractErrorMessage(error)
          reject(new Error(userFriendlyMessage))
        }
      }

      reader.onerror = () => {
        reject(new Error('Failed to read file'))
      }
    })
  }

  const { mutate: uploadFileMutation, reset: resetUploadMutation } = useMutation<
    VoiceCloneFile,
    AxiosError<{ message: string }>,
    File
  >({
    mutationFn: uploadFile,
    onError: (error) => {
      if (error instanceof VoiceCloneLanguageUnsupportedError) {
        setCurrentStep('languageError')
        setIsCloning(false)
        return
      }
      const errorMessage = error.message.split('\n')[0] || 'Unknown error occurred'
      toast.error(`Custom voice failed: ${errorMessage}`)
      setVoiceCloneError(errorMessage)
      setCurrentStep('upload')
      setIsCloning(false)
    },
    onSuccess: async (data) => {
      // Fetch signed URL for preview
      try {
        const signedUrlResponse = await fetchWithProjectId<{
          expiresAt: string
          signedUrl: string
        }>(`${CLONE_ENGINE_ROUTE[engine]}/${data.voiceId}/playback`, {
          method: 'GET',
        })

        if (signedUrlResponse.ok) {
          const voiceCloneData = {
            ...data,
            signedPreviewUrl: signedUrlResponse.data.signedUrl,
          }
          setVoiceCloneFile(voiceCloneData)

          // Create VoiceOption for VoicePreviewDialog
          setSelectedVoiceOption({
            color: defaultColor,
            name: 'Custom voice',
            value: data.voiceId,
            previewAudioUrl: signedUrlResponse.data.signedUrl,
          })
        } else {
          setVoiceCloneFile(data)
          setSelectedVoiceOption({
            color: defaultColor,
            name: 'Custom voice',
            value: data.voiceId,
          })
        }
      } catch (error) {
        nsLogger.error('Failed to fetch signed preview URL:', error)
        setVoiceCloneFile(data)
        setSelectedVoiceOption({
          color: defaultColor,
          name: 'Custom voice',
          value: data.voiceId,
        })
      }
      setIsCloning(false)
    },
  })

  const handleVoiceNext = useCallback(
    (file: File) => {
      setSelectedFile(file)
      setIsCloning(true)
      setCurrentStep('voicePreview')
      uploadFileMutation(file)
    },
    [uploadFileMutation],
  )

  const handleVoiceAddDialogBack = useCallback(() => {
    pause?.()
    if (onBack) {
      onBack()
    } else {
      onClose()
    }
  }, [pause, onBack, onClose])

  // ==================== Voice Preview & Naming (Step 2) ====================

  const saveVoice = async (params: {
    voiceId: string
    voiceName: string
  }): Promise<UserVoiceClone> => {
    const { voiceId, voiceName } = params

    if (!voiceId || !voiceName.trim()) {
      throw new Error('Voice ID and name are required')
    }

    const createRes = await fetchWithProjectId<UserVoiceClone>(
      `${CLONE_ENGINE_ROUTE[engine]}/${voiceId}/save`,
      {
        data: {
          name: voiceName,
          fileId: voiceCloneFile?.fileId, // Pass fileId to track original source
        },
        method: 'POST',
      },
    )

    if (!createRes.ok) {
      throw new Error(createRes.error || 'Failed to save custom voice')
    }

    return createRes.data
  }

  const {
    mutate: createVoiceMutation,
    reset: resetCreateMutation,
    isPending: isSavingVoice,
  } = useMutation<
    UserVoiceClone,
    AxiosError<{ message: string }>,
    { voiceId: string; voiceName: string }
  >({
    mutationFn: saveVoice,
    onError: (error) => {
      const errorMessage =
        error.response?.data?.message || error.message.split('\n')[0] || 'Unknown error occurred'
      toast.error(`Failed to save voice: ${errorMessage}`)
    },
    onSuccess: (data) => {
      toast.success('Your voice has been saved')
      onVoiceCreated({
        color: defaultColor,
        name: data.name,
        provider: data.provider,
        value: data.voiceId,
        voiceCloneId: data.id,
      })
      onClose()
    },
  })

  // Reset state when dialog closes or opens
  useEffect(() => {
    if (!open) {
      setCurrentStep('upload')
      setSelectedFile(null)
      setVoiceCloneFile(null)
      setSelectedVoiceOption(null)
      setVoiceCloneError(null)
      setIsCloning(false)
      setEngine('standard')
      // Reset mutation states to clear isPending
      resetUploadMutation()
      resetCreateMutation()
    }
  }, [open, resetUploadMutation, resetCreateMutation])

  const handleVoicePreviewComplete = useCallback(
    (voiceName: string) => {
      if (!voiceCloneFile) {
        toast.error('Custom voice data not available')
        return
      }
      createVoiceMutation({
        voiceId: voiceCloneFile.voiceId,
        voiceName,
      })
    },
    [createVoiceMutation, voiceCloneFile],
  )

  const handleVoicePreviewBack = useCallback(() => {
    pause?.()
    setCurrentStep('upload')
    setSelectedFile(null)
    setVoiceCloneFile(null)
    setSelectedVoiceOption(null)
    setVoiceCloneError(null)
  }, [pause])

  const cloneVoiceOverlayClassName = 'z-[94]'
  const cloneVoiceContentClassName =
    'z-[95] w-full h-[100dvh] max-w-none md:h-auto md:w-[560px] md:max-w-[calc(100vw-32px)]'

  // ==================== Render ====================

  return (
    <>
      {/* Step 1: Upload/Record Voice */}
      {currentStep === 'upload' && (
        <VoiceAddDialog
          context="voice-clone"
          dialogContentClassName={cloneVoiceContentClassName}
          dialogOverlayClassName={cloneVoiceOverlayClassName}
          error={voiceCloneError}
          hideVoiceLibrary={true}
          isVoiceLoading={false}
          minRecordingSeconds={MIN_RECORDING_SECONDS[engine]}
          onBack={handleVoiceAddDialogBack}
          onClose={onClose}
          onNext={handleVoiceNext}
          open={Boolean(open && currentStep === 'upload')}
          pause={pause}
          playingId={playingId}
          toggle={toggle}
          uploadHeader={<CloneEngineToggle onChange={setEngine} value={engine} />}
          voiceOptions={[]}
        />
      )}

      {/* Step 2: Preview Voice & Enter Name */}
      {currentStep === 'voicePreview' && selectedFile && (
        <>
          <VoicePreviewDialog
            audioFile={selectedFile}
            dialogContentClassName={cloneVoiceContentClassName}
            dialogOverlayClassName={cloneVoiceOverlayClassName}
            isSavingVoice={isSavingVoice}
            isVoiceLoading={isCloning}
            isVoicePlaying={isVoicePlaying}
            onBack={handleVoicePreviewBack}
            onContinue={handleVoicePreviewComplete}
            onPlayVoice={onPlayVoice}
            open={Boolean(open && currentStep === 'voicePreview')}
            pause={pause}
            playingId={playingId}
            previewAudioUrl={selectedVoiceOption?.previewAudioUrl}
            selectedVoiceOption={selectedVoiceOption || undefined}
            toggle={toggle}
          />
        </>
      )}

      {/* Error: detected language not supported by MiniMax */}
      {currentStep === 'languageError' && (
        <VoiceCloneErrorDialog
          dialogContentClassName={cloneVoiceContentClassName}
          dialogOverlayClassName={cloneVoiceOverlayClassName}
          onClose={onClose}
          onGoBack={handleVoiceAddDialogBack}
          open={Boolean(open && currentStep === 'languageError')}
        />
      )}
    </>
  )
}

function CloneEngineToggle({
  onChange,
  value,
}: {
  onChange: (engine: CloneEngine) => void
  value: CloneEngine
}) {
  const response = useTtsEnginesResponse()
  const standard = standardCloneOption(response)
  // Standard clones run on MiniMax (fal) or ElevenLabs; Qwen3 is free when it runs locally.
  const free: Record<CloneEngine, boolean> = {
    qwen3: response?.engines.qwen3.free ?? false,
    standard: false,
  }
  const description: Record<CloneEngine, string> = {
    qwen3: 'Qwen3-TTS · 10 s recording',
    standard: standard.description,
  }
  const disabledReason: Record<CloneEngine, string | undefined> = {
    qwen3: qwen3CloneDisabledReason(response),
    standard: standard.disabledReason,
  }

  return (
    <div aria-label="Clone engine" className="flex shrink-0 gap-2" role="radiogroup">
      {CLONE_ENGINES.map((option) => {
        const reason = disabledReason[option.value]
        return (
          <button
            aria-checked={value === option.value}
            className={cn(
              'flex flex-1 flex-col items-start rounded-sm border px-3 py-2 text-left transition-colors',
              value === option.value
                ? 'border-white/40 bg-white/10'
                : 'border-white/10 hover:bg-white/[0.06]',
              reason && 'cursor-not-allowed opacity-50 hover:bg-transparent',
            )}
            disabled={Boolean(reason)}
            key={option.value}
            onClick={() => onChange(option.value)}
            role="radio"
            title={reason}
            type="button"
          >
            <span className="flex items-center gap-1.5 text-sm font-medium text-primary">
              {option.label}
              <span
                className={cn(
                  'rounded px-1 py-px text-[10px] font-semibold uppercase leading-3 tracking-wide',
                  free[option.value]
                    ? 'bg-[#A8E21F]/15 text-[#A8E21F]'
                    : 'bg-white/10 text-white/50',
                )}
              >
                {free[option.value] ? 'Free' : 'Paid'}
              </span>
            </span>
            <span className="text-xs text-secondary">{reason ?? description[option.value]}</span>
          </button>
        )
      })}
    </div>
  )
}
