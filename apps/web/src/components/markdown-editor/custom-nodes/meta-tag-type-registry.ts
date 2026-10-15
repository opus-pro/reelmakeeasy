import type { LexicalEditor } from 'lexical'
import type { ReactNode } from 'react'

export type MetaTagType = 'audio' | 'file' | 'img' | 'pdf' | 'shot' | 'txt' | 'video' | 'vo'

export interface MetaTagTypeHandler {
  renderIcon?: (context: MetaTagTypeHandlerContext) => ReactNode | undefined
  resolveLabel?: (
    context: MetaTagTypeHandlerContext & {
      fallbackLabel: string
    },
  ) => string | undefined
  shouldRenderTitle?: (
    context: MetaTagTypeHandlerContext & {
      resolvedLabel: string
    },
  ) => boolean | undefined
}

export interface MetaTagTypeHandlerContext {
  duration?: number
  isDragging: boolean
  isEditable: boolean
  isHovered: boolean
  previewUrl?: string
  resourceId: string
  resourceType: MetaTagType
  title: string
}

const metaTagTypeHandlerRegistry = new WeakMap<
  LexicalEditor,
  Partial<Record<MetaTagType, MetaTagTypeHandler>>
>()

export function getMetaTagTypeHandler(
  editor: LexicalEditor,
  resourceType: MetaTagType,
): MetaTagTypeHandler | undefined {
  const handlers = metaTagTypeHandlerRegistry.get(editor)
  return handlers?.[resourceType]
}

export function registerMetaTagTypeHandler(
  editor: LexicalEditor,
  resourceType: MetaTagType,
  handler: MetaTagTypeHandler,
): () => void {
  const prevHandlers = metaTagTypeHandlerRegistry.get(editor) ?? {}
  metaTagTypeHandlerRegistry.set(editor, {
    ...prevHandlers,
    [resourceType]: handler,
  })

  return () => {
    const currentHandlers = metaTagTypeHandlerRegistry.get(editor)
    if (!currentHandlers) {
      return
    }
    const { [resourceType]: _removed, ...rest } = currentHandlers
    if (Object.keys(rest).length === 0) {
      metaTagTypeHandlerRegistry.delete(editor)
      return
    }
    metaTagTypeHandlerRegistry.set(editor, rest)
  }
}
