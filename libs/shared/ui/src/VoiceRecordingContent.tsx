'use client'

import { LoaderCircle } from 'lucide-react'
import React, { useCallback, useEffect, useRef, useState } from 'react'

type RecordingState = 'idle' | 'loading' | 'recorded' | 'recording' | 'setup' | 'starting'
interface VoiceRecordingContentProps {
  /** Shortest recording accepted, in seconds. */
  minSeconds?: number
  onBack?: () => void
  onFileSelected?: (file: File) => void
  onRecordingStateChange?: (state: RecordingState) => void
  onRecordingValidation?: (isValid: boolean) => void
  onStopRecording?: (stopRecordingFn: () => void) => void
  renderActionButton?: (params: {
    onStartRecording: () => void
    onStopRecording: () => void
    recordingState: RecordingState
    recordingTime: number
  }) => React.ReactNode
  selectedFile?: File | null
}

export function VoiceRecordingContent({
  minSeconds = 15,
  onFileSelected,
  onRecordingStateChange,
  onRecordingValidation,
  onStopRecording,
  renderActionButton,
}: VoiceRecordingContentProps) {
  const [recordingState, setRecordingState] = useState<RecordingState>('idle')
  const [recordingTime, setRecordingTime] = useState(0)
  const [audioDevices, setAudioDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const recordingStartTimeRef = useRef<number>(0)
  const [audioLevel, setAudioLevel] = useState(0)

  const requestMicPermission = useCallback(async () => {
    setRecordingState('loading')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const devices = await navigator.mediaDevices.enumerateDevices()
      const audioInputs = devices.filter((device) => device.kind === 'audioinput')
      setAudioDevices(audioInputs)

      if (audioInputs.length > 0) {
        setSelectedDeviceId(audioInputs[0].deviceId)
      }

      setRecordingState('setup')
    } catch {
      // Failed to request microphone permission
      setRecordingState('idle')
    }
  }, [])

  useEffect(() => {
    requestMicPermission()
  }, [requestMicPermission])

  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current = null
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
        streamRef.current = null
      }
      if (audioContextRef.current) {
        audioContextRef.current.close()
        audioContextRef.current = null
      }
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
    }
  }, [])

  const startRecording = useCallback(async () => {
    setRecordingState('starting')
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop())
      }

      const constraints = {
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      }
      const stream = await navigator.mediaDevices.getUserMedia(constraints)
      streamRef.current = stream

      const audioContext = new AudioContext()
      audioContextRef.current = audioContext
      const source = audioContext.createMediaStreamSource(stream)
      const analyser = audioContext.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      analyserRef.current = analyser

      const dataArray = new Uint8Array(analyser.frequencyBinCount)
      const updateAudioLevel = () => {
        if (analyserRef.current) {
          analyserRef.current.getByteFrequencyData(dataArray)
          const average = dataArray.reduce((a, b) => a + b) / dataArray.length
          setAudioLevel(average / 255)
          requestAnimationFrame(updateAudioLevel)
        }
      }
      updateAudioLevel()

      const mediaRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = mediaRecorder
      audioChunksRef.current = []

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data)
        }
      }

      mediaRecorder.onstop = () => {
        const mimeType = mediaRecorder.mimeType || 'audio/webm'
        const ext = mimeType.includes('mp4') ? 'm4a' : 'webm'
        const blob = new Blob(audioChunksRef.current, { type: mimeType })

        const file = new File([blob], `recording-${Date.now()}.${ext}`, {
          type: mimeType,
        })

        // Use the current recording time state for validation instead of ref
        setRecordingTime((currentTime) => {
          return currentTime
        })

        // Handle validation and file selection after state update
        const elapsedSeconds = (Date.now() - recordingStartTimeRef.current) / 1000
        setTimeout(() => {
          if (elapsedSeconds >= minSeconds) {
            onFileSelected?.(file)
            onRecordingValidation?.(true)
            setRecordingState('recorded')
          } else {
            onRecordingValidation?.(false)
            setRecordingState('setup')
          }
        }, 0)

        // Clean up resources
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
          streamRef.current = null
        }
        if (audioContextRef.current) {
          audioContextRef.current.close()
          audioContextRef.current = null
        }
        analyserRef.current = null
        setAudioLevel(0)
      }

      mediaRecorder.start()
      recordingStartTimeRef.current = Date.now()
      setRecordingState('recording')
      setRecordingTime(0)

      timerRef.current = setInterval(() => {
        setRecordingTime((prev) => {
          const newTime = prev + 1
          if (newTime >= 30) {
            // Clear timer first to prevent race condition
            if (timerRef.current) {
              clearInterval(timerRef.current)
              timerRef.current = null
            }
            // Stop recording if still active
            if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
              mediaRecorderRef.current.stop()
            }
            return 30
          }
          return newTime
        })
      }, 1000)
    } catch {
      // Failed to start recording
    }
  }, [selectedDeviceId, onFileSelected, minSeconds])

  const stopRecording = useCallback(() => {
    // Clear timer first to prevent race condition
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
      // Note: Validation will be handled in the onstop handler
    }

    // Clean up AudioContext
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }
  }, [])

  // Expose stopRecording function to parent
  useEffect(() => {
    if (onStopRecording) {
      onStopRecording(stopRecording)
    }
  }, [onStopRecording, stopRecording])

  // Expose action buttons to parent via renderActionButton
  useEffect(() => {
    if (renderActionButton) {
      renderActionButton({
        recordingState,
        recordingTime,
        onStartRecording: startRecording,
        onStopRecording: stopRecording,
      })
    }
  }, [renderActionButton, recordingState, recordingTime, startRecording, stopRecording])

  // Notify parent of recording state changes
  useEffect(() => {
    if (onRecordingStateChange) {
      onRecordingStateChange(recordingState)
    }
  }, [recordingState, onRecordingStateChange])

  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  const getCurrentTime = () => {
    if (recordingState === 'recording') {
      return formatTime(recordingTime)
    }
    if (recordingState === 'recorded') {
      return formatTime(recordingTime)
    }
    return '00:00'
  }

  const getTotalTime = () => {
    return '00:30'
  }

  if (recordingState !== 'idle') {
    return (
      <div className="bg-[var(--fill-tertiary)] relative rounded-md p-4 flex flex-col h-full md:h-[377px]">
        <div className="absolute md:border-2 md:border-[var(--border-tertiary)] md:border-dashed -inset-px pointer-events-none rounded-[13px]" />
        {recordingState !== 'recorded' && (
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-0.5 items-center">
              {Array.from({ length: 27 }).map((_, i) => {
                const baseOpacities = [
                  0.1, 0.3, 0.5, 0.7, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0.7,
                  0.5, 0.3, 0.1,
                ]
                const baseHeight = [
                  2, 4, 6, 8, 10, 12, 14, 16, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 18, 16, 14,
                  12, 10, 8, 6, 4, 2,
                ]
                const opacity =
                  recordingState === 'recording'
                    ? Math.min(baseOpacities[i] + audioLevel * 0.5, 1)
                    : baseOpacities[i] || 0.1
                const height =
                  recordingState === 'recording'
                    ? Math.max(1, baseHeight[i] * (0.3 + audioLevel * 0.7))
                    : 1
                return (
                  <div
                    className="bg-[var(--fill-primary)] rounded-full w-0.5"
                    key={i}
                    style={{
                      opacity,
                      height: `${height}px`,
                    }}
                  />
                )
              })}
            </div>

            <div className="flex gap-1.5 items-center">
              <div className="bg-[var(--fill-secondary)] px-1.5 py-0 rounded-xxs h-5 flex items-center">
                <span className="text-xs font-medium text-[var(--primary)]">
                  {getCurrentTime()}
                </span>
              </div>
              <span className="text-xs text-[var(--secondary)]">/</span>
              <div className="bg-[var(--fill-secondary)] px-1.5 py-0 rounded-xxs h-5 flex items-center">
                <span className="text-xs font-medium text-[var(--primary)]">{getTotalTime()}</span>
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 flex flex-col gap-4 items-center justify-center min-h-0">
          {recordingState === 'loading' ? (
            <div className="flex flex-col gap-2 items-center justify-center">
              <LoaderCircle className="size-5 animate-spin text-secondary" />
              <span className="text-sm text-secondary">Preparing microphone...</span>
            </div>
          ) : recordingState === 'setup' || recordingState === 'starting' ? (
            <div className="flex flex-col gap-4 items-center justify-center w-full max-w-[300px]">
              {/* Microphone Selector */}
              <div className="relative w-full">
                <select
                  className="appearance-none h-[38px] rounded-sm border border-[var(--border-subtle)] bg-[var(--fill-hover)] text-[var(--primary)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--fill-secondary)] w-full truncate pl-10 pr-9"
                  onChange={(e) => setSelectedDeviceId(e.target.value)}
                  value={selectedDeviceId}
                >
                  {audioDevices.map((device) => (
                    <option
                      key={device.deviceId}
                      style={{ background: 'var(--bg-overlay)' }}
                      value={device.deviceId}
                    >
                      {device.label || `Microphone ${audioDevices.indexOf(device) + 1}`}
                    </option>
                  ))}
                </select>
                <svg
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none size-4.5"
                  fill="none"
                  viewBox="0 0 19 18"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M15 7.5C15.4142 7.5 15.75 7.83579 15.75 8.25C15.75 11.3096 13.4596 13.8325 10.5 14.2017V15H12.75C13.1642 15 13.5 15.3358 13.5 15.75C13.5 16.1642 13.1642 16.5 12.75 16.5H6.75C6.33579 16.5 6 16.1642 6 15.75C6 15.3358 6.33579 15 6.75 15H9V14.2017C6.04038 13.8325 3.75 11.3096 3.75 8.25C3.75 7.83579 4.08579 7.5 4.5 7.5C4.91421 7.5 5.25 7.83579 5.25 8.25C5.25 10.7353 7.26472 12.75 9.75 12.75C12.2353 12.75 14.25 10.7353 14.25 8.25C14.25 7.83579 14.5858 7.5 15 7.5ZM9.75 1.5C11.4069 1.5 12.75 2.84315 12.75 4.5V8.25C12.75 9.90685 11.4069 11.25 9.75 11.25C8.09315 11.25 6.75 9.90685 6.75 8.25V4.5C6.75 2.84315 8.09315 1.5 9.75 1.5ZM9.75 3C8.92157 3 8.25 3.67157 8.25 4.5V8.25C8.25 9.07843 8.92157 9.75 9.75 9.75C10.5784 9.75 11.25 9.07843 11.25 8.25V4.5C11.25 3.67157 10.5784 3 9.75 3Z"
                    fill="var(--primary)"
                  />
                </svg>
                <svg
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none size-4.5"
                  fill="none"
                  viewBox="0 0 19 18"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12.9697 6.96967C13.2626 6.67678 13.7374 6.67678 14.0302 6.96967C14.3231 7.26257 14.3231 7.73735 14.0302 8.03022L10.2802 11.7802C9.98736 12.0731 9.51258 12.0731 9.21968 11.7802L5.46967 8.03022C5.17678 7.73733 5.17678 7.26257 5.46967 6.96967C5.76256 6.67678 6.23733 6.67678 6.53022 6.96967L9.74996 10.1894L12.9697 6.96967Z"
                    fill="var(--primary)"
                  />
                </svg>
              </div>

              {/* Instructions */}
              <div className="flex flex-col gap-0 items-center justify-center w-full">
                <div className="flex gap-1 items-center justify-start w-full">
                  <svg className="size-3.5 shrink-0" fill="var(--secondary)" viewBox="0 0 14 14">
                    <path d="M6.5 10.5L3 7l1-1 2.5 2.5L11 4l1 1-5.5 5.5z" />
                  </svg>
                  <span className="text-xs text-[var(--secondary)]">
                    Make sure you're in a quiet place
                  </span>
                </div>
                <div className="flex gap-1 items-center justify-start w-full">
                  <svg className="size-3.5 shrink-0" fill="var(--secondary)" viewBox="0 0 14 14">
                    <path d="M6.5 10.5L3 7l1-1 2.5 2.5L11 4l1 1-5.5 5.5z" />
                  </svg>
                  <span className="text-xs text-[var(--secondary)]">
                    Record at least {minSeconds} seconds of continuous speech
                  </span>
                </div>
                <div className="flex gap-1 items-center justify-start w-full">
                  <svg className="size-3.5 shrink-0" fill="var(--secondary)" viewBox="0 0 14 14">
                    <path d="M6.5 10.5L3 7l1-1 2.5 2.5L11 4l1 1-5.5 5.5z" />
                  </svg>
                  <span className="text-xs text-[var(--secondary)]">
                    Speak naturally without long pauses
                  </span>
                </div>
              </div>
            </div>
          ) : recordingState === 'recording' ? (
            <div className="flex flex-col items-center justify-start flex-1 w-full px-4 overflow-y-auto scrollbar-thin min-h-0">
              <div className="text-[var(--primary)] text-sm md:text-base leading-6 w-full max-w-[480px]">
                <p>
                  Travel changes how you see the world.
                  <br />
                  When you step into a new place, everything feels unfamiliar — the sounds, the
                  pace, the way people live. That opens your mind.
                </p>
                <p>
                  You start noticing connections you've never seen, realizing there's more than one
                  way to live, create, and solve problems. And then you see exploration isn't just
                  about going somewhere new — it's about shifting your perspective and discovering
                  possibilities you never imagined.
                </p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    )
  }

  return null
}
