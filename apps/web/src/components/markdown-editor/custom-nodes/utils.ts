import { $getRoot, $isElementNode, LexicalNode } from 'lexical'

import type { ResourceType } from './MetaTagNode'
import { $isMetaTagNode, MetaTagNode } from './MetaTagNode'

export function getFileNameWithoutExtension(fileName: string): string {
  const lastDotIndex = fileName.lastIndexOf('.')
  return lastDotIndex > 0 ? fileName.slice(0, lastDotIndex) : fileName
}

export function getResourceTypeFromMime(mime: string): ResourceType {
  if (mime.startsWith('image/')) {
    return 'img'
  }
  if (mime.startsWith('video/')) {
    return 'video'
  }
  if (mime.startsWith('audio/')) {
    return 'audio'
  }
  if (mime === 'application/pdf') {
    return 'pdf'
  }
  if (mime.startsWith('text/')) {
    return 'txt'
  }
  return 'file'
}

export function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

/**
 * Efficiently traverse all MetaTagNodes in the editor
 */
export function $visitMetaTagNodes(callback: (node: MetaTagNode) => void) {
  const root = $getRoot()
  const visit = (node: LexicalNode) => {
    if ($isElementNode(node)) {
      for (const child of node.getChildren()) {
        visit(child)
      }
      return
    }
    if ($isMetaTagNode(node)) {
      callback(node)
    }
  }
  visit(root)
}
