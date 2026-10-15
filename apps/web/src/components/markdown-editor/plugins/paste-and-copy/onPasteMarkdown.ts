import {
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'

import {
  $createMetaTagNode,
  META_TAG_REGEX,
  type ResourceType,
} from '@/components/markdown-editor/custom-nodes/MetaTagNode'

const META_TAG_REGEX_GLOBAL = new RegExp(META_TAG_REGEX.source, 'gu')

export function filterMetaTagsByResourcePool(text: string, validResourceIds: Set<string>): string {
  META_TAG_REGEX_GLOBAL.lastIndex = 0

  let result = ''
  let lastIndex = 0
  let match: null | RegExpExecArray

  while (true) {
    match = META_TAG_REGEX_GLOBAL.exec(text)
    if (!match) {
      break
    }

    const [fullMatch, , , resourceId] = match
    result += text.slice(lastIndex, match.index)
    result += validResourceIds.has(resourceId) ? fullMatch : ''
    lastIndex = match.index + fullMatch.length
  }

  result += text.slice(lastIndex)
  return result
}

export function hasMetaTag(text: string): boolean {
  return META_TAG_REGEX.test(text)
}

export function hasOtherMarkdown(text: string): boolean {
  return /(\*\*\*.*?\*\*\*|\*\*.*?\*\*|\*.*?\*|__.*?__|_.*?_|~~.*?~~|`.*?`|^#{1,6}\s+)/gm.test(text)
}

export function onPasteMarkdownAsPureText(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const selection = $getSelection()
    const strippedText = stripMarkdownFormatting(text)

    if ($isRangeSelection(selection)) {
      selection.insertText(strippedText)
    } else {
      $insertNodes([$createTextNode(strippedText)])
    }
  })
}

export function onPasteMarkdownMetaTag(editor: LexicalEditor, text: string) {
  editor.update(() => {
    const selection = $getSelection()

    const nodes: LexicalNode[] = []
    let lastIndex = 0
    let match: null | RegExpExecArray

    META_TAG_REGEX_GLOBAL.lastIndex = 0

    while (true) {
      match = META_TAG_REGEX_GLOBAL.exec(text)
      if (!match) {
        break
      }

      if (match.index > lastIndex) {
        const beforeText = text.slice(lastIndex, match.index)
        if (beforeText) {
          nodes.push($createTextNode(beforeText))
        }
      }

      const [, resourceType, title, resourceId] = match
      const metaNode = $createMetaTagNode({
        resourceId,
        resourceType: resourceType as ResourceType,
        title,
      })
      nodes.push(metaNode)

      lastIndex = match.index + match[0].length
    }

    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex)
      if (remainingText) {
        nodes.push($createTextNode(remainingText))
      }
    }

    if ($isRangeSelection(selection)) {
      selection.insertNodes(nodes)
    } else {
      $insertNodes(nodes)
    }
  })
}

export function stripMarkdownFormatting(text: string): string {
  return (
    text
      // Remove bold/italic markers but keep the text
      .replace(/\*\*\*(.*?)\*\*\*/g, '$1') // bold+italic
      .replace(/\*\*(.*?)\*\*/g, '$1') // bold
      .replace(/\*(.*?)\*/g, '$1') // italic
      .replace(/__(.*?)__/g, '$1') // bold (underscore)
      .replace(/_(.*?)_/g, '$1') // italic (underscore)
      .replace(/~~(.*?)~~/g, '$1') // strikethrough
      .replace(/`(.*?)`/g, '$1') // inline code
      .replace(/^#{1,6}\s+/gm, '') // Remove headers
  )
  // Remove other markdown syntax but preserve the content
}
