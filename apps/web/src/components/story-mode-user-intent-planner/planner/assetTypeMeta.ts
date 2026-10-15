import type { ComponentType } from 'react'

import { File, FileText, Film, Image, Music, Text, Voiceover } from '@/components/icons/core'

import type { AssetRef } from '../state-types'

export interface AssetTypeMeta {
  Icon: ComponentType<{ className?: string }>
  label: string
}

/**
 * Type badge (icon + human label) for an asset, using the shared @/components/icons/core set so the
 * canvas Assets section details each asset's kind the same way the rest of the product does.
 * Keyed on the full AssetRef['type'] union, so adding a new asset type fails to
 * compile until a mapping is added here rather than silently falling through.
 */
const ASSET_TYPE_META: Record<AssetRef['type'], AssetTypeMeta> = {
  audio: { Icon: Music, label: 'Audio' },
  file: { Icon: File, label: 'File' },
  img: { Icon: Image, label: 'Image' },
  pdf: { Icon: FileText, label: 'PDF' },
  txt: { Icon: Text, label: 'Text' },
  video: { Icon: Film, label: 'Video' },
  vo: { Icon: Voiceover, label: 'Voiceover' },
}

export function assetTypeMeta(type: AssetRef['type']): AssetTypeMeta {
  return ASSET_TYPE_META[type] ?? ASSET_TYPE_META.file
}
