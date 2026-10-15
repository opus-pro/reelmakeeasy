'use client'

import { Logger } from '@reelmakeeasy/common/utils/logger'
import { toast } from '@shared/ui'
import Dialog from '@shared/ui/dialog'
import { cn } from '@shared/ui/lib/utils'
import { VoiceNamingContent } from '@shared/ui/VoiceNamingContent'
import { VoiceRecordingContent } from '@shared/ui/VoiceRecordingContent'
import React, { useCallback, useEffect, useRef, useState } from 'react'

import { useBreakpoint } from '@/util/browserUtils'

import { AudioPreview } from '../components/AudioPreview'
import { type VoiceOption } from '../components/voice-over-selection'
import { VoiceDialogFooter } from '../components/VoiceDialogFooter'
import { VoiceDialogHeader } from '../components/VoiceDialogHeader'
import { VoiceLibraryView } from '../components/VoiceLibraryView'
import { VoiceUploadContent } from '../components/VoiceUploadContent'

const nsLogger = Logger.get('voice.voice-add-dialog')

interface VoiceAddDialogProps {
  context?: 'avatar' | 'voice-clone' // Context to determine dialog title and description
  dialogContentClassName?: string
  dialogOverlayClassName?: string
  error?: null | string
  headerDescription?: string
  headerTitle?: string
  hideVoiceLibrary?: boolean
  isVoiceLoading?: boolean
  isVoicePlaying?: (voiceId: string) => boolean
  /** Shortest recording accepted, in seconds (15 by default). */
  minRecordingSeconds?: number
  onBack?: () => void
  onChooseFromLibrary?: () => void
  onClose?: () => void
  onNext?: (file: File) => void
  onPlayVoice?: (voice: VoiceOption) => Promise<void>
  onUseVoice?: (voice: VoiceOption) => void
  onVoiceNamingComplete?: (voiceName: string) => void
  onVoiceSelect?: (voice: null | VoiceOption) => void
  open: boolean
  pause?: () => void
  playingId?: null | string
  previewAudioUrl?: string
  selectedVoice?: null | string
  selectedVoiceOption?: null | VoiceOption
  toggle?: (id: string, url: string) => void
  /** Rendered above the upload area, e.g. the clone engine choice. */
  uploadHeader?: React.ReactNode
  voiceCloneSuccess?: boolean
  voiceOptions?: VoiceOption[]
}

