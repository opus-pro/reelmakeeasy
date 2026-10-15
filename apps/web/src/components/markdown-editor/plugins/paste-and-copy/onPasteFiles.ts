import {
  $createTextNode,
  $getSelection,
  $insertNodes,
  $isRangeSelection,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical'

import { $createMetaTagNode } from '../../custom-nodes/MetaTagNode'
import { getResourceTypeFromMime } from '../../custom-nodes/utils'
import { fileStorage } from '../file-storage'
import { generateUuid } from '../generate-uuid'

export function onPasteFiles(editor: LexicalEditor, files: File[]) {
  editor.update(() => {
    const selection = $getSelection()
    const nodes: LexicalNode[] = []

    files.forEach((file, index) => {
      const uuid = generateUuid()
      const fileName = file.name || `file-${index + 1}`

      fileStorage.set(uuid, { file, name: fileName, uuid })

      const fileUrl = `pasted://${uuid}`
      const fileNode = $createMetaTagNode({
        resourceId: fileUrl,
        resourceType: getResourceTypeFromMime(file.type),
        title: fileName,
      })
      nodes.push(fileNode)

      if (index < files.length - 1) {
        nodes.push($createTextNode(' '))
      }
    })

    if ($isRangeSelection(selection)) {
      selection.insertNodes(nodes)
    } else {
      $insertNodes(nodes)
    }
  })
}
