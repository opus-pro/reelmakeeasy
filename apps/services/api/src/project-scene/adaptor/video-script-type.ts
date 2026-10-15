export type VideoScript = Array<{
  script: {
    tracks: Track[]
  }
}>

type Segment = {
  content: {
    layoutId?: string
    params: {
      images?: Array<{
        desc: string
        uri?: string
      }>
    }
  }
  id: string
}
type Track = {
  segments: Segment[]
  type: 'audio' | 'template-asset'
}
