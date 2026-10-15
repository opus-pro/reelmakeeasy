import { cn } from '@shared/ui/lib/utils'
import React from 'react'

import { Export, Folder, Loading, StopFilled } from '@/components/icons/core'
import { useBreakpoint } from '@/util/browserUtils'

import { type VoiceOption } from './voice-over-selection'

interface MobileFooterProps {
  isRecording: boolean
  isRecordingValid: boolean
  onBack: () => void
  onEnterRecording?: () => void
  onNext?: () => void
  onStartRecording?: () => void
  onStopRecording?: () => void
  onUploadClick?: () => void
  onUseVoice?: () => void
  recordingState: 'idle' | 'loading' | 'recorded' | 'recording' | 'setup' | 'starting'
  selectedFile?: File | null
  selectedVoiceOption?: null | VoiceOption
}

interface VoiceDialogFooterProps {
  hideVoiceLibrary?: boolean
  isRecording: boolean
  isRecordingValid: boolean
  isVoiceLoading?: boolean
  onBack: () => void
  onChooseLibrary: () => void
  onEnterRecording?: () => void
  onNext?: () => void
  onStartRecording?: () => void
  onStopRecording?: () => void
  onUploadClick?: () => void
  onUseVoice?: () => void
  recordingState: 'idle' | 'loading' | 'recorded' | 'recording' | 'setup' | 'starting'
  selectedFile?: File | null
  selectedVoiceOption?: null | VoiceOption
  showNaming: boolean
  showVoiceLibrary: boolean
}

export function VoiceDialogFooter({
  hideVoiceLibrary = false,
  isRecording,
  isRecordingValid,
  isVoiceLoading = false,
  onBack,
  onChooseLibrary,
  onEnterRecording,
  onNext,
  onStartRecording,
  onStopRecording,
  onUploadClick,
  onUseVoice,
  recordingState,
  selectedFile,
  selectedVoiceOption,
  showNaming,
  showVoiceLibrary,
}: VoiceDialogFooterProps) {
  const { isBelowMd } = useBreakpoint('md')

  if (showNaming || isVoiceLoading) {
    return null
  }

  if (isBelowMd) {
    return (
      <MobileVoiceDialogFooter
        isRecording={isRecording}
        isRecordingValid={isRecordingValid}
        onBack={onBack}
        onEnterRecording={onEnterRecording}
        onNext={onNext}
        onStartRecording={onStartRecording}
        onStopRecording={onStopRecording}
        onUploadClick={onUploadClick}
        onUseVoice={onUseVoice}
        recordingState={recordingState}
        selectedFile={selectedFile}
        selectedVoiceOption={selectedVoiceOption}
      />
    )
  }

  return (
    <div className="flex gap-2 items-center justify-between">
      <button
        className="flex gap-1.5 items-center justify-center h-[38px] px-[10px] rounded-sm bg-fill-secondary md:hover:bg-fill-hover transition-colors"
        onClick={onBack}
        type="button"
      >
        <span className="text-sm font-medium text-white">Back</span>
      </button>
      <div className="flex gap-2">
        {!hideVoiceLibrary &&
          !isRecording &&
          !showVoiceLibrary &&
          !selectedFile &&
          !selectedVoiceOption && (
            <button
              className="flex gap-1.5 items-center justify-center h-[38px] px-[10px] rounded-sm bg-fill-secondary md:hover:bg-fill-hover transition-colors"
              onClick={() => {
                onChooseLibrary()
              }}
              type="button"
            >
              <Folder className="size-[18px]" />
              <span className="text-sm font-medium text-white">Voices</span>
            </button>
          )}

        {/* Show recording button when in recording mode */}
        {isRecording && (
          <>
            {recordingState === 'loading' ? (
              <button
                className="flex gap-1.5 items-center justify-center h-[38px] px-[10px] rounded-sm bg-white opacity-50 cursor-not-allowed transition-colors"
                disabled
                type="button"
              >
                <span className="text-sm font-medium text-black">Start recording</span>
              </button>
            ) : recordingState === 'starting' ? (
              <button
                className="flex gap-1.5 items-center justify-center h-[38px] px-[10px] rounded-sm bg-white opacity-50 cursor-not-allowed transition-colors"
                disabled
                type="button"
              >
                <Loading className="size-4 animate-spin text-black" />
                <span className="text-sm font-medium text-black">Starting...</span>
              </button>
            ) : recordingState === 'setup' ? (
              <button
                className="flex gap-1.5 items-center justify-center h-[38px] px-[10px] rounded-sm bg-white md:hover:bg-white/90 transition-colors"
                onClick={onStartRecording}
                type="button"
              >
                <span className="text-sm font-medium text-black">Start recording</span>
              </button>
            ) : recordingState === 'recording' ? (
              <button
                className="flex gap-1.5 items-center justify-center h-[38px] px-[10px] rounded-sm transition-colors bg-[#CF4020] md:hover:bg-[#CF4020]/90"
                onClick={onStopRecording}
                type="button"
              >
                <StopFilled className="size-[18px]" />
                <span className="text-sm font-medium text-primary">Stop recording</span>
              </button>
            ) : null}
          </>
        )}

        {/* Show Continue/Use voice button when not recording */}
        {!isRecording && (
          <button
            className={cn(
              'flex gap-1.5 items-center justify-center h-[38px] px-2.5 rounded-sm transition-colors',
              (selectedFile || selectedVoiceOption) && isRecordingValid
                ? 'bg-white md:hover:bg-white/90'
                : 'bg-white opacity-50 cursor-not-allowed',
            )}
            disabled={(!selectedFile && !selectedVoiceOption) || !isRecordingValid}
            onClick={selectedVoiceOption ? onUseVoice : onNext}
            type="button"
          >
            <span className="text-sm font-medium text-black">
              {selectedVoiceOption ? 'Apply' : 'Continue'}
            </span>
          </button>
        )}
      </div>
    </div>
  )
}

