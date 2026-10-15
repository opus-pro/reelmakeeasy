import type { LexicalEditor } from 'lexical'
import type { ReactNode } from 'react'

import type { ResourceType } from './MetaTagNode'

export interface MetaTagTooltipPayload {
  duration?: number
  isDragging: boolean
  previewUrl?: string
  resolvedLabel: string
  resourceId: string
  resourceType: ResourceType
  title: string
  tooltipPosition: {
    left: number
    top: number
  }
}

export type MetaTagTooltipRenderer = (payload: MetaTagTooltipPayload) => null | ReactNode

const metaTagTooltipRendererRegistry = new WeakMap<LexicalEditor, MetaTagTooltipRenderer>()

export function getMetaTagTooltipRenderer(
  editor: LexicalEditor,
): MetaTagTooltipRenderer | undefined {
  return metaTagTooltipRendererRegistry.get(editor)
}

export function registerMetaTagTooltipRenderer(
  editor: LexicalEditor,
  renderer: MetaTagTooltipRenderer,
): () => void {
  metaTagTooltipRendererRegistry.set(editor, renderer)
  return () => {
    metaTagTooltipRendererRegistry.delete(editor)
  }
}
