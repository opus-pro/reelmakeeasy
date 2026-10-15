import { cn } from '@shared/ui'
import { useEffect, useRef, useState } from 'react'

import { ChevronDownSmall } from '@/components/icons/core'

interface InnerAgentLogBlockProps {
  className?: string
  defaultExpanded: boolean
  message: React.ReactNode
}

export default function InnerAgentReasoningBlock({
  message,
  defaultExpanded = true,
}: InnerAgentLogBlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const contentRef = useRef<HTMLDivElement>(null)
  const [contentHeight, setContentHeight] = useState(0)

  useEffect(() => {
    setExpanded(defaultExpanded)
  }, [defaultExpanded])

  // Update height when content or expanded state changes
  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.scrollHeight)
    }
  }, [message, expanded])

  return (
    <div className="scrollbar-hide text-secondary flex size-full flex-col overflow-y-auto scroll-smooth text-xs m-0 p-0">
      <div
        className="text-secondary flex cursor-pointer flex-row items-center justify-start leading-5 text-xs hover:text-white transition-colors duration-200 w-fit group/header"
        onClick={() => setExpanded(!expanded)}
      >
        <span>Reasoning</span>
        <ChevronDownSmall
          className={cn(
            'w-[12px] h-[12px] inline-block transition-all duration-300 ml-0.5 flex-shrink-0 group-hover/header:text-white pointer-events-none',
            expanded ? 'rotate-0' : '-rotate-90',
          )}
        />
      </div>
      <div
        className={cn('relative transition-all duration-300 overflow-hidden', expanded && 'mt-1')}
        style={expanded ? { height: contentHeight, opacity: 1 } : { height: 0, opacity: 0 }}
      >
        <div
          className="leading-5 m-0 [&_p]:text-xs [&_p]:my-0 [&_p]:leading-5 [&_code]:text-xs [&_h2]:text-xs [&_h2]:my-0 [&_h2]:leading-5 [&_h3]:text-xs [&_h3]:my-0 [&_h3]:leading-5 [&_li]:text-xs [&_ul]:my-0 [&>*:last-child]:mb-0"
          ref={contentRef}
        >
          {message}
        </div>
      </div>
    </div>
  )
}
