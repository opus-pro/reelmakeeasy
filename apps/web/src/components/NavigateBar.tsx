import { cn } from '@shared/ui'
import { useRouter } from 'next/navigation'
import React, { memo } from 'react'

import { LogoReelMakeEasy } from '@/components/icons/core'

type LogoWithTextProps = { className?: string; hideText?: boolean; showTextOnMobile?: boolean }

export const LogoWithText: React.FC<LogoWithTextProps> = memo((props) => {
  const { className, hideText = false, showTextOnMobile = false } = props
  const router = useRouter()
  return (
    <div
      className={cn(
        'text-primary flex flex-row items-center gap-1.5 text-[15px] font-bold cursor-pointer',
        className,
      )}
      onClick={() => {
        router.push('/')
      }}
    >
      <LogoReelMakeEasy height={22} width={22} />
      <span
        className={cn('text-nowrap', !showTextOnMobile && 'max-md:hidden', hideText && 'hidden')}
      >
        ReelMakeEasy
      </span>
    </div>
  )
})
