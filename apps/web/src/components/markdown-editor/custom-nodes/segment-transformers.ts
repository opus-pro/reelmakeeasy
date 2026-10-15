import { $createTextNode, LexicalNode } from 'lexical'

export type TextToSegmentTransformer = (text: string) => TransformedSegment[]
export type TransformedSegment =
  | {
      node: LexicalNode
      type: 'node'
    }
  | {
      node?: LexicalNode
      text: string
      type: 'text'
    }

export function convertTextToLexicalNodes(
  text: string,
  transformers: TextToSegmentTransformer[],
): LexicalNode[] {
  let tempSegments: TransformedSegment[] = [{ text, type: 'text' }]
  for (const transformer of transformers) {
    tempSegments = tempSegments.flatMap((segment) => {
      if (segment.type === 'text') {
        return transformer(segment.text)
      }
      return [segment]
    })
  }

  return tempSegments.map((segment) =>
    segment.type === 'text' ? $createTextNode(segment.text) : segment.node,
  )
}
export function createTextToSegmentTransformFn(
  regex: RegExp,
  toNode: (match: RegExpExecArray) => LexicalNode,
): TextToSegmentTransformer {
  const regexCopied = new RegExp(regex, 'g')
  return (text: string) => {
    const result: TransformedSegment[] = []
    let lastIndex = 0
    let match: null | RegExpExecArray

    regexCopied.lastIndex = 0

    while (true) {
      match = regexCopied.exec(text)
      if (!match) {
        break
      }

      if (match.index > lastIndex) {
        const beforeText = text.slice(lastIndex, match.index)
        if (beforeText) {
          result.push({ text: beforeText, type: 'text' })
        }
      }
      result.push({ node: toNode(match), type: 'node' })

      lastIndex = match.index + match[0].length
    }

    if (lastIndex < text.length) {
      const remainingText = text.slice(lastIndex)
      if (remainingText) {
        result.push({ text: remainingText, type: 'text' })
      }
    }

    return result
  }
}
