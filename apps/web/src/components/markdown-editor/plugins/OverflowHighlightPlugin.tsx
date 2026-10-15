import { evaluateAndTrimScript } from '@reelmakeeasy/common/utils/script-limits-core'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { $getRoot, TextNode } from 'lexical'
import { useEffect } from 'react'

interface OverflowHighlightPluginProps {
  enabled: boolean
}

// Using the preferred pink highlight color with white text for better contrast
const OVERFLOW_STYLE = 'background-color: rgba(207, 64, 32, 0.5); color: white; padding: 0 1px;'

/**
 * Plugin to highlight text that exceeds the 300-word limit.
 * Uses accurate character indexing and node splitting for precise highlighting.
 */
export function OverflowHighlightPlugin({ enabled }: OverflowHighlightPluginProps) {
  const [editor] = useLexicalComposerContext()

  useEffect(() => {
    if (!enabled) {
      // Clear any existing highlighting if disabled
      editor.update(() => {
        const root = $getRoot()
        root.getAllTextNodes().forEach((node) => {
          if (node.getStyle() !== '') {
            node.setStyle('')
          }
        })
      })
      return
    }

    const applyHighlighting = () => {
      const root = $getRoot()
      const textContent = root.getTextContent()

      // Calculate accurate overflow boundary based on the editor's actual text content
      const limitResult = evaluateAndTrimScript(textContent)
      const { exceeded, overflowStartIndex } = limitResult

      if (!exceeded || overflowStartIndex <= 0) {
        root.getAllTextNodes().forEach((node) => {
          if (node.getStyle() !== '') {
            node.setStyle('')
          }
        })
        return
      }

      let accumulatedIndex = 0
      const textNodes = root.getAllTextNodes()

      textNodes.forEach((textNode: TextNode) => {
        const text = textNode.getTextContent()
        if (!text) {
          return
        }

        // Use accumulated position to avoid duplicate text matching issues
        const nodeStart = accumulatedIndex
        const nodeEnd = nodeStart + text.length
        accumulatedIndex = nodeEnd

        if (nodeStart >= overflowStartIndex) {
          // Case 1: Node is entirely in the overflow region
          if (textNode.getStyle() !== OVERFLOW_STYLE) {
            textNode.setStyle(OVERFLOW_STYLE)
          }
        } else if (nodeEnd > overflowStartIndex) {
          // Case 2: Node spans the boundary - split it precisely
          const splitOffset = overflowStartIndex - nodeStart
          const [, afterNode] = textNode.splitText(splitOffset)
          if (afterNode) {
            afterNode.setStyle(OVERFLOW_STYLE)
          }
          // Clear style for the part before the boundary
          if (textNode.getStyle() !== '') {
            textNode.setStyle('')
          }
        } else {
          // Case 3: Node is entirely within the limit
          if (textNode.getStyle() !== '') {
            textNode.setStyle('')
          }
        }
      })
    }

    // Initial application
    editor.update(applyHighlighting, { discrete: true })

    // Register update listener to handle content changes
    return editor.registerUpdateListener(({ dirtyElements, dirtyLeaves }) => {
      // Only re-calculate if content actually changed
      if (dirtyElements.size > 0 || dirtyLeaves.size > 0) {
        editor.update(applyHighlighting, { discrete: true })
      }
    })
  }, [editor, enabled])

  return null
}
