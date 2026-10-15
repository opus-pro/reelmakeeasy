const MIME_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']

const SEEK_TIMEOUT_MS = 15000

interface HTMLVideoElementWithCaptureStream extends HTMLVideoElement {
  captureStream?(): MediaStream
  mozCaptureStream?(): MediaStream
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

const getSupportedMimeType = () => {
  if (typeof MediaRecorder === 'undefined') {
    return null
  }
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null
}

const waitForEvent = (
  target: HTMLVideoElement,
  eventName: keyof HTMLMediaElementEventMap,
  timeoutMs: number,
) =>
  new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out waiting for ${eventName}`))
    }, timeoutMs)

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      target.removeEventListener(eventName, handleEvent)
    }

    const handleEvent = () => {
      cleanup()
      resolve()
    }

    target.addEventListener(eventName, handleEvent, { once: true })
  })

const waitForPlaybackEnd = (video: HTMLVideoElement, endSec: number, fallbackMs: number) =>
  new Promise<void>((resolve) => {
    let resolved = false
    const timeoutId = window.setTimeout(() => {
      if (resolved) {
        return
      }
      resolved = true
      cleanup()
      resolve()
    }, fallbackMs)

    const cleanup = () => {
      window.clearTimeout(timeoutId)
      video.removeEventListener('timeupdate', handleTimeUpdate)
    }

    const handleTimeUpdate = () => {
      if (resolved) {
        return
      }
      if (video.currentTime >= endSec) {
        resolved = true
        cleanup()
        resolve()
      }
    }

    video.addEventListener('timeupdate', handleTimeUpdate)
  })

export async function trimVideoFile(file: File, startSec: number, endSec: number): Promise<Blob> {
  if (typeof window === 'undefined') {
    throw new Error('Video trimming is only available in the browser.')
  }

  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Video trimming is not supported in this browser.')
  }

  if (endSec <= startSec) {
    throw new Error('Invalid trim range.')
  }

  const mimeType = getSupportedMimeType()
  const objectUrl = URL.createObjectURL(file)
  const container = document.createElement('div')
  const video = document.createElement('video') as HTMLVideoElementWithCaptureStream
  let stream: MediaStream | null = null
  let recorder: MediaRecorder | null = null

  container.style.position = 'fixed'
  container.style.left = '-9999px'
  container.style.top = '0'
  container.style.width = '1px'
  container.style.height = '1px'
  container.style.opacity = '0'
  container.style.pointerEvents = 'none'
  container.style.overflow = 'hidden'

  video.preload = 'auto'
  video.muted = true
  video.playsInline = true
  video.src = objectUrl

  document.body.appendChild(container)
  container.appendChild(video)

  const cleanup = () => {
    URL.revokeObjectURL(objectUrl)
    container.remove()
  }

  try {
    await waitForEvent(video, 'loadedmetadata', SEEK_TIMEOUT_MS)

    const duration = Number.isFinite(video.duration) ? video.duration : 0
    const safeStart = clamp(startSec, 0, duration || startSec)
    const safeEnd = clamp(endSec, safeStart, duration || endSec)
    const clipDuration = safeEnd - safeStart

    if (clipDuration <= 0) {
      throw new Error('Selected trim range is too short.')
    }

    const shouldSeek = Math.abs(video.currentTime - safeStart) > 0.01
    video.currentTime = safeStart
    if (shouldSeek) {
      await waitForEvent(video, 'seeked', SEEK_TIMEOUT_MS)
    }

    stream = (video.captureStream || video.mozCaptureStream)?.call(video) ?? null
    if (!stream) {
      throw new Error('Video trimming is not supported in this browser.')
    }

    const chunks: Blob[] = []
    const mediaRecorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream)
    recorder = mediaRecorder

    const stopPromise = new Promise<Blob>((resolve, reject) => {
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunks.push(event.data)
        }
      }
      mediaRecorder.onerror = () => {
        reject(new Error('Failed to record trimmed video.'))
      }
      mediaRecorder.onstop = () => {
        resolve(new Blob(chunks, { type: mediaRecorder.mimeType || mimeType || 'video/webm' }))
      }
    })

    mediaRecorder.start()
    try {
      await video.play()
    } catch {
      throw new Error('Unable to play video for trimming.')
    }

    await waitForPlaybackEnd(video, safeEnd, clipDuration * 1000 + 50)

    if (mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop()
    }

    return await stopPromise
  } finally {
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop()
      } catch {
        // Ignore stop errors during cleanup.
      }
    }
    stream?.getTracks().forEach((track) => track.stop())
    video.pause()
    cleanup()
  }
}
