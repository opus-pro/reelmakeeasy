import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

interface ExpiredTooltipProps {
  children: React.ReactNode
  message?: string
}

export function ExpiredTooltip({
  children,
  message = 'This voice clone has expired due to a service upgrade. Please delete it and create a new one for improved quality.',
}: ExpiredTooltipProps) {
  const [isHovered, setIsHovered] = useState(false)
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 })
  const triggerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isHovered && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setTooltipPosition({
        top: rect.top - 8, // 8px gap (mb-2)
        left: rect.left + rect.width / 2,
      })
    }
  }, [isHovered])

  return (
    <>
      <div
        className="relative"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        ref={triggerRef}
      >
        {children}
      </div>

      {/* Tooltip rendered in portal */}
      {isHovered &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed flex flex-col w-[271px] rounded-sm px-2 py-4 shadow-lg z-[9999] pointer-events-none"
            style={{
              background: 'var(--Grey-30, #444)',
              top: `${tooltipPosition.top}px`,
              left: `${tooltipPosition.left}px`,
              transform: 'translate(-50%, -100%)',
            }}
          >
            <div className="flex flex-row items-start justify-start self-stretch">
              <div className="flex flex-row items-center justify-center flex-1 px-1.5">
                <div className="text-text-primary text-sm leading-[22px] font-normal flex-1 flex items-center">
                  {message}
                </div>
              </div>
            </div>
            {/* Downward arrow pointing at the trigger */}
            <div
              aria-hidden
              className="absolute bottom-0 left-1/2 size-3 -translate-x-1/2 translate-y-1/2 rotate-45 rounded-[2px]"
              style={{ background: 'var(--Grey-30, #444)' }}
            />
          </div>,
          document.body,
        )}
    </>
  )
}
