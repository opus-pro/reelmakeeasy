import { Button, cn } from '@shared/ui'
import { memo, useEffect, useRef, useState } from 'react'

interface ExpandableTextProps {
  className?: string
  text?: string
}

const ExpandableText = memo(({ className, text }: ExpandableTextProps) => {
  const [isExpanded, setIsExpanded] = useState(false)
  const [needsClamp, setNeedsClamp] = useState(false)
  const [truncatedText, setTruncatedText] = useState('')
  const measureRef = useRef<HTMLSpanElement>(null)
  const containerRef = useRef<HTMLParagraphElement>(null)

  const displayText = text || 'Loading...'
  const moreSuffix = '...More'

  useEffect(() => {
    setIsExpanded(false)
  }, [text])

  useEffect(() => {
    if (!containerRef.current || !measureRef.current) {
      return
    }

    const measure = measureRef.current
    const maxHeight = 48 // 3 lines at ~16px line-height

    // Check if text needs truncation
    measure.textContent = displayText
    if (measure.scrollHeight <= maxHeight) {
      setNeedsClamp(false)
      setTruncatedText(displayText)
      return
    }

    setNeedsClamp(true)

    // Binary search to find the truncation point
    let low = 0
    let high = displayText.length

    while (low < high) {
      const mid = Math.floor((low + high + 1) / 2)
      measure.textContent = displayText.slice(0, mid) + moreSuffix

      if (measure.scrollHeight <= maxHeight) {
        low = mid
      } else {
        high = mid - 1
      }
    }

    setTruncatedText(displayText.slice(0, low))
  }, [displayText, moreSuffix])

  if (isExpanded) {
    return <p className={className}>{displayText}</p>
  }

  return (
    <p className={className} ref={containerRef}>
      <span className="invisible absolute whitespace-pre-wrap w-full" ref={measureRef}>
        {displayText}
      </span>
      {needsClamp ? (
        <>
          {truncatedText}
          <span className="cursor-pointer" onClick={() => setIsExpanded(true)}>
            ...More
          </span>
        </>
      ) : (
        displayText
      )}
    </p>
  )
})

ExpandableText.displayName = 'ExpandableText'

interface StoryboardPanelProps {
  className?: string
  duration?: string
  enableEditShot?: boolean
  motionDescription?: string
  onEditShot?: () => void
  scriptText?: string
}

const StoryboardPanel: React.FC<StoryboardPanelProps> = ({
  className,
  scriptText,
  motionDescription,
  duration,
  onEditShot,
  enableEditShot,
}) => {
  return (
    <div
      className={cn(
        'flex flex-col gap-4 w-56 opacity-70 hover:opacity-100 transition-opacity',
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="font-mono text-xs font-semibold uppercase leading-4 text-secondary">
          Script writer
        </p>
        <ExpandableText className="font-mono text-xs text-primary" text={scriptText} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-mono text-xs font-semibold uppercase leading-4 text-secondary">
          Motion designer
        </p>
        <ExpandableText className="font-mono text-xs text-primary" text={motionDescription} />
      </div>
      <div className="flex flex-col gap-1">
        <p className="font-mono text-xs font-semibold uppercase leading-4 text-secondary">
          Duration
        </p>
        <p className="font-mono text-xs text-primary">{duration || '--:-- - --:--'}</p>
      </div>
      {enableEditShot && (
        <Button
          className="h-9 w-fit text-primary hover:bg-fill-hover hover:text-primary"
          onClick={onEditShot}
          variant="outline"
        >
          Edit shot
        </Button>
      )}
    </div>
  )
}

export default memo(StoryboardPanel)
