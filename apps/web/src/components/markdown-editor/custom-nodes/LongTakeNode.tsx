import { TextMatchTransformer } from '@lexical/markdown'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { useLexicalEditable } from '@lexical/react/useLexicalEditable'
import { cn } from '@shared/ui'
import type { LexicalNode } from 'lexical'
import { DecoratorNode } from 'lexical'
import type { JSX } from 'react'
import React, { useState } from 'react'

import { Cross } from '@/components/icons/core'

import { MarkdownSerializer } from '../types'

// format: @story-mode (legacy: @long-take)
const LONG_TAKE_REGEX = /@(story-mode|long-take)/

export class LongTakeMarkdownSerializer implements MarkdownSerializer<LongTakeNode> {
  fromMarkdownString(_markdown: string): LongTakeNode {
    return new LongTakeNode()
  }
  toMarkdownString(_node: LongTakeNode): string {
    return '@story-mode'
  }
}

export class LongTakeNode extends DecoratorNode<JSX.Element> {
  static serializer = new LongTakeMarkdownSerializer()

  static clone(node: LongTakeNode) {
    return new LongTakeNode(node.__key)
  }

  static getType(): string {
    return 'long-take'
  }

  static importJSON() {
    return new LongTakeNode()
  }

  createDOM(): HTMLElement {
    return document.createElement('span')
  }

  decorate(): JSX.Element {
    return <LongTakeComponent node={this} />
  }

  exportJSON() {
    return {
      type: 'long-take',
      version: 1,
    }
  }

  getTextContent(): string {
    return LongTakeNode.serializer.toMarkdownString(this)
  }

  isInline(): boolean {
    return true
  }

  updateDOM(): boolean {
    return false
  }
}

export function $createLongTakeNode(): LongTakeNode {
  return new LongTakeNode()
}

export function $isLongTakeNode(node: LexicalNode | null | undefined): node is LongTakeNode {
  return node instanceof LongTakeNode
}

function LongTakeComponent({ node }: { node: LongTakeNode }) {
  const [editor] = useLexicalComposerContext()
  const isEditable = useLexicalEditable()
  const [isHovered, setIsHovered] = useState(false)

  const handleDelete = () => {
    if (!isEditable) {
      return
    }
    editor.update(() => {
      const latestNode = node.getLatest()
      latestNode.remove()
    })
  }

  return (
    <span
      className="relative inline align-baseline"
      onMouseEnter={() => {
        if (!isEditable) {
          return
        }
        setIsHovered(true)
      }}
      onMouseLeave={() => {
        if (!isEditable) {
          return
        }
        setIsHovered(false)
      }}
    >
      <span
        className={cn(
          'inline-flex items-center gap-1 border border-success/30 rounded-sm px-1 py-0 mx-1 my-px transition-colors cursor-pointer align-middle',
          isHovered ? 'bg-success/20' : 'bg-success/[0.08]',
        )}
      >
        <span className="text-success text-base leading-6.5 pointer-events-none">@StoryMode</span>
      </span>
      {isHovered && isEditable && (
        <span
          className={cn(
            'absolute top-2.5 right-1.5 -translate-y-1/2 flex items-center justify-center',
            'bg-fill-hover text-primary p-1 rounded-sm size-5 cursor-pointer',
          )}
          onClick={() => {
            handleDelete()
          }}
        >
          <Cross className="size-4 text-primary" />
        </span>
      )}
    </span>
  )
}

export const LongTakeTransformer: TextMatchTransformer = {
  dependencies: [LongTakeNode],
  export: (node) => {
    if (node instanceof LongTakeNode) {
      return LongTakeNode.serializer.toMarkdownString(node)
    }
    return null
  },
  importRegExp: LONG_TAKE_REGEX,
  regExp: LONG_TAKE_REGEX,
  replace: (node, _match) => {
    const longTakeNode = new LongTakeNode()
    node.replace(longTakeNode)
  },
  type: 'text-match',
}
