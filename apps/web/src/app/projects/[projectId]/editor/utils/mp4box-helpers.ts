import { Logger } from '@reelmakeeasy/common/utils/logger'
import type { MP4ArrayBuffer, Track } from 'mp4box'

import { ModuleName } from '../wasm/type'

const nsLogger = Logger.get('project.mp4box-helpers')

export type ComputeRangeRequest = {
  endTime: number
  paddingBytes: number
  startTime: number
  url: string
}

export type ParsedTrackInfo = {
  totalSize: number
  track: Track
}

type CacheRange = { end: number; start: number; url: string }

type Mp4ServiceDeps = {
  fetchRange: (
    item: CacheRange,
    priority?: number,
    moduleName?: false | ModuleName,
  ) => Promise<ArrayBuffer>
  getSize: (url: string) => Promise<number>
}

export function createMp4Service({ fetchRange, getSize }: Mp4ServiceDeps) {
  const mp4TrackCache = new Map<string, Promise<ParsedTrackInfo>>()

  async function getParsedTrack(url: string): Promise<ParsedTrackInfo> {
    const cached = mp4TrackCache.get(url)
    if (cached) {
      return cached
    }

    const promise = buildParsedTrack(url)
    mp4TrackCache.set(url, promise)

    try {
      return await promise
    } catch (error) {
      mp4TrackCache.delete(url)
      throw error
    }
  }

  async function buildParsedTrack(url: string): Promise<ParsedTrackInfo> {
    const totalSize = await getSize(url)
    if (!totalSize || totalSize <= 0) {
      throw new Error(`Invalid media size for ${url}`)
    }

    const moovData = await fetchCompleteMoov(fetchRange, url, totalSize)
    if (!moovData) {
      throw new Error(`Failed to fetch moov box for ${url}`)
    }

    const track = await parseMp4File(moovData)
    if (!track) {
      throw new Error(`No video track found for ${url}`)
    }

    return { track, totalSize }
  }

  async function computeRange({
    url,
    startTime,
    endTime,
    paddingBytes,
  }: ComputeRangeRequest): Promise<{ end: number; start: number }> {
    const parsedTrack = await getParsedTrack(url)
    return computeByteRangeFromTrack(
      parsedTrack.track,
      startTime,
      endTime,
      paddingBytes,
      parsedTrack.totalSize,
    )
  }

  function clearCache() {
    mp4TrackCache.clear()
  }

  return {
    clearCache,
    computeRange,
    getParsedTrack,
  }
}

async function fetchCompleteMoov(
  fetchRange: Mp4ServiceDeps['fetchRange'],
  mediaUrl: string,
  totalSize: number,
): Promise<undefined | { moovMp4Array: MP4ArrayBuffer; preMp4Array: MP4ArrayBuffer }> {
  const PRELOAD_MP4_BYTES = 1024 * 10
  const EXTRA_MOOV_OFFSET_BYTES = 1024 * 60

  let end = PRELOAD_MP4_BYTES
  let start = 0

  try {
    const preArrayBuffer = await fetchRange({ url: mediaUrl, start, end }, 0, false)
    const { start: moovStart, size: moovSize } = getMoovBoxSize(preArrayBuffer, totalSize)
    start = moovStart

    if (moovSize <= 0) {
      return
    }

    const fileEnd = totalSize > 0 ? totalSize - 1 : start + moovSize + EXTRA_MOOV_OFFSET_BYTES
    end = Math.min(start + moovSize + EXTRA_MOOV_OFFSET_BYTES, fileEnd)

    const arrayBuffer = await fetchRange({ url: mediaUrl, start, end }, 0, false)

    const preMp4Array: MP4ArrayBuffer = Object.assign(preArrayBuffer, { fileStart: 0 })
    const moovMp4Array: MP4ArrayBuffer = Object.assign(arrayBuffer, { fileStart: start })

    return { preMp4Array, moovMp4Array }
  } catch (error) {
    nsLogger.error('Error fetching moov box:', error)
    return
  }
}

async function parseMp4File(result: {
  moovMp4Array: MP4ArrayBuffer
  preMp4Array: MP4ArrayBuffer
}): Promise<Track> {
  const { createFile } = await loadMp4boxModule()
  return new Promise((resolve, reject) => {
    const mp4boxFile = createFile()

    mp4boxFile.onReady = function (info: { tracks: Track[] }) {
      const videoTrackInfo = info.tracks.find((track) => track.type === 'video')
      if (videoTrackInfo?.id) {
        const videoTrack = mp4boxFile.getTrackById(videoTrackInfo.id)
        if (videoTrack) {
          resolve(videoTrack as Track)
        } else {
          reject(new Error('Video track not found'))
        }
      } else {
        reject(new Error('No video track in file'))
      }
    }

    mp4boxFile.onError = function (error: Error) {
      reject(error)
    }

    mp4boxFile.appendBuffer(result.preMp4Array)
    mp4boxFile.flush()
    mp4boxFile.appendBuffer(result.moovMp4Array)
    mp4boxFile.flush()
  })
}

