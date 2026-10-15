import type { Attachment } from '@shared/types/assets/attachment'

export type AnchorAssetCategory = 'actor' | 'assets' | 'logo' | 'object'

export type AnchorAssetPromptGroup = {
  category: AnchorAssetCategory
  items: AnchorAssetPromptItem[]
  label: string
}

export type AnchorAssetPromptItem = {
  attachment: Attachment
  category: AnchorAssetCategory
  displayName: string
  previewUrl: string
  resourceId: string
}
