'use client'

import type { DictationEngine, DictationSetting, DictationStatus } from '@shared/types/api/setup'
import { useCallback, useEffect, useRef, useState } from 'react'

import { useApi } from '@/hooks/useApi'

import {
  getDictationStatus,
  prewarmDictation,
  setDictationSetting,
  transcribeRecording,
} from './dictation-api'
import { recordingMimeType } from './dictation-text'

/** A recording stops on its own after two minutes (the API's limit). */
export const MAX_RECORDING_SECONDS = 120
/** Whisper unloads after five idle minutes: warm it again after four. */
const PREWARM_EVERY_MS = 4 * 60_000

export type DictationPhase = 'idle' | 'listening' | 'transcribing'

/** The browser's own speech recognition, as far as voice typing uses it. */
interface BrowserRecognition {
  abort(): void
  continuous: boolean
  interimResults: boolean
  lang: string
  onend: (() => void) | null
  onerror: ((event: { error: string }) => void) | null
  onresult:
    | ((event: {
        resultIndex: number
        results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>
      }) => void)
    | null
  start(): void
  stop(): void
}

type RecognitionConstructor = new () => BrowserRecognition

function browserRecognition(): null | RecognitionConstructor {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionConstructor
    webkitSpeechRecognition?: RecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

const canRecord = (): boolean =>
  typeof navigator !== 'undefined' &&
  Boolean(navigator.mediaDevices?.getUserMedia) &&
  recordingMimeType() !== undefined

/**
 * Voice typing for a text box. `start` listens; `stop` turns what was said into text and hands
 * it to `onText` (the browser engine also streams it through `onPartial` while you talk);
 * `cancel` throws it away. `choose` saves which engine to use.
 */
export type Dictation = ReturnType<typeof useDictation>

export function useDictation({
  onPartial,
  onText,
}: {
  onPartial?: (text: string) => void
  onText: (text: string) => void
}) {
  const { fetchApiDomain } = useApi()
  const [status, setStatus] = useState<DictationStatus | null>(null)
  const [phase, setPhase] = useState<DictationPhase>('idle')
  const [error, setError] = useState<null | string>(null)
  const [elapsed, setElapsed] = useState(0)
  const [level, setLevel] = useState(0)

  const onTextRef = useRef(onText)
  const onPartialRef = useRef(onPartial)
  onTextRef.current = onText
  onPartialRef.current = onPartial

  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const recognition = useRef<BrowserRecognition | null>(null)
  const audioContext = useRef<AudioContext | null>(null)
  const frame = useRef<null | number>(null)
  const ticker = useRef<null | ReturnType<typeof setInterval>>(null)
  const cancelled = useRef(false)
  const lastPrewarm = useRef(0)

  const refresh = useCallback(async () => {
    try {
      setStatus(await getDictationStatus(fetchApiDomain))
    } catch {
      setStatus(null)
    }
  }, [fetchApiDomain])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const browserSupported = browserRecognition() !== null
  const engine: DictationEngine | null =
    status?.engine === 'browser' && !browserSupported ? null : (status?.engine ?? null)
  const available = engine !== null && (engine === 'browser' ? browserSupported : canRecord())

  const stopMeters = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current)
    frame.current = null
    if (ticker.current) clearInterval(ticker.current)
    ticker.current = null
    void audioContext.current?.close().catch(() => undefined)
    audioContext.current = null
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
    setLevel(0)
  }, [])

  const startTimer = useCallback((onLimit: () => void) => {
    const started = Date.now()
    setElapsed(0)
    ticker.current = setInterval(() => {
      const seconds = (Date.now() - started) / 1000
      setElapsed(seconds)
      if (seconds >= MAX_RECORDING_SECONDS) onLimit()
    }, 250)
  }, [])

  const meter = useCallback((media: MediaStream) => {
    const AudioCtx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtx) return
    const context = new AudioCtx()
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    context.createMediaStreamSource(media).connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    const tick = () => {
      analyser.getByteTimeDomainData(samples)
      let peak = 0
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128)
      setLevel(peak)
      frame.current = requestAnimationFrame(tick)
    }
    audioContext.current = context
    tick()
  }, [])

  const startBrowser = useCallback(
    (Recognition: RecognitionConstructor) => {
      const rec = new Recognition()
      rec.continuous = true
      rec.interimResults = true
      rec.lang = 'en-US'
      let finals = ''
      rec.onresult = (event) => {
        let interim = ''
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (!result) continue
          if (result.isFinal) finals += result[0].transcript
          else interim += result[0].transcript
        }
        onPartialRef.current?.(`${finals}${interim}`.trim())
      }
      rec.onerror = (event) => {
        if (event.error === 'aborted' || event.error === 'no-speech') return
        setError(
          event.error === 'not-allowed'
            ? 'Allow the microphone for this page to use voice typing.'
            : `Voice typing stopped (${event.error}).`,
        )
      }
      rec.onend = () => {
        recognition.current = null
        stopMeters()
        setPhase('idle')
        if (!cancelled.current) onTextRef.current(finals.trim())
      }
      recognition.current = rec
      rec.start()
      setPhase('listening')
      startTimer(() => rec.stop())
      // The browser's recognizer gives no level: open the mic as well, only for the sound wave.
      void navigator.mediaDevices
        ?.getUserMedia({ audio: true })
        .then((media) => {
          if (recognition.current !== rec) {
            media.getTracks().forEach((track) => track.stop())
            return
          }
          stream.current = media
          meter(media)
        })
        .catch(() => undefined)
    },
    [meter, startTimer, stopMeters],
  )

  const startRecording = useCallback(async () => {
    const mimeType = recordingMimeType()
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Allow the microphone for this page to use voice typing.')
      return
    }
    stream.current = media
    const chunks: Blob[] = []
    const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
    rec.ondataavailable = (event) => {
      if (event.data.size) chunks.push(event.data)
    }
    rec.onstop = () => {
      recorder.current = null
      stopMeters()
      if (cancelled.current || !chunks.length) {
        setPhase('idle')
        return
      }
      setPhase('transcribing')
      const audio = new Blob(chunks, { type: rec.mimeType || mimeType })
      transcribeRecording(fetchApiDomain, audio, engine ?? undefined)
        .then(({ text }) => onTextRef.current(text))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => setPhase('idle'))
    }
    recorder.current = rec
    rec.start()
    meter(media)
    setPhase('listening')
    startTimer(() => rec.state === 'recording' && rec.stop())
  }, [engine, fetchApiDomain, meter, startTimer, stopMeters])

  const start = useCallback(() => {
    if (phase !== 'idle' || !engine) return
    setError(null)
    cancelled.current = false
    const Recognition = browserRecognition()
    if (engine === 'browser' && Recognition) startBrowser(Recognition)
    else void startRecording()
  }, [engine, phase, startBrowser, startRecording])

  const stop = useCallback(() => {
    if (recognition.current) recognition.current.stop()
    else if (recorder.current?.state === 'recording') recorder.current.stop()
  }, [])

  const cancel = useCallback(() => {
    cancelled.current = true
    if (recognition.current) recognition.current.abort()
    else if (recorder.current?.state === 'recording') recorder.current.stop()
    stopMeters()
    setPhase('idle')
  }, [stopMeters])

  const toggle = useCallback(() => (phase === 'listening' ? stop() : start()), [phase, start, stop])

  /** Loads Whisper while the user is about to talk (Whisper engine only, once every few minutes). */
  const prewarm = useCallback(() => {
    if (engine !== 'local' || Date.now() - lastPrewarm.current < PREWARM_EVERY_MS) return
    lastPrewarm.current = Date.now()
    void prewarmDictation(fetchApiDomain)
  }, [engine, fetchApiDomain])

  const choose = useCallback(
    async (setting: DictationSetting) => {
      try {
        setStatus(await setDictationSetting(fetchApiDomain, setting))
        setError(null)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      }
    },
    [fetchApiDomain],
  )

  // Esc while listening throws the recording away.
  useEffect(() => {
    if (phase !== 'listening') return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel, phase])

  useEffect(
    () => () => {
      cancelled.current = true
      recognition.current?.abort()
      if (recorder.current?.state === 'recording') recorder.current.stop()
      stopMeters()
    },
    [stopMeters],
  )

  return {
    available,
    browserSupported,
    cancel,
    choose,
    elapsed,
    engine,
    error,
    level,
    phase,
    prewarm,
    refresh,
    start,
    status,
    stop,
    toggle,
  }
}