let mp4boxModulePromise: null | Promise<typeof import('mp4box')> = null
export function computeByteRangeFromTrack(
  track: Track,
  startTime: number,
  endTime: number,
  paddingBytes: number,
  totalSize: number,
): { end: number; start: number } {
  const safeStartTime = Math.max(0, startTime)
  const safeEndTime = Math.max(safeStartTime, endTime)
  const startOffset = findClosestKeyframeOffset(track, safeStartTime)
  const endOffset = findSampleBoundaryOffset(track, safeEndTime)
  const startByte = Math.max(startOffset, 0)
  const rawEnd = endOffset >= 0 ? endOffset : startByte + paddingBytes
  const maxByteIndex = totalSize > 0 ? totalSize - 1 : rawEnd
  // Add paddingBytes past the sample boundary so we fetch a bit extra for decoding safety
  const computedEnd = Math.min(maxByteIndex, rawEnd + paddingBytes)
  const endByteCandidate = Math.min(maxByteIndex, Math.max(startByte, computedEnd))
  const endByte = Math.max(startByte, endByteCandidate)

  return { start: startByte, end: endByte }
}

export function findClosestKeyframeOffset(track: Track, timestampMs: number) {
  if (timestampMs < 0) {
    return -1
  }
  const samples = track.samples
  const stss = track.mdia?.minf?.stbl?.stss

  if (!stss || !samples || stss.sample_numbers.length === 0) {
    return -1
  }

  let left = 0
  let right = stss.sample_numbers.length - 1
  let closestKeyframeIndex = -1

  while (left <= right) {
    const mid = Math.floor((left + right) / 2)
    const sampleIndex = stss.sample_numbers[mid] - 1
    const sample = samples[sampleIndex]

    if (!sample) {
      return -1
    }
    const timescale = sample.timescale ?? track.timescale
    if (!timescale) {
      return -1
    }
    const sampleTime = (sample.dts / timescale) * 1000

    if (sampleTime <= timestampMs) {
      closestKeyframeIndex = sampleIndex
      if (sampleTime === timestampMs) {
        break
      }
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  if (closestKeyframeIndex === -1) {
    return -1
  }

  return samples[closestKeyframeIndex]?.offset ?? -1
}

export function findSampleBoundaryOffset(track: Track, timestampMs: number) {
  const samples = track.samples
  if (!samples || samples.length === 0) {
    return -1
  }
  const timescale = samples[0]?.timescale ?? track.timescale
  if (!timescale) {
    return -1
  }
  const targetDts = (timestampMs / 1000) * timescale

  let left = 0
  let right = samples.length - 1
  let idx = 0
  while (left <= right) {
    const mid = (left + right) >> 1
    if (samples[mid].dts <= targetDts) {
      idx = mid
      left = mid + 1
    } else {
      right = mid - 1
    }
  }

  let candidate = samples[idx]
  const candidateEnd = candidate.dts + (candidate.duration ?? 0)
  if (targetDts > candidateEnd && idx + 1 < samples.length) {
    candidate = samples[idx + 1]
  }

  const offset = candidate.offset ?? -1
  const size = candidate.size ?? 0
  if (offset < 0) {
    return -1
  }
  return offset + size
}

function getMoovBoxSize(
  arrayBuffer: ArrayBuffer,
  totalSize: number,
): { size: number; start: number } {
  const dataView = new DataView(arrayBuffer)
  let offset = 0
  let moovSize = 0
  let preBoxSize = 0

  while (offset + 8 <= dataView.byteLength) {
    const boxSize = dataView.getUint32(offset)
    if (boxSize <= 0) {
      return { start: 0, size: 0 }
    }
    const type = String.fromCharCode(
      dataView.getUint8(offset + 4),
      dataView.getUint8(offset + 5),
      dataView.getUint8(offset + 6),
      dataView.getUint8(offset + 7),
    ).toLowerCase()

    if (type === 'moov') {
      moovSize = boxSize
      return { start: offset, size: moovSize }
    }

    preBoxSize += boxSize
    offset += boxSize
  }

  moovSize = totalSize - preBoxSize
  return { start: preBoxSize, size: moovSize }
}

async function loadMp4boxModule() {
  if (!mp4boxModulePromise) {
    mp4boxModulePromise = import('mp4box')
  }
  return mp4boxModulePromise
}