export function VoiceAddDialog({
  context = 'avatar', // Default to avatar context
  dialogContentClassName,
  dialogOverlayClassName,
  error,
  headerDescription,
  headerTitle,
  hideVoiceLibrary = false,
  onBack,
  onChooseFromLibrary,
  onClose,
  onNext,
  onUseVoice,
  onVoiceNamingComplete,
  onVoiceSelect,
  open,
  pause,
  playingId,
  previewAudioUrl,
  voiceOptions = [],
  selectedVoice,
  selectedVoiceOption,
  toggle,
  uploadHeader,
  minRecordingSeconds = 15,
  onPlayVoice,
  isVoicePlaying,
  isVoiceLoading = false,
  voiceCloneSuccess = false,
}: VoiceAddDialogProps) {
  const { isBelowMd } = useBreakpoint('md')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [isRecording, setIsRecording] = useState(false)
  const [showRecording, setShowRecording] = useState(false)
  const [showVoiceLibrary, setShowVoiceLibrary] = useState(false)
  const [showNaming, setShowNaming] = useState(false)
  const [recordingState, setRecordingState] = useState<
    'idle' | 'loading' | 'recorded' | 'recording' | 'setup' | 'starting'
  >('idle')
  const [showPreview, setShowPreview] = useState(false)
  const [_uploadError, setUploadError] = useState<null | string>(null)
  const [isRecordingValid, setIsRecordingValid] = useState(true)
  const [audioDuration, setAudioDuration] = useState<number>(0)
  const [currentTime, setCurrentTime] = useState<number>(0)
  const [forcedLibraryTab, setForcedLibraryTab] = useState<'library' | 'my-voices' | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const stopRecordingRef = useRef<(() => void) | null>(null)
  const startRecordingRef = useRef<(() => void) | null>(null)
  const lastSelectedVoiceIdRef = useRef<null | string>(selectedVoiceOption?.value || selectedVoice)
  const audioBlobUrlRef = useRef<null | string>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const cleanupAudioBlobUrl = useCallback(() => {
    if (audioBlobUrlRef.current) {
      URL.revokeObjectURL(audioBlobUrlRef.current)
      audioBlobUrlRef.current = null
    }
  }, [])

  const handleAudioLoad = useCallback(() => {
    if (audioRef.current) {
      const duration = audioRef.current.duration
      setAudioDuration(Number.isFinite(duration) ? duration : 0)
    }
  }, [])

  const handleAudioTimeUpdate = useCallback(() => {
    if (audioRef.current) {
      const currentTime = audioRef.current.currentTime
      setCurrentTime(Number.isFinite(currentTime) ? currentTime : 0)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      pause?.()
      cleanupAudioBlobUrl()
      setSelectedFile(null)
      setIsRecording(false)
      setShowRecording(false)
      setShowVoiceLibrary(false)
      setShowNaming(false)
      setShowPreview(false)
      setUploadError(null)
      setIsRecordingValid(true)
      setRecordingState('idle')
      setForcedLibraryTab(null)
      lastSelectedVoiceIdRef.current = null
    }
  }, [open, pause, cleanupAudioBlobUrl])

  useEffect(() => {
    if (isRecording) {
      const timer = setTimeout(() => setShowRecording(true), 10)
      return () => clearTimeout(timer)
    }
    setShowRecording(false)
  }, [isRecording])

  useEffect(() => {
    return () => {
      cleanupAudioBlobUrl()
    }
  }, [cleanupAudioBlobUrl])

  useEffect(() => {
    const selectedVoiceId = selectedVoiceOption?.value || selectedVoice || null
    if (selectedVoiceId) {
      lastSelectedVoiceIdRef.current = selectedVoiceId
    }
  }, [selectedVoiceOption, selectedVoice])

  useEffect(() => {
    if (!open) {
      return
    }
    if (!voiceOptions.length) {
      return
    }
    const selectedVoiceId = selectedVoiceOption?.value || selectedVoice || null
    const lastSelectedVoiceId = lastSelectedVoiceIdRef.current

    if (selectedVoiceId) {
      const stillExists = voiceOptions.some((voice) => voice.value === selectedVoiceId)
      if (stillExists) {
        return
      }
    } else if (!lastSelectedVoiceId) {
      return
    }

    let defaultVoiceId: null | string = null
    if (typeof window !== 'undefined') {
      defaultVoiceId = localStorage.getItem('defaultVoiceId')
    }

    const defaultVoice = defaultVoiceId
      ? voiceOptions.find((voice) => voice.value === defaultVoiceId) || null
      : null

    if (defaultVoice) {
      onVoiceSelect?.(defaultVoice)
      setForcedLibraryTab(defaultVoice.voiceCloneId ? 'my-voices' : 'library')
    } else {
      onVoiceSelect?.(null)
      setForcedLibraryTab('library')
    }

    setShowVoiceLibrary(true)
    lastSelectedVoiceIdRef.current = null
  }, [voiceOptions, selectedVoiceOption, selectedVoice, onVoiceSelect, open])

  // Sync audio playback state for progress tracking
  useEffect(() => {
    if (audioRef.current && selectedFile) {
      const audioId = `upload-${selectedFile.name}-${selectedFile.size}`
      const isCurrentlyPlaying = playingId === audioId

      if (isCurrentlyPlaying) {
        // Play muted audioRef for progress tracking (useAudio plays the actual sound)
        audioRef.current.muted = true
        audioRef.current.currentTime = 0
        audioRef.current.play().catch((error) => {
          nsLogger.error('Failed to play muted progress audio:', error)
        })
      } else if (!audioRef.current.paused) {
        // Pause when playback stops
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    }
  }, [playingId, selectedFile])

  const toggleFilePlayback = useCallback(() => {
    if (!selectedFile || !toggle) {
      return
    }

    // Use a unique ID for this audio file
    const audioId = `upload-${selectedFile.name}-${selectedFile.size}`
    const isCurrentlyPlaying = playingId === audioId

    if (isCurrentlyPlaying) {
      // Pause the audio - only pause the global player
      pause?.()
    } else {
      // Play the audio - only use toggle (useAudio) to play
      // audioRef is only for metadata (duration/currentTime), not playback
      toggle(audioId, audioBlobUrlRef.current || '')
    }
  }, [selectedFile, toggle, pause, playingId])

  const handleFileSelect = useCallback((file: File) => {
    // Clear any previous errors
    setUploadError(null)

    // Basic validation - let backend handle detailed validation
    const allowedTypes = [
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/m4a',
      'audio/x-m4a',
      'audio/mp4',
      'audio/webm',
    ]
    const allowedExtensions = ['mp3', 'wav', 'm4a', 'webm']
    const maxSize = 10 * 1024 * 1024 // 10MB

    // Check file type
    if (!allowedTypes.includes(file.type)) {
      const errorMessage = 'Invalid file type. Only MP3, WAV, M4A, and WebM are supported'
      setUploadError(errorMessage)
      toast.error(errorMessage)
      return
    }

    // Check file extension
    const fileExt = file.name.split('.').pop()?.toLowerCase()
    if (!fileExt || !allowedExtensions.includes(fileExt)) {
      const errorMessage = 'Invalid file extension. Only MP3, WAV, M4A, and WebM are supported'
      setUploadError(errorMessage)
      toast.error(errorMessage)
      return
    }

    // Check file size
    if (file.size > maxSize) {
      const errorMessage = 'File size too large. Maximum size is 10MB'
      setUploadError(errorMessage)
      toast.error(errorMessage)
      return
    }

    setSelectedFile(file)
    setShowPreview(true)

    // Create blob URL and set up audio element immediately
    const audioUrl = URL.createObjectURL(file)
    audioBlobUrlRef.current = audioUrl

    // Set up the audio element for duration tracking
    if (audioRef.current) {
      audioRef.current.src = audioUrl
      audioRef.current.load()
    }
  }, [])

  const handleFileInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        handleFileSelect(file)
      }
      // Reset the input value to allow selecting the same file again
      e.target.value = ''
    },
    [handleFileSelect],
  )

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const files = Array.from(e.dataTransfer.files)
      if (files.length > 0) {
        handleFileSelect(files[0])
      }
    },
    [handleFileSelect],
  )

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click()
  }, [])

  const handleNext = useCallback(() => {
    if (selectedFile) {
      pause?.()
      onNext?.(selectedFile)
      setShowNaming(true)
      setShowPreview(false)
    }
  }, [selectedFile, onNext, pause])

  const handleUseVoice = useCallback(() => {
    if (selectedVoiceOption) {
      onUseVoice?.(selectedVoiceOption)
    }
  }, [selectedVoiceOption, onUseVoice])

  const handleClearFile = useCallback(() => {
    pause?.()
    cleanupAudioBlobUrl()
    setSelectedFile(null)
    setShowPreview(false)
    setUploadError(null)
  }, [pause, cleanupAudioBlobUrl])

  const handleStartRecording = useCallback(() => {
    setIsRecording(true)
  }, [])

  const handleBackFromRecording = useCallback(() => {
    setIsRecording(false)
    setSelectedFile(null)
    setShowPreview(false)
    setUploadError(null)
  }, [])

  const handleFileSelected = useCallback(
    (file: File) => {
      setSelectedFile(file)
      setShowPreview(true)
      setIsRecording(false)
      setRecordingState('recorded')

      // Cleanup previous audio blob URL if it exists
      cleanupAudioBlobUrl()

      // Create blob URL and set up audio element for recorded files
      const audioUrl = URL.createObjectURL(file)
      audioBlobUrlRef.current = audioUrl

      // Set up the audio element for duration tracking
      if (audioRef.current) {
        audioRef.current.src = audioUrl
        audioRef.current.load()
      }
    },
    [cleanupAudioBlobUrl],
  )

  const handleRenderActionButton = useCallback(
    (params: {
      onStartRecording: () => void
      onStopRecording: () => void
      recordingState: 'idle' | 'loading' | 'recorded' | 'recording' | 'setup' | 'starting'
      recordingTime: number
    }) => {
      startRecordingRef.current = params.onStartRecording
      stopRecordingRef.current = params.onStopRecording
      // Recording time is tracked internally by VoiceRecordingContent
      return null
    },
    [],
  )

  const handleRecordingValidation = useCallback(
    (isValid: boolean) => {
      setIsRecordingValid(isValid)
      if (isValid) {
        // Auto-transition to preview when recording is valid
        // The file will be set via handleFileSelected callback
        // We just need to ensure the preview shows up
        setTimeout(() => {
          if (selectedFile) {
            setShowPreview(true)
            setIsRecording(false)
          }
        }, 100)
      } else {
        // Dismiss any existing toasts first to prevent duplicates
        toast.dismiss()
        toast.error(`Recording too short. Minimum ${minRecordingSeconds} seconds required`)
      }
    },
    [minRecordingSeconds, selectedFile],
  )

  const handleVoiceSelect = useCallback(
    (voice: null | VoiceOption) => {
      onVoiceSelect?.(voice)
      // Keep voice library open when selecting a voice
    },
    [onVoiceSelect],
  )

  const handleStopRecording = useCallback((stopRecordingFn: () => void) => {
    stopRecordingRef.current = stopRecordingFn
  }, [])

  const handleRecordingStateChange = useCallback(
    (state: 'idle' | 'loading' | 'recorded' | 'recording' | 'setup' | 'starting') => {
      setRecordingState(state)
    },
    [],
  )

  const handleNamingContinue = useCallback(
    (voiceName: string) => {
      pause?.()
      onVoiceNamingComplete?.(voiceName)
    },
    [onVoiceNamingComplete, pause],
  )

  const handleBack = useCallback(() => {
    if (showNaming) {
      pause?.()
      setShowNaming(false)
      setShowPreview(false)
      setSelectedFile(null)
      setIsRecording(false)
      setShowRecording(false)
      setShowVoiceLibrary(false)
      setUploadError(null)
      setIsRecordingValid(true)
    } else if (showVoiceLibrary) {
      setShowVoiceLibrary(false)
      onVoiceSelect?.(null)
    } else if (showPreview) {
      pause?.()
      setShowPreview(false)
      setSelectedFile(null)
    } else if (isRecording) {
      pause?.()
      if (recordingState === 'recording') {
        stopRecordingRef.current?.()
      } else {
        setIsRecording(false)
        setSelectedFile(null)
        setIsRecordingValid(true)
      }
    } else {
      pause?.()
      onBack?.()
    }
  }, [
    showNaming,
    showVoiceLibrary,
    showPreview,
    isRecording,
    recordingState,
    onBack,
    pause,
    onVoiceSelect,
  ])

  // Handle dialog close - allow closing via X button or backdrop
  const handleOpenChange = useCallback(
    (isOpen: boolean) => {
      if (!isOpen) {
        onClose?.()
      }
    },
    [onClose],
  )

  return (
    <Dialog
      classNames={{
        content: cn(
          'flex flex-col w-full h-full max-w-[560px] p-6 z-[64] border-none bg-menu-background backdrop-blur-2xl backdrop-filter rounded-t-3xl md:h-auto md:rounded-sm',
          dialogContentClassName,
        ),
        overlay: cn('z-[63] backdrop-blur-[2px] backdrop-filter', dialogOverlayClassName),
      }}
      footer={
        <VoiceDialogFooter
          hideVoiceLibrary={hideVoiceLibrary}
          isRecording={isRecording}
          isRecordingValid={isRecordingValid}
          isVoiceLoading={isVoiceLoading}
          onBack={handleBack}
          onChooseLibrary={() => setShowVoiceLibrary(true)}
          onEnterRecording={handleStartRecording}
          onNext={handleNext}
          onStartRecording={() => startRecordingRef.current?.()}
          onStopRecording={() => stopRecordingRef.current?.()}
          onUploadClick={handleUploadClick}
          onUseVoice={handleUseVoice}
          recordingState={recordingState}
          selectedFile={selectedFile}
          selectedVoiceOption={selectedVoiceOption}
          showNaming={showNaming}
          showVoiceLibrary={showVoiceLibrary}
        />
      }
      ignoreInteractOutside={true}
      onOpenChange={handleOpenChange}
      open={open}
      showClose={!isBelowMd}
    >
      <div className="flex flex-col gap-4 flex-1 md:flex-none min-h-0">
        <VoiceDialogHeader
          context={context}
          description={headerDescription}
          isRecording={isRecording}
          minSeconds={minRecordingSeconds}
          onClose={() => handleOpenChange(false)}
          recordingState={recordingState}
          title={headerTitle}
        />

        {!isRecording && !showVoiceLibrary && !showNaming && !showPreview && uploadHeader}

        {!isRecording && !showVoiceLibrary && !showNaming && !showPreview && (
          <VoiceUploadContent
            context={context === 'avatar' ? 'avatar' : 'voice'}
            isDragging={isDragging}
            minSeconds={minRecordingSeconds}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onStartRecording={handleStartRecording}
            onUploadClick={handleUploadClick}
            selectedFile={selectedFile}
          />
        )}

        {isRecording && (
          <div
            className={cn(
              'flex-1 md:flex-none min-h-0 transition-opacity duration-200',
              showRecording ? 'opacity-100' : 'opacity-0',
            )}
          >
            <VoiceRecordingContent
              minSeconds={minRecordingSeconds}
              onBack={handleBackFromRecording}
              onFileSelected={handleFileSelected}
              onRecordingStateChange={handleRecordingStateChange}
              onRecordingValidation={handleRecordingValidation}
              onStopRecording={handleStopRecording}
              renderActionButton={handleRenderActionButton}
              selectedFile={selectedFile}
            />
          </div>
        )}

        {showVoiceLibrary && (
          <VoiceLibraryView
            forcedTab={forcedLibraryTab}
            isVoicePlaying={isVoicePlaying}
            onForcedTabApplied={() => setForcedLibraryTab(null)}
            onPlayVoice={onPlayVoice}
            onVoiceSelect={handleVoiceSelect}
            selectedVoice={selectedVoice}
            selectedVoiceOption={selectedVoiceOption}
            voiceOptions={voiceOptions}
          />
        )}

        {showPreview && selectedFile && (
          <AudioPreview
            audioDuration={audioDuration}
            currentTime={currentTime}
            isVoiceLoading={isVoiceLoading}
            onClearFile={handleClearFile}
            playingId={playingId}
            selectedFile={selectedFile}
            toggleFilePlayback={toggleFilePlayback}
          />
        )}

        {showNaming && selectedFile && (
          <div className="transition-opacity duration-200 opacity-100">
            <VoiceNamingContent
              audioFile={selectedFile}
              isPlaying={(() => {
                if (!selectedFile || !playingId || !toggle) {
                  return false
                }
                const audioId = `upload-${selectedFile.name}-${selectedFile.size}`
                return playingId === audioId
              })()}
              isVoiceLoading={isVoiceLoading}
              isVoicePlaying={isVoicePlaying}
              onBack={onBack}
              onContinue={handleNamingContinue}
              onPlayPause={toggleFilePlayback}
              onPlayVoice={onPlayVoice}
              pause={pause}
              playingId={playingId}
              previewAudioUrl={previewAudioUrl}
              selectedVoiceOption={selectedVoiceOption || undefined}
              toggle={toggle}
            />
          </div>
        )}
      </div>

      <input
        accept=".mp3,.wav,.m4a,.webm"
        className="hidden"
        onChange={handleFileInputChange}
        ref={fileInputRef}
        type="file"
      />

      {/* Hidden audio element for duration tracking */}
      {selectedFile && (
        <audio
          onLoadedMetadata={handleAudioLoad}
          onTimeUpdate={handleAudioTimeUpdate}
          ref={audioRef}
          src={audioBlobUrlRef.current || undefined}
        />
      )}
    </Dialog>
  )
}
