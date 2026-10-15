'use client'
import { removeHeadingEndingQuotes } from '@reelmakeeasy/common/agent/remove-quote'
import { AgentStreamMessage } from '@shared/types/chat/message'
import { AGENT_NAMES } from '@shared/types/enums/agent-name'
import { cn } from '@shared/ui'
import React, { memo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { LogoReelMakeEasy } from '@/components/icons/core'
import { META_TAG_REGEX, ResourceType } from '@/components/markdown-editor/custom-nodes/MetaTagNode'
import { MetaTagPill } from '@/components/markdown-editor/custom-nodes/MetaTagPill'

import InnerAgentReasoningBlock from './embedded-block/inner-reasoning-block'
import { handleCustomTags } from './markdown-message/handle-custom-tags'

interface ChatMessageProps {
  entry: AgentStreamMessage
  isLast?: boolean
  prevRole?: null | string
  showLogo?: boolean
  unquotedText: string
}

export const checkChatMessageValid = (entry: AgentStreamMessage): false | string => {
  const unquotedText = removeHeadingEndingQuotes(entry.text ?? '')
  if (!unquotedText || (entry.role === 'tool' && entry.agentName !== AGENT_NAMES.DIRECTOR)) {
    return false
  }
  return unquotedText
}

const ChatMessage: React.FC<ChatMessageProps> = ({
  entry,
  showLogo = false,
  isLast = false,
  prevRole = null,
  unquotedText,
}) => {
  const isUser = entry.role === 'user'
  const isTool = entry.role === 'tool'
  const isAgent = entry.role === 'agent'
  const isReasoning = entry.type === 'reasoning'
  // Check if previous message was from a different role (for spacing)
  const prevWasAgent = prevRole === 'agent' || prevRole === 'tool'

  const renderUserContent = (text: string) => {
    const META_TAG_REGEX_GLOBAL = new RegExp(META_TAG_REGEX.source, 'gu')
    const PROCESSED_TAG_REGEX = /\*\*@([^*]+)\*\*/g

    const parts: (React.JSX.Element | string)[] = []
    let lastIndex = 0
    let key = 0

    // Collect all matches from both formats
    const allMatches: Array<{
      duration?: number
      fullMatch: string
      offset: number
      previewUrl?: string
      resourceType?: ResourceType
      tagType: 'meta-tag'
      title: string
    }> = []

    // Process original format @img[title](id)
    const originalMatches = Array.from(text.matchAll(META_TAG_REGEX_GLOBAL))
    originalMatches.forEach((match) => {
      const [fullMatch, resourceType, title, , previewUrl] = match
      const offset = match.index ?? 0
      allMatches.push({
        fullMatch,
        offset,
        previewUrl: previewUrl || undefined,
        resourceType: resourceType as ResourceType,
        tagType: 'meta-tag',
        title,
      })
    })

    // Process **@title** format
    const processedMatches = Array.from(text.matchAll(PROCESSED_TAG_REGEX))
    processedMatches.forEach((match) => {
      const [fullMatch, title] = match
      const offset = match.index ?? 0
      allMatches.push({
        fullMatch,
        tagType: 'meta-tag',
        offset,
        title,
      })
    })

    // Sort matches by offset to process in order
    allMatches.sort((a, b) => a.offset - b.offset)

    // Process all matches in order
    allMatches.forEach((match) => {
      const { fullMatch, title, offset, tagType, resourceType, previewUrl, duration } = match

      // Add text before the match
      if (offset > lastIndex) {
        parts.push(text.slice(lastIndex, offset))
      }

      parts.push(
        <MetaTagPill
          duration={duration}
          key={key++}
          previewUrl={previewUrl}
          resourceType={resourceType}
          tagType={tagType}
          title={title}
        />,
      )

      lastIndex = offset + fullMatch.length
    })

    // Add remaining text
    if (lastIndex < text.length) {
      parts.push(text.slice(lastIndex))
    }

    return parts.length > 0 ? parts : text
  }

  const renderContent = () => {
    if (isUser && unquotedText) {
      const text = handleCustomTags(unquotedText)
      const content = renderUserContent(text)
      return <div className="max-w-none break-words whitespace-pre-wrap">{content}</div>
    }

    if (isTool) {
      return (
        <div className={cn('prose prose-ui max-w-none break-words', !isUser && 'prose-p:my-0.5')}>
          <span>[{entry.agentName}]</span>
          <ReactMarkdown>{unquotedText}</ReactMarkdown>
        </div>
      )
    }

    return (
      <div
        className={cn(
          'overflow-auto',
          isReasoning && 'm-0 p-0',
          'table-full-width',
          '[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]',
        )}
      >
        {isReasoning ? (
          <InnerAgentReasoningBlock
            defaultExpanded={isLast}
            message={<MarkdownMessage unquotedText={unquotedText} />}
          />
        ) : (
          <MarkdownMessage unquotedText={unquotedText} />
        )}
      </div>
    )
  }

  const content = renderContent()
  if (!content) {
    return null
  }

  return (
    <div
      className={cn(
        'flex',
        isUser
          ? `gap-3 flex-row-reverse ${prevRole === null ? '' : prevWasAgent ? '!mt-8' : '!mt-4'}`
          : 'gap-3 flex-row',
        showLogo && isAgent ? '!mt-8' : '',
      )}
    >
      <div
        className={cn('flex flex-col relative', isUser ? 'items-end max-w-[85%]' : 'items-start')}
      >
        <div
          className={cn(
            'w-full relative group flex flex-col items-start',
            isUser &&
              'py-2 px-2 bg-fill-secondary text-body-md leading-6 rounded-xl whitespace-normal break-words hyphens-none',
          )}
        >
          {showLogo && isAgent && (
            <LogoReelMakeEasy className="mb-4 cursor-default opacity-30" height={18} width={18} />
          )}
          {/* Message content */}
          <span className="w-full min-w-0 flex-1 [&>*]:text-sm [&>*]:leading-6">{content}</span>
        </div>
      </div>
    </div>
  )
}

export default memo(ChatMessage)

const MarkdownMessage: React.FC<{
  overrides?: React.ComponentProps<typeof ReactMarkdown>['components']
  unquotedText: string
}> = ({ unquotedText, overrides }) => {
  return (
    <ReactMarkdown
      components={{
        code: ({ ...props }) => <code className="whitespace-normal text-sm" {...props} />,
        p: ({ ...props }) => (
          <p className="mb-1 text-sm font-normal leading-6 tracking-tight last:mb-0" {...props} />
        ),
        h3: ({ ...props }) => <h3 className="mb-4 font-medium leading-6 last:mb-0" {...props} />,
        h2: ({ ...props }) => <h2 className="mb-4 font-medium leading-6 last:mb-0" {...props} />,
        ul: ({ ...props }) => <ul className="mb-4 list-inside list-disc last:mb-0" {...props} />,
        li: ({ children, ...props }) => {
          if (typeof children === 'string' && children.includes('[ ]')) {
            // remove task list marker, replace with empty
            const cleanText = children.replace(/^\s*\[ \]\s*/, '')
            return (
              <li className="tracking-tight" {...props}>
                {cleanText}
              </li>
            )
          }
          return (
            <li className="tracking-tight" {...props}>
              {children}
            </li>
          )
        },
        strong: ({ ...props }) => <strong className="font-semibold text-foreground" {...props} />,
        table: ({ ...props }) => (
          <div className="my-4 w-full">
            <table className="w-full min-w-full border-collapse" {...props} />
          </div>
        ),
        thead: ({ ...props }) => <thead className="hidden" {...props} />,
        tbody: ({ ...props }) => <tbody {...props} />,
        tr: ({ ...props }) => (
          <tr className="border-b border-tertiary last:border-b-0" {...props} />
        ),
        td: ({ ...props }) => (
          <td
            className="py-3 text-sm align-top first:pl-0 first:pr-4 first:font-medium first:text-foreground first:w-[140px] [&:not(:first-child)]:px-4 [&:not(:first-child)]:font-normal break-words"
            {...props}
          />
        ),
        ...overrides,
      }}
      remarkPlugins={[remarkGfm]}
    >
      {unquotedText}
    </ReactMarkdown>
  )
}
