'use client'

import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'

import { CheckMark } from '@/components/icons/core'

import type { GateVariant } from '../defaults'

import { useDeadlineCountdown } from './hooks/useDeadlineCountdown'
import { ConfirmBannerCard } from './ConfirmBannerCard'
import { ConfirmBannerCardWithTools } from './ConfirmBannerCardWithTools'
import { ConfirmPanel } from './ConfirmPanel'

interface CountdownBannerCardProps {
  countdownShowAt?: string
  deadlineAt: null | string
  hideCountdown?: boolean
  hideIcon?: boolean
  left?: ReactNode
  onDeadlineReached: () => void
  right: ReactNode
  title: string
  variant?: GateVariant
  withTools?: boolean
}

export function CountdownBannerCard({
  countdownShowAt,
  deadlineAt,
  hideIcon = false,
  hideCountdown = false,
  left,
  onDeadlineReached,
  right,
  title,
  variant = 'legacy',
  withTools = false,
}: CountdownBannerCardProps) {
  const [isOperationDelayActive, setIsOperationDelayActive] = useState(() => {
    if (!countdownShowAt) {
      return false
    }
    return Date.now() < new Date(countdownShowAt).getTime()
  })

  useEffect(() => {
    if (!countdownShowAt) {
      setIsOperationDelayActive(false)
      return
    }
    const showAtMs = new Date(countdownShowAt).getTime()
    const remaining = showAtMs - Date.now()
    if (remaining <= 0) {
      setIsOperationDelayActive(false)
      return
    }
    setIsOperationDelayActive(true)
    const timer = setTimeout(() => setIsOperationDelayActive(false), remaining)
    return () => clearTimeout(timer)
  }, [countdownShowAt])

  const secondsRemaining = useDeadlineCountdown(deadlineAt, onDeadlineReached)

  if (secondsRemaining !== null && secondsRemaining <= 0) {
    return null
  }

  const countdown =
    secondsRemaining === null || hideCountdown || isOperationDelayActive ? null : (
      <CountdownLabel secondsRemaining={secondsRemaining} />
    )

  const sharedProps = {
    dataTestId: 'uip-countdown-banner-card' as const,
    hideGlowBorder: false,
    icon: hideIcon ? null : <CheckMark aria-hidden className="size-6 shrink-0 text-accent-green" />,
    right,
    title,
  }

  if (withTools) {
    return <ConfirmBannerCardWithTools {...sharedProps} countdown={countdown} left={left} />
  }
  // Canvas mode swaps the legacy ConfirmBannerCard for the redesigned panel;
  // withTools stays legacy (V1 script gate is legacy-only).
  const Panel = variant === 'canvas' ? ConfirmPanel : ConfirmBannerCard
  return <Panel {...sharedProps} description={countdown} />
}

function CountdownLabel({ secondsRemaining }: { secondsRemaining: number }) {
  const minutes = Math.floor(secondsRemaining / 60)
  const seconds = secondsRemaining % 60
  const countdownText = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`

  return (
    <>
      Auto confirm in{' '}
      <span className="inline-block min-w-[44px] tabular-nums text-white">{countdownText}</span>
    </>
  )
}
