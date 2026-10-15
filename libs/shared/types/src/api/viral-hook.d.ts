export type ViralHook = {
  height: number
  hook_id: string
  previewThumbnailUri?: string
  previewUrl?: string
  timeline: {
    in: number
    out: number
  }
  type_name: string
  uri: string
  width: number
}
export type ViralHookSummary = ViralHook[]
export type ViralHookV2 = {
  height: number
  hookType: string
  previewThumbnailUri?: string
  previewUrl?: string
  templateName: string
  timeline: {
    in: number
    out: number
  }
  uri: string
  width: number
}
