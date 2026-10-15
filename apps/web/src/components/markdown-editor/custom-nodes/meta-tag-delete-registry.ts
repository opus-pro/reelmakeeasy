import type { LexicalEditor } from 'lexical'

import type { ResourceType } from './MetaTagNode'

export type MetaTagDeleteHandler = (payload: MetaTagDeletePayload) => void

export interface MetaTagDeletePayload {
  resourceId: string
  resourceType: ResourceType
  title: string
}

const metaTagDeleteHandlerRegistry = new WeakMap<LexicalEditor, MetaTagDeleteHandler>()

export function getMetaTagDeleteHandler(editor: LexicalEditor): MetaTagDeleteHandler | undefined {
  return metaTagDeleteHandlerRegistry.get(editor)
}

export function registerMetaTagDeleteHandler(
  editor: LexicalEditor,
  handler: MetaTagDeleteHandler,
): () => void {
  metaTagDeleteHandlerRegistry.set(editor, handler)
  return () => {
    metaTagDeleteHandlerRegistry.delete(editor)
  }
}
