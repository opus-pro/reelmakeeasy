declare module 'mp4box' {
  export type MP4ArrayBuffer = ArrayBuffer & { fileStart?: number }

  export type Sample = {
    cts: number
    dts: number
    duration?: number
    offset: number
    size: number
    timescale?: number
  }

  export type Track = {
    id?: number
    mdia?: {
      minf?: {
        stbl?: {
          stss?: {
            sample_numbers: number[]
          }
        }
      }
    }
    samples?: Sample[]
    timescale?: number
    type?: string
  }

  export type MP4Info = { tracks: Track[] }

  export interface MP4File {
    appendBuffer(data: MP4ArrayBuffer): number
    flush(): void
    getTrackById(trackId: number): Track | undefined
    onError?: (e: Error) => void
    onReady?: (info: MP4Info) => void
  }

  export function createFile(): MP4File
}