function MobileVoiceDialogFooter({
  isRecording,
  isRecordingValid,
  onBack,
  onEnterRecording,
  onNext,
  onStartRecording,
  onStopRecording,
  onUploadClick,
  onUseVoice,
  recordingState,
  selectedFile,
  selectedVoiceOption,
}: MobileFooterProps) {
  if (isRecording) {
    return (
      <div className="flex max-w-full gap-2 items-center">
        <button
          className="flex flex-1 gap-1.5 items-center justify-center h-[48px] px-2.5 rounded-full transition-colors bg-fill-secondary md:hover:bg-fill-hover"
          onClick={onBack}
          type="button"
        >
          <span className="text-base font-medium text-white">Back</span>
        </button>

        {recordingState === 'setup' ? (
          <button
            className="flex flex-1 gap-1.5 items-center justify-center h-[48px] px-2.5 rounded-full transition-colors bg-white md:hover:bg-white/90"
            onClick={onStartRecording}
            type="button"
          >
            <span className="text-base font-medium text-black">Start recording</span>
          </button>
        ) : recordingState === 'recording' ? (
          <button
            className="flex flex-1 gap-1.5 items-center justify-center h-[48px] px-2.5 rounded-full transition-colors bg-[#CF4020] md:hover:bg-[#CF4020]/90"
            onClick={onStopRecording}
            type="button"
          >
            <StopFilled className="size-[18px]" />
            <span className="text-base font-medium text-primary">Stop</span>
          </button>
        ) : null}
      </div>
    )
  }

  if (selectedFile || selectedVoiceOption) {
    return (
      <div className="flex max-w-full gap-2 items-center">
        <button
          className="flex flex-1 gap-1.5 items-center justify-center h-[48px] px-2.5 rounded-full transition-colors bg-fill-secondary md:hover:bg-fill-hover"
          onClick={onBack}
          type="button"
        >
          <span className="text-base font-medium text-white">Back</span>
        </button>
        <button
          className={cn(
            'flex flex-1 gap-1.5 items-center justify-center h-[48px] px-2.5 rounded-full transition-colors',
            (selectedFile || selectedVoiceOption) && isRecordingValid
              ? 'bg-white md:hover:bg-white/90'
              : 'bg-white opacity-50 cursor-not-allowed',
          )}
          disabled={(!selectedFile && !selectedVoiceOption) || !isRecordingValid}
          onClick={selectedVoiceOption ? onUseVoice : onNext}
          type="button"
        >
          <span className="text-base font-medium text-black">Continue</span>
        </button>
      </div>
    )
  }

  return (
    <div className="flex max-w-full gap-2 items-center">
      <button
        className="flex flex-1 gap-1.5 items-center justify-center h-[48px] md:h-[36px] px-2.5 rounded-full md:rounded-sm transition-colors bg-fill-secondary md:hover:bg-fill-hover"
        onClick={onEnterRecording}
        type="button"
      >
        <svg
          className="size-4.5"
          fill="none"
          viewBox="0 0 19 19"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M14.75 8C15.1642 8 15.5 8.33579 15.5 8.75C15.5 11.8096 13.2096 14.3325 10.25 14.7017V15.5H12.5C12.9142 15.5 13.25 15.8358 13.25 16.25C13.25 16.6642 12.9142 17 12.5 17H6.5C6.08579 17 5.75 16.6642 5.75 16.25C5.75 15.8358 6.08579 15.5 6.5 15.5H8.75V14.7017C5.79038 14.3325 3.5 11.8096 3.5 8.75C3.5 8.33579 3.83579 8 4.25 8C4.66421 8 5 8.33579 5 8.75C5 11.2353 7.01472 13.25 9.5 13.25C11.9853 13.25 14 11.2353 14 8.75C14 8.33579 14.3358 8 14.75 8ZM9.5 2C11.1569 2 12.5 3.34315 12.5 5V8.75C12.5 10.4069 11.1569 11.75 9.5 11.75C7.84315 11.75 6.5 10.4069 6.5 8.75V5C6.5 3.34315 7.84315 2 9.5 2ZM9.5 3.5C8.67157 3.5 8 4.17157 8 5V8.75C8 9.57843 8.67157 10.25 9.5 10.25C10.3284 10.25 11 9.57843 11 8.75V5C11 4.17157 10.3284 3.5 9.5 3.5Z"
            fill="var(--primary)"
          />
        </svg>
        <span className="text-base font-medium text-primary">Record Voice</span>
      </button>

      <button
        className="flex flex-1 gap-1.5 items-center justify-center h-[48px] md:h-[36px] px-2.5 rounded-full md:rounded-sm transition-colors bg-fill-secondary md:hover:bg-fill-hover"
        onClick={onUploadClick}
        type="button"
      >
        <Export className="size-4.5 text-primary" />
        <span className="text-base font-medium text-primary">Upload File</span>
      </button>
    </div>
  )
}
