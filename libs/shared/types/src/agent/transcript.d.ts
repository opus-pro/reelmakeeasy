export type TranscriptData = {
  /**
   * 'segment': each segment is one caption, on screen for the segment's own [start, end] (a loop
   * chunk is held until the next chunk). Unset: a caption shows from its first word's start to
   * its last word's end.
   */
  captionWindows?: 'segment'
  language: string | undefined
  segments: TranscriptSegment[]
}
export interface TranscriptSegment {
  end: number
  start: number
  text: string
  words: TranscriptWord[]
}
export type TranscriptWord = {
  /** The caption's accent word, drawn in the highlight colour. */
  accent?: boolean
  end: number
  speaker?: null | string
  start: number
  word: string
}
