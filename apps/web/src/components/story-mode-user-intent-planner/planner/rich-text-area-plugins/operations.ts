import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  type LexicalEditor,
} from 'lexical'

import {
  $createMetaTagNode,
  type ResourceType,
} from '@/components/markdown-editor/custom-nodes/MetaTagNode'

import type { AssetRef } from '../../state-types'

export function insertAsset(editor: LexicalEditor, asset: AssetRef): void {
  editor.update(() => {
    let selection = $getSelection()
    if (!$isRangeSelection(selection)) {
      // No active selection (editor not focused) - fall back to end of document
      $getRoot().selectEnd()
      selection = $getSelection()
      if (!$isRangeSelection(selection)) {
        return
      }
    }
    selection.insertNodes([
      $createMetaTagNode({
        previewUrl: asset.previewUrl,
        resourceId: asset.id,
        resourceType: asset.type as ResourceType,
        title: asset.label,
      }),
      $createTextNode(' '),
    ])
  })
}

export function insertSelectedTextTag(
  editor: LexicalEditor,
  payload: {
    text: string
  },
): void {
  const normalizedText = payload.text.trim()
  if (!normalizedText) {
    return
  }

  editor.update(() => {
    let selection = $getSelection()
    if (!$isRangeSelection(selection)) {
      // No active selection (editor not focused) - fall back to end of document
      $getRoot().selectEnd()
      selection = $getSelection()
      if (!$isRangeSelection(selection)) {
        return
      }
    }

    selection.insertNodes([
      $createMetaTagNode({
        resourceId: `selected-text-${Date.now()}`,
        resourceType: 'txt',
        title: normalizedText,
      }),
      $createTextNode(' '),
    ])
  })
}

export function insertShotTag(
  editor: LexicalEditor,
  shot: {
    id: string
    title: string
  },
): void {
  editor.update(() => {
    let selection = $getSelection()
    if (!$isRangeSelection(selection)) {
      // No active selection (editor not focused) - fall back to end of document
      $getRoot().selectEnd()
      selection = $getSelection()
      if (!$isRangeSelection(selection)) {
        return
      }
    }
    selection.insertNodes([
      $createMetaTagNode({
        resourceId: shot.id,
        resourceType: 'shot',
        title: shot.title,
      }),
      $createTextNode(' '),
    ])
  })
}

export function setTextAndInsertAssets(
  editor: LexicalEditor,
  text: string,
  assets: AssetRef[],
): void {
  editor.update(() => {
    const root = $getRoot()
    root.clear()
    const para = $createParagraphNode()
    let hasContent = false
    if (text) {
      para.append($createTextNode(text))
      hasContent = true
    }
    for (const asset of assets) {
      if (hasContent) {
        para.append($createTextNode(' '))
      }
      para.append(
        $createMetaTagNode({
          previewUrl: asset.previewUrl,
          resourceId: asset.id,
          resourceType: asset.type as ResourceType,
          title: asset.label,
        }),
      )
      hasContent = true
    }
    root.append(para)
  })
}
